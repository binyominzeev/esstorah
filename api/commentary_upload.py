"""Admin commentary preview/upload and public live commentary feed."""
import re
import sys
import threading
import os
import tempfile
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth_bookmarks import require_admin

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "content-sync"))
from import_commentary import content_path, find_parasha_text, normalize_name, parasha_verses, prepare_notes

router = APIRouter()
write_lock = threading.Lock()


def parasha_for_slug(slug):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", slug):
        raise HTTPException(404, "Ismeretlen hetiszakasz.")
    root = content_path().resolve()
    matches = [p for book in root.iterdir() if book.is_dir() and not book.name.startswith(".")
               for p in book.iterdir() if p.is_dir() and not p.name.startswith(".")
               and normalize_name(p.name).replace(" ", "-") == slug.lower()
               and (p / "HE.md").is_file() and (p / "HU.md").is_file()]
    if len(matches) != 1:
        raise HTTPException(404, "Ismeretlen vagy nem egyértelmű hetiszakasz.")
    parasha = matches[0].resolve()
    if not parasha.is_relative_to(root):
        raise ValueError("Érvénytelen hetiszakaszmappa.")
    return root, parasha


def edit_database(root):
    path = root / ".mytorah-edits.sqlite3"
    if path.is_symlink():
        raise ValueError("Érvénytelen szerkesztési adatbázis.")
    db = sqlite3.connect(path, timeout=10)
    db.execute("""CREATE TABLE IF NOT EXISTS edits (
        parasha TEXT NOT NULL, kind TEXT NOT NULL, item TEXT NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY (parasha, kind, item))""")
    return db


def original_edit(parasha, kind, item):
    if kind == "verse":
        match = re.fullmatch(r"([1-9]\d*):([1-9]\d*)", item)
        if not match:
            raise HTTPException(404, "Ismeretlen pászuk.")
        chapter, verse = map(int, match.groups())
        current = 0
        for line in (parasha / "HU.md").read_text(encoding="utf-8").splitlines():
            heading = re.match(r"^# (\d+)\. fejezet", line)
            if heading:
                current = int(heading[1])
            if current != chapter:
                continue
            markers = list(re.finditer(r"\*\*(\d+)\.\*\*", line))
            for index, marker in enumerate(markers):
                if int(marker[1]) == verse:
                    end = markers[index + 1].start() if index + 1 < len(markers) else len(line)
                    return {"markdown": line[marker.end():end].strip()}
        raise HTTPException(404, "Ismeretlen pászuk.")
    if kind != "commentary" or not item or item in (".", "..") or "/" in item or "\\" in item or "\x00" in item:
        raise HTTPException(404, "Ismeretlen kommentár.")
    directory = parasha / "perusim"
    file = directory / f"{item}.md"
    if directory.is_symlink() or file.is_symlink() or not file.is_file() or not file.resolve().is_relative_to(parasha):
        raise HTTPException(404, "Ismeretlen kommentár.")
    text = file.read_text(encoding="utf-8")
    text = re.sub(r"\A---\r?\n[\s\S]*?\r?\n---\r?\n", "", text).strip()
    heading = re.match(r"^(#{1,6})[ \t]+([^\r\n]+)(?:\r?\n|$)", text)
    if heading:
        return {"title": heading[2].strip(), "body": text[heading.end():].strip(), "level": len(heading[1])}
    return {"title": item.replace("-", " ").replace("_", " "), "body": text, "level": 2}


def revision(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


class Edit(BaseModel):
    revision: str = Field(min_length=64, max_length=64)
    markdown: str | None = Field(default=None, max_length=100_000)
    title: str | None = Field(default=None, max_length=1000)
    body: str | None = Field(default=None, max_length=100_000)


@router.get("/admin/content/{slug}/{kind}/{item}")
def get_edit(slug: str, kind: str, item: str, _: None = Depends(require_admin)):
    try:
        root, parasha = parasha_for_slug(slug)
        original = original_edit(parasha, kind, item)
        with closing(edit_database(root)) as db:
            row = db.execute("SELECT value FROM edits WHERE parasha=? AND kind=? AND item=?",
                             (str(parasha.relative_to(root)), kind, item)).fetchone()
        value = json.loads(row[0]) if row else original
        return {**value, "revision": revision(value)}
    except (ValueError, OSError, sqlite3.Error) as exc:
        raise HTTPException(503, f"A tartalom nem tölthető be: {exc}") from exc


@router.put("/admin/content/{slug}/{kind}/{item}")
def save_edit(slug: str, kind: str, item: str, edit: Edit, _: None = Depends(require_admin)):
    try:
        root, parasha = parasha_for_slug(slug)
        original = original_edit(parasha, kind, item)
        if kind == "verse":
            if edit.markdown is None or not edit.markdown.strip() or "\n" in edit.markdown or "\r" in edit.markdown or re.search(r"\*\*\d+\.\*\*", edit.markdown):
                raise HTTPException(422, "A fordítás egyetlen nem üres sor lehet, versszám nélkül.")
            value = {"markdown": edit.markdown.strip()}
        else:
            if edit.title is None or not edit.title.strip() or "\n" in edit.title or "\r" in edit.title or edit.body is None:
                raise HTTPException(422, "Adj meg egysoros címet és tartalmat.")
            value = {"title": edit.title.strip(), "body": edit.body, "level": original["level"]}
        if any("\x00" in part for part in value.values() if isinstance(part, str)):
            raise HTTPException(422, "A szöveg érvénytelen karaktert tartalmaz.")
        key = (str(parasha.relative_to(root)), kind, item)
        with closing(edit_database(root)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT value FROM edits WHERE parasha=? AND kind=? AND item=?", key).fetchone()
            current = json.loads(row[0]) if row else original
            if revision(current) != edit.revision:
                raise HTTPException(409, "A tartalom időközben megváltozott. Másold ki a módosításaidat, majd töltsd be újra.")
            db.execute("INSERT OR REPLACE INTO edits (parasha, kind, item, value) VALUES (?, ?, ?, ?)",
                       (*key, json.dumps(value, ensure_ascii=False)))
        return {**value, "revision": revision(value)}
    except (ValueError, OSError, sqlite3.Error) as exc:
        raise HTTPException(503, f"A tartalom nem menthető: {exc}") from exc


@router.get("/content-edits/{slug}")
def live_edits(slug: str):
    try:
        root, parasha = parasha_for_slug(slug)
        with closing(edit_database(root)) as db:
            rows = db.execute("SELECT kind, item, value FROM edits WHERE parasha=?",
                              (str(parasha.relative_to(root)),)).fetchall()
        return {"verses": {item: json.loads(value)["markdown"] for kind, item, value in rows if kind == "verse"},
                "commentaries": {item: json.loads(value) for kind, item, value in rows if kind == "commentary"}}
    except (ValueError, OSError, sqlite3.Error) as exc:
        raise HTTPException(503, f"A módosítások nem tölthetők be: {exc}") from exc


class Source(BaseModel):
    filename: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=1_000_000)


class Selection(BaseModel):
    number: int = Field(ge=1)
    markdown: str = Field(min_length=1, max_length=100_000)


class Upload(Source):
    selected: list[Selection] = Field(min_length=1, max_length=500)
    overwrite: bool = False


def plan(source: Source):
    if "/" in source.filename or "\\" in source.filename or not source.filename.lower().endswith(".md"):
        raise ValueError("Érvénytelen Markdown-fájlnév.")
    root = content_path().resolve()
    parasha = find_parasha_text(source.text, source.filename, root).resolve()
    if not parasha.is_relative_to(root):
        raise ValueError("A hetiszakasz mappája kívül esik a tartalommappán.")
    notes = prepare_notes(source.text, source.filename, parasha, {})
    if len(notes) > 500:
        raise ValueError("Túl sok kommentár egy fájlban.")
    return parasha, notes


@router.post("/admin/commentaries/preview")
def preview(source: Source, _: None = Depends(require_admin)):
    try:
        parasha, notes = plan(source)
        directory = parasha / "perusim"
        def existing(file):
            target = directory / f"web-{file.name}"
            return target.exists() or target.is_symlink()
        return {
            "parasha": parasha.name,
            "book": parasha.parent.name,
            "notes": [
                {
                    "number": number,
                    "refs": refs,
                    "markdown": content.split("---\n\n", 1)[1],
                    "existing": existing(file),
                }
                for file, content, refs, _, number in notes
            ],
        }
    except (ValueError, OSError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/admin/commentaries")
def upload(source: Upload, _: None = Depends(require_admin)):
    try:
        parasha, notes = plan(source)
        planned = {number: (file, refs) for file, _, refs, _, number in notes}
        numbers = [item.number for item in source.selected]
        if len(set(numbers)) != len(numbers) or any(number not in planned for number in numbers):
            raise ValueError("Érvénytelen szakaszválasztás.")
        directory = parasha / "perusim"
        if directory.is_symlink() or (directory.exists() and not directory.resolve().is_relative_to(parasha)):
            raise ValueError("Érvénytelen kommentármappa.")
        outputs = []
        for item in source.selected:
            file, refs = planned[item.number]
            markdown = item.markdown.strip()
            if not re.match(r"^##\s+\S", markdown):
                raise ValueError(f"A(z) {item.number}. kommentárnak második szintű címmel kell kezdődnie.")
            if "\x00" in markdown:
                raise ValueError("A szöveg érvénytelen karaktert tartalmaz.")
            target = directory / f"web-{file.name}"
            outputs.append((target, f'---\nmytorah-verses: "{refs}"\nmytorah-web: true\n---\n\n{markdown}\n'))
        with write_lock:
            directory.mkdir(exist_ok=True)
            unsafe = [target.name for target, _ in outputs if target.is_symlink()]
            if unsafe:
                raise ValueError(f"Érvénytelen meglévő szimbólikus hivatkozás: {', '.join(unsafe)}")
            conflicts = [target.name for target, _ in outputs if target.exists()]
            if conflicts:
                if not source.overwrite:
                    raise ValueError(f"A célfájlok már léteznek: {', '.join(conflicts)}")
            backups = {}
            written = []
            temp_files = []
            try:
                for target, content in outputs:
                    if target.exists() or target.is_symlink():
                        backups[target] = target.read_bytes()
                    with tempfile.NamedTemporaryFile(
                        mode="w", encoding="utf-8", dir=directory, prefix=".commentary-", delete=False
                    ) as handle:
                        handle.write(content)
                        temp_files.append(Path(handle.name))
                    os.replace(temp_files[-1], target)
                    written.append(target)
            except OSError:
                for target in written:
                    if target in backups:
                        target.write_bytes(backups[target])
                    else:
                        target.unlink(missing_ok=True)
                for temp in temp_files:
                    temp.unlink(missing_ok=True)
                raise
        return {"count": len(outputs), "parasha": parasha.name}
    except (ValueError, OSError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/commentaries/{slug}")
def live_commentaries(slug: str):
    try:
        _, parasha = parasha_for_slug(slug)
        directory = parasha / "perusim"
        if not directory.exists():
            return {"commentaries": []}
        if directory.is_symlink() or not directory.resolve().is_relative_to(parasha):
            raise ValueError("Érvénytelen kommentármappa.")
        valid = parasha_verses(parasha)
        result = []
        for file in sorted(directory.glob("web-*.md")):
            if file.is_symlink():
                raise ValueError("Érvénytelen kommentárfájl.")
            content = file.read_text(encoding="utf-8")
            match = re.match(r'^---\nmytorah-verses: "(\d+:\d+(?:,\d+:\d+)*)"\nmytorah-web: true\n---\n\n', content)
            if not match:
                raise ValueError(f"Érvénytelen feltöltött kommentár: {file.name}")
            refs = [tuple(map(int, ref.split(":"))) for ref in match[1].split(",")]
            if any(ref not in valid for ref in refs):
                raise ValueError(f"Érvénytelen vershivatkozás: {file.name}")
            result.append({"id": file.stem, "markdown": content[match.end():],
                           "verses": [{"chapter": c, "verse": v} for c, v in refs]})
        return {"commentaries": result}
    except (ValueError, OSError) as exc:
        raise HTTPException(503, f"A kommentárok nem tölthetők be: {exc}") from exc
