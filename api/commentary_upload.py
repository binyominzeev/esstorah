"""Admin commentary preview/upload and public live commentary feed."""
import re
import sys
import threading
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth_bookmarks import require_admin

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "content-sync"))
from import_commentary import content_path, find_parasha_text, normalize_name, parasha_verses, prepare_notes

router = APIRouter()
write_lock = threading.Lock()


class Source(BaseModel):
    filename: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=1_000_000)


class Selection(BaseModel):
    number: int = Field(ge=1)
    markdown: str = Field(min_length=1, max_length=100_000)


class Upload(Source):
    selected: list[Selection] = Field(min_length=1, max_length=500)


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
        return {
            "parasha": parasha.name,
            "book": parasha.parent.name,
            "notes": [
                {"number": number, "refs": refs, "markdown": content.split("---\n\n", 1)[1]}
                for _, content, refs, _, number in notes
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
            conflicts = [target.name for target, _ in outputs if target.exists() or target.is_symlink()]
            if conflicts:
                raise ValueError(f"A célfájlok már léteznek: {', '.join(conflicts)}")
            written = []
            try:
                for target, content in outputs:
                    with target.open("x", encoding="utf-8") as handle:
                        written.append(target)
                        handle.write(content)
            except OSError:
                for target in written:
                    target.unlink(missing_ok=True)
                raise
        return {"count": len(outputs), "parasha": parasha.name}
    except (ValueError, OSError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/commentaries/{slug}")
def live_commentaries(slug: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", slug):
        raise HTTPException(404, "Ismeretlen hetiszakasz.")
    try:
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
