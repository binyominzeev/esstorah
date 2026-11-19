#!/usr/bin/env python3
"""Import numbered Markdown sections into a parasha's perusim directory."""

import argparse
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path


HEADING = re.compile(r"^##\s+(\d+)\.\s+(.+?)\s*$", re.MULTILINE)
REFERENCE = re.compile(r"(?<!\d)(\d+):(\d+)(?:\s*[-–—]\s*(\d+))?(?![\d:])")
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def content_path():
    script = (
        "const {loadEnvConfig} = require('@next/env');"
        "loadEnvConfig(process.cwd(), process.env.NODE_ENV === 'development');"
        "process.stdout.write(JSON.stringify(process.env.CONTENT_PATH || ''));"
    )
    try:
        result = subprocess.run(
            ["node", "-e", script], cwd=PROJECT_ROOT, text=True,
            capture_output=True, check=True,
        )
    except FileNotFoundError as error:
        raise ValueError("A CONTENT_PATH beolvasásához Node.js szükséges.") from error
    except subprocess.CalledProcessError as error:
        raise ValueError(f"A Next.js környezetének beolvasása sikertelen: {error.stderr.strip()}") from error
    value = json.loads(result.stdout)
    if not value:
        raise ValueError("A CONTENT_PATH nincs beállítva. Állítsd be a projekt .env.local fájljában.")
    root = Path(value)
    return root if root.is_absolute() else PROJECT_ROOT / root


def normalize_name(name):
    return re.sub(
        r"[\s_-]+", " ",
        "".join(ch for ch in unicodedata.normalize("NFD", name.casefold())
                if not unicodedata.combining(ch)).strip(),
    )


def find_parasha(source, root, name=None):
    if not root.is_dir():
        raise ValueError(f"A CONTENT_PATH nem létező mappára mutat: {root}")
    text = source.read_text(encoding="utf-8")
    if name is None:
        metadata = re.search(r"(?im)^\s*\*?\s*Hetiszakasz:\s*([^(\n·*]+)", text)
        name = metadata.group(1).strip() if metadata else source.stem
    key = normalize_name(name)
    matches = [
        parasha for book in root.iterdir()
        if book.is_dir() and not book.name.startswith(".")
        for parasha in book.iterdir()
        if parasha.is_dir() and not parasha.name.startswith(".")
        and normalize_name(parasha.name) == key
        and (parasha / "HE.md").is_file() and (parasha / "HU.md").is_file()
    ]
    if not matches:
        raise ValueError(f"Nem található a(z) {name!r} hetiszakasz a CONTENT_PATH mappában; add meg a nevét --parasha kapcsolóval.")
    if len(matches) > 1:
        raise ValueError(f"A(z) {name!r} hetiszakasz nem egyértelmű: {', '.join(map(str, matches))}. Add meg a mappa útvonalát.")
    return matches[0]


def parse_refs(text):
    if re.search(r"\d+:\d+\s*[-–—]\s*\d+:\d+", text):
        raise ValueError("Fejezetek közötti tartomány helyett adj meg külön hivatkozásokat.")
    refs = []
    for match in REFERENCE.finditer(text):
        chapter, first = int(match[1]), int(match[2])
        last = int(match[3]) if match[3] else first
        if chapter < 1 or first < 1 or last < first or last - first > 200:
            raise ValueError(f"Érvénytelen vershivatkozás: {match[0]}")
        refs.extend((chapter, verse) for verse in range(first, last + 1))
    return list(dict.fromkeys(refs))


def parasha_verses(parasha):
    hu = (parasha / "HU.md").read_text(encoding="utf-8")
    chapter = 0
    verses = set()
    for line in hu.splitlines():
        heading = re.match(r"^# (\d+)\. fejezet", line)
        if heading:
            chapter = int(heading[1])
        for marker in re.finditer(r"\*\*(\d+)\.\*\*", line):
            verses.add((chapter, int(marker[1])))
    return verses


def import_notes(source, parasha, overrides, dry_run=False):
    if not (parasha / "HE.md").is_file() or not (parasha / "HU.md").is_file():
        raise ValueError(f"Nem található HE.md és HU.md ebben a hetiszakaszban: {parasha}")
    text = source.read_text(encoding="utf-8").replace("\r\n", "\n")
    headings = list(HEADING.finditer(text))
    if not headings:
        raise ValueError("Nem találhatók számozott '## 1. fejezet:vers – cím' szakaszok.")
    valid = parasha_verses(parasha)
    slug = unicodedata.normalize("NFKD", source.stem).encode("ascii", "ignore").decode().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    if not slug:
        raise ValueError("A forrásfájl nevéből nem képezhető azonosító.")
    directory = parasha / "perusim"
    outputs = []
    seen = set()
    previous_refs = []
    for i, heading in enumerate(headings):
        number = int(heading[1])
        if number in seen:
            raise ValueError(f"Ismétlődő szakaszszám: {number}")
        seen.add(number)
        end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
        body = text[heading.end():end]
        # An unnumbered level-two heading ends the last numbered section.
        unnumbered = re.search(r"^##\s+", body, re.MULTILINE)
        if unnumbered:
            body = body[:unnumbered.start()]
        body = re.sub(r"\n\s*---\s*$", "", body).strip()
        refs = parse_refs(overrides[number] if number in overrides else heading[2])
        inherited = not refs and number not in overrides
        if not refs:
            if not previous_refs or number in overrides:
                raise ValueError(f"A(z) {number}. szakasznak nincs hivatkozása és nincs mit örökölnie; add meg --map {number}=fejezet:vers formában.")
            refs = previous_refs
        if number in overrides and not re.fullmatch(r"\s*\d+:\d+(?:\s*[-–—]\s*\d+)?(?:\s*,\s*\d+:\d+(?:\s*[-–—]\s*\d+)?)*\s*", overrides[number]):
            raise ValueError(f"Érvénytelen --map érték: {overrides[number]}")
        missing = [f"{c}:{v}" for c, v in refs if (c, v) not in valid]
        if missing:
            raise ValueError(f"A(z) {number}. szakasz versei nem találhatók a hetiszakaszban: {', '.join(missing)}")
        previous_refs = refs
        filename = directory / f"{slug}-{number:02d}.md"
        ref_list = ",".join(f"{c}:{v}" for c, v in refs)
        content = f'---\nmytorah-verses: "{ref_list}"\n---\n\n## {heading[2]}\n\n{body}\n'
        outputs.append((filename, content, ref_list, inherited))
    unused = set(overrides) - seen
    if unused:
        raise ValueError(f"Nem létező szakaszhoz adott --map: {', '.join(map(str, sorted(unused)))}")
    existing = [str(file) for file, _, _, _ in outputs if file.exists()]
    if existing:
        raise ValueError(f"A célfájlok már léteznek, nem írom felül őket: {', '.join(existing)}")
    if not dry_run:
        directory.mkdir(exist_ok=True)
        for file, content, _, _ in outputs:
            with file.open("x", encoding="utf-8") as handle:
                handle.write(content)
    for file, _, refs, inherited in outputs:
        print(f"{'Előnézet' if dry_run else 'Importálva'}: {file} ({refs}{'; előző szakaszból örökölve' if inherited else ''})")
    print("A számozott szakaszokon kívüli bevezető és lezárás nem kerül importálásra.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="a számozott Markdown-jegyzet")
    parser.add_argument("parasha", type=Path, nargs="?", help="a hetiszakasz mappája (opcionális)")
    parser.add_argument("--parasha", dest="parasha_name", help="a hetiszakasz neve, ha nem derül ki a jegyzetből")
    parser.add_argument("--map", action="append", default=[], metavar="SZÁM=FEJEZET:VERS",
                        help="szakasz vershivatkozásának megadása vagy felülírása")
    parser.add_argument("--dry-run", action="store_true", help="ellenőrzés írás nélkül")
    args = parser.parse_args()
    try:
        overrides = {}
        for item in args.map:
            number, sep, refs = item.partition("=")
            if not sep or not number.isdigit() or int(number) in overrides:
                raise ValueError(f"Érvénytelen vagy ismétlődő --map: {item}")
            overrides[int(number)] = refs
        if args.parasha and args.parasha_name:
            raise ValueError("A hetiszakasz útvonala és a --parasha együtt nem adható meg.")
        parasha = args.parasha or find_parasha(args.source, content_path(), args.parasha_name)
        import_notes(args.source, parasha, overrides, args.dry_run)
    except (OSError, ValueError) as error:
        print(f"Importálási hiba: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
