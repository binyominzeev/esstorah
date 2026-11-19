#!/usr/bin/env python3
"""Import numbered Markdown sections into a parasha's perusim directory."""

import argparse
import re
import sys
import unicodedata
from pathlib import Path


HEADING = re.compile(r"^##\s+(\d+)\.\s+(.+?)\s*$", re.MULTILINE)
REFERENCE = re.compile(r"(?<!\d)(\d+):(\d+)(?:\s*[-–—]\s*(\d+))?(?![\d:])")


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
        if not refs:
            raise ValueError(f"A(z) {number}. szakasznak nincs hivatkozása; add meg --map {number}=fejezet:vers formában.")
        if number in overrides and not re.fullmatch(r"\s*\d+:\d+(?:\s*[-–—]\s*\d+)?(?:\s*,\s*\d+:\d+(?:\s*[-–—]\s*\d+)?)*\s*", overrides[number]):
            raise ValueError(f"Érvénytelen --map érték: {overrides[number]}")
        missing = [f"{c}:{v}" for c, v in refs if (c, v) not in valid]
        if missing:
            raise ValueError(f"A(z) {number}. szakasz versei nem találhatók a hetiszakaszban: {', '.join(missing)}")
        filename = directory / f"{slug}-{number:02d}.md"
        ref_list = ",".join(f"{c}:{v}" for c, v in refs)
        content = f'---\nmytorah-verses: "{ref_list}"\n---\n\n## {heading[2]}\n\n{body}\n'
        outputs.append((filename, content, ref_list))
    unused = set(overrides) - seen
    if unused:
        raise ValueError(f"Nem létező szakaszhoz adott --map: {', '.join(map(str, sorted(unused)))}")
    existing = [str(file) for file, _, _ in outputs if file.exists()]
    if existing:
        raise ValueError(f"A célfájlok már léteznek, nem írom felül őket: {', '.join(existing)}")
    if not dry_run:
        directory.mkdir(exist_ok=True)
        for file, content, _ in outputs:
            with file.open("x", encoding="utf-8") as handle:
                handle.write(content)
    for file, _, refs in outputs:
        print(f"{'Előnézet' if dry_run else 'Importálva'}: {file} ({refs})")
    print("A számozott szakaszokon kívüli bevezető és lezárás nem kerül importálásra.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="a számozott Markdown-jegyzet")
    parser.add_argument("parasha", type=Path, help="a vault hetiszakasz-mappája")
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
        import_notes(args.source, args.parasha, overrides, args.dry_run)
    except (OSError, ValueError) as error:
        print(f"Importálási hiba: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
