import contextlib
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import import_commentary
from import_commentary import content_path, find_parasha, import_notes

SCRIPT = Path(__file__).with_name("import_commentary.py")


class ImportCommentaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.parasha = self.root / "parasha"
        self.parasha.mkdir()
        (self.parasha / "HE.md").write_text("héber", encoding="utf-8")
        (self.parasha / "HU.md").write_text(
            "# 29. fejezet\n**1.** a **2.** b **3.** c\n", encoding="utf-8"
        )
        self.source = self.root / "notes.md"

    def run_import(self, text, overrides=None, dry_run=False):
        self.source.write_text(text, encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            import_notes(self.source, self.parasha, overrides or {}, dry_run)

    def test_ranges_override_and_paragraphs(self):
        self.run_import(
            "# Bevezető\n\n## 1. 29:1–2 – Cím\n\nElső.\n\n- lista\n\n---\n"
            "## 2. Cím nélkül\n\nMásodik.\n\n## Lezárás\n\nNem része.\n",
            {2: "29:3"},
        )
        first = (self.parasha / "perusim/notes-01.md").read_text(encoding="utf-8")
        second = (self.parasha / "perusim/notes-02.md").read_text(encoding="utf-8")
        self.assertIn('mytorah-verses: "29:1,29:2"', first)
        self.assertIn("Első.\n\n- lista", first)
        self.assertIn('mytorah-verses: "29:3"', second)
        self.assertNotIn("Lezárás", second)

    def test_invalid_or_missing_reference_never_writes(self):
        for text in ("## 1. Cím\n\nSzöveg", "## 1. 29:4 – Cím\n\nSzöveg",
                     "## 1. 29:1–30:2 – Cím\n\nSzöveg"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.run_import(text)
            self.assertFalse((self.parasha / "perusim").exists())

    def test_dry_run_and_existing_note(self):
        text = "## 1. 29:1 – Cím\n\nSzöveg"
        self.run_import(text, dry_run=True)
        self.assertFalse((self.parasha / "perusim").exists())
        self.run_import(text)
        note = self.parasha / "perusim/notes-01.md"
        before = note.read_text(encoding="utf-8")
        with self.assertRaises(ValueError):
            self.run_import(text)
        self.assertEqual(note.read_text(encoding="utf-8"), before)

    def test_inherit_all_previous_verses_and_overrides(self):
        self.run_import(
            "## 1. 29:1–2 – Első\n\nSzöveg\n\n"
            "## 2. Második\n\nSzöveg\n\n"
            "## 3. Harmadik\n\nSzöveg\n\n"
            "## 4. 29:1 – Negyedik\n\nSzöveg\n\n"
            "## 5. Ötödik\n\nSzöveg\n",
            {4: "29:3"},
        )
        for number, refs in ((2, "29:1,29:2"), (3, "29:1,29:2"), (5, "29:3")):
            note = (self.parasha / f"perusim/notes-{number:02d}.md").read_text(encoding="utf-8")
            self.assertIn(f'mytorah-verses: "{refs}"', note)

    def test_find_parasha_by_metadata_or_filename_and_reject_ambiguity(self):
        vault = self.root / "vault"
        target = vault / "1 Berésit" / "Vájécé"
        target.mkdir(parents=True)
        (target / "HE.md").write_text("héber", encoding="utf-8")
        (target / "HU.md").write_text("# 29. fejezet\n**1.** a\n", encoding="utf-8")
        self.source.write_text("*Hetiszakasz: Vájecé (Berésit 28:10–32:3)*\n", encoding="utf-8")
        self.assertEqual(find_parasha(self.source, vault), target)
        self.source.write_text("", encoding="utf-8")
        self.assertEqual(find_parasha(self.source, vault, "vajece"), target)
        named = self.root / "vajece.md"
        named.write_text("", encoding="utf-8")
        self.assertEqual(find_parasha(named, vault), target)
        other = vault / "2 Másik" / "Vajece"
        other.mkdir(parents=True)
        (other / "HE.md").write_text("héber", encoding="utf-8")
        (other / "HU.md").write_text("# 29. fejezet\n**1.** a\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "nem egyértelmű"):
            find_parasha(named, vault)

    def test_cli_uses_content_path_and_inherits_without_mapping(self):
        vault = self.root / "vault"
        target = vault / "1 Berésit" / "Vájécé"
        target.mkdir(parents=True)
        (target / "HE.md").write_text("héber", encoding="utf-8")
        (target / "HU.md").write_text("# 29. fejezet\n**1.** a **2.** b\n", encoding="utf-8")
        self.source.write_text(
            "*Hetiszakasz: Vájecé (Berésit 28:10–32:3)*\n"
            "## 1. 29:1–2 – Első\n\nSzöveg\n\n## 2. Második\n\nSzöveg\n",
            encoding="utf-8",
        )
        result = subprocess.run(
            [sys.executable, str(SCRIPT), str(self.source)],
            cwd=self.root, env={**os.environ, "CONTENT_PATH": str(vault)},
            text=True, capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("előző szakaszból örökölve", result.stdout)
        self.assertIn('mytorah-verses: "29:1,29:2"',
                      (target / "perusim/notes-02.md").read_text(encoding="utf-8"))

    def test_literal_content_path_needs_no_node_and_respects_precedence(self):
        (self.root / ".env").write_text("CONTENT_PATH=/fallback\n", encoding="utf-8")
        (self.root / ".env.local").write_text('CONTENT_PATH="/vault with spaces" # comment\n', encoding="utf-8")
        (self.root / ".env.development.local").write_text("CONTENT_PATH=development\n", encoding="utf-8")
        with patch.object(import_commentary, "PROJECT_ROOT", self.root), \
             patch.dict(os.environ, {}, clear=True), \
             patch.object(import_commentary.subprocess, "run", side_effect=AssertionError("Node should not run")):
            self.assertEqual(content_path(), Path("/vault with spaces"))
            os.environ["NODE_ENV"] = "development"
            self.assertEqual(content_path(), self.root / "development")
            os.environ["CONTENT_PATH"] = "/from-process"
            self.assertEqual(content_path(), Path("/from-process"))
            os.environ["CONTENT_PATH"] = ""
            with self.assertRaisesRegex(ValueError, "nincs beállítva"):
                content_path()

    def test_complex_env_uses_next_and_reports_empty_stderr_failure(self):
        (self.root / ".env.local").write_text("CONTENT_PATH=$VAULT/data\n", encoding="utf-8")
        with patch.object(import_commentary, "PROJECT_ROOT", self.root), patch.dict(os.environ, {}, clear=True):
            with patch.object(import_commentary.subprocess, "run",
                              return_value=subprocess.CompletedProcess([], 0, stdout='"/expanded/data"', stderr="")):
                self.assertEqual(content_path(), Path("/expanded/data"))
            failure = subprocess.CalledProcessError(-9, ["node"], stderr="")
            with patch.object(import_commentary.subprocess, "run", side_effect=failure):
                with self.assertRaisesRegex(ValueError, r"kilépési kód: -9"):
                    content_path()

    def test_multiline_env_values_defer_to_next_parser(self):
        (self.root / ".env.local").write_text(
            'OTHER="first line\nCONTENT_PATH=/not-a-setting\nlast line"\nCONTENT_PATH=/correct\n',
            encoding="utf-8",
        )
        with patch.object(import_commentary, "PROJECT_ROOT", self.root), patch.dict(os.environ, {}, clear=True), \
             patch.object(import_commentary.subprocess, "run",
                          return_value=subprocess.CompletedProcess([], 0, stdout='"/correct"', stderr="")) as run:
            self.assertEqual(content_path(), Path("/correct"))
            run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
