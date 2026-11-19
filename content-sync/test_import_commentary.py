import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from import_commentary import import_notes


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


if __name__ == "__main__":
    unittest.main()
