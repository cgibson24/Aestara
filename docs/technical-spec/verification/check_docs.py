#!/usr/bin/env python3
"""Checks the Layer 0 documentation pack (Bible §31, §35).

  1. Every document the Bible requires exists in docs/.
  2. Every "spec §x.y" reference in docs/*.md names a real heading of
     TECHNICAL_SPECIFICATION.md.
  3. Every Bible reference ("[B §x.y]", "Bible §x.y") names a real Bible
     section (read from the PDF, like check_traceability.py).
  4. Every relative Markdown link (and #anchor) resolves.
  5. No placeholder markers (TODO, TBD, FIXME, lorem ipsum) in the pack.

Usage:   pip install pypdf && python3 docs/technical-spec/verification/check_docs.py
Exit code 0 when every check passes.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[3]
DOCS = ROOT / "docs"
SPEC = DOCS / "TECHNICAL_SPECIFICATION.md"
BIBLE = ROOT / "Aesthetic_Platform_Software_Production_Bible_v1.0.pdf"

# Bible §31 deliverables 1-19 (5 = the Prisma schema) and the §35 pack.
REQUIRED = [
    "SYSTEM_ARCHITECTURE.md", "ARCHITECTURE_DECISIONS.md", "REPOSITORY_STRUCTURE.md",
    "DATABASE_SCHEMA.md", "technical-spec/schema.prisma", "API_CONTRACTS.md",
    "AUTHENTICATION_ARCHITECTURE.md", "AUTHORIZATION_RBAC.md", "PHOTO_ARCHITECTURE.md",
    "AI_ARCHITECTURE.md", "SECURITY_REQUIREMENTS.md", "THREAT_MODEL.md", "IOS_ARCHITECTURE.md",
    "DESIGN_SYSTEM.md", "TESTING_STRATEGY.md", "DEPLOYMENT.md", "INFRASTRUCTURE.md",
    "ACCEPTANCE_CRITERIA.md", "CHANGELOG.md",
    "SOFTWARE_PRODUCTION_BIBLE.md", "PRODUCT_REQUIREMENTS.md", "USER_ROLES_AND_PERMISSIONS.md",
    "WORKFLOWS.md", "AI_SIMULATION_RULES.md", "PHOTO_PROTOCOLS.md", "CONSENT_ARCHITECTURE.md",
    "EMR_INTEGRATIONS.md",
]

# The verbatim Bible export quotes the Bible's own words, so it is exempt
# from reference and placeholder checks.
REFERENCE_EXEMPT = {"SOFTWARE_PRODUCTION_BIBLE.md"}

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}")
    if not ok:
        failures.append(label)
        if detail:
            print(f"      {detail}")


def spec_sections() -> set[str]:
    numbers: set[str] = set()
    for line in SPEC.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^#{2,5} (\d+(?:\.\d+)*)\.?\s", line)
        if match:
            numbers.add(match.group(1))
    return numbers


def bible_sections() -> set[str]:
    numbers = {str(n) for n in range(0, 37)}  # §0-§36 top-level sections
    for page in PdfReader(str(BIBLE)).pages:
        for line in (page.extract_text() or "").splitlines():
            match = re.match(r"^(\d{1,2}\.\d{1,2}) \S", line.strip())
            if match:
                numbers.add(match.group(1))
    return numbers


SECTION = r"(\d+(?:\.\d+)*)(?:\s*[–-]\s*(\d+(?:\.\d+)*))?"


def expand(match: re.Match[str]) -> list[str]:
    first, second = match.group(1), match.group(2)
    if not second:
        return [first]
    # "§24.1–24.2" or "§4.3–4.7": the second number is a full section number.
    return [first, second]


def slugify(heading: str) -> str:
    text = re.sub(r"`|\*\*|\*|_", "", heading.strip().lower())
    text = re.sub(r"[^\w\- ]", "", text)
    return text.replace(" ", "-")


def anchors(path: Path) -> set[str]:
    seen: dict[str, int] = {}
    result: set[str] = set()
    in_code = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("```"):
            in_code = not in_code
            continue
        match = re.match(r"^#{1,6} (.+?)\s*#*$", line)
        if match and not in_code:
            slug = slugify(match.group(1))
            count = seen.get(slug, 0)
            result.add(slug if count == 0 else f"{slug}-{count}")
            seen[slug] = count + 1
    return result


def strip_code(text: str) -> str:
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    return re.sub(r"`[^`\n]*`", "", text)


def main() -> int:
    # 1. Pack completeness
    missing = [name for name in REQUIRED if not (DOCS / name).is_file()]
    check(not missing, f"Bible §31/§35 documentation pack is complete ({len(REQUIRED)} files)", f"missing: {missing}")

    spec_numbers = spec_sections()
    bible_numbers = bible_sections()
    docs = sorted(p for p in DOCS.glob("*.md") if p.name not in REFERENCE_EXEMPT)
    anchor_cache: dict[Path, set[str]] = {}

    bad_spec: list[str] = []
    bad_bible: list[str] = []
    bad_links: list[str] = []
    placeholders: list[str] = []

    for doc in docs:
        raw = doc.read_text(encoding="utf-8")
        text = strip_code(raw)
        rel = doc.relative_to(ROOT)

        # 2. spec § references (the spec itself uses bare "§" for its own sections)
        if doc != SPEC:
            for match in re.finditer(r"\bspec §" + SECTION, text):
                for number in expand(match):
                    if number not in spec_numbers:
                        bad_spec.append(f"{rel}: spec §{number}")

        # 3. Bible references: "[B §…]" brackets and "Bible §…"
        for bracket in re.finditer(r"\[B ([^\]]+)\]", text):
            # "[B §26; spec §7.6]": only the part before a "spec" reference is Bible.
            bible_part = re.split(r"\bspec §", bracket.group(1))[0]
            for match in re.finditer(r"§" + SECTION, bible_part):
                for number in expand(match):
                    if number not in bible_numbers:
                        bad_bible.append(f"{rel}: [B §{number}]")
        for match in re.finditer(r"\bBible §" + SECTION, text):
            for number in expand(match):
                if number not in bible_numbers:
                    bad_bible.append(f"{rel}: Bible §{number}")

        # 4. Relative links
        for match in re.finditer(r"\]\(([^)\s]+)\)", text):
            target = match.group(1)
            if re.match(r"^[a-z]+:", target):
                continue
            path_part, _, anchor = target.partition("#")
            dest = (doc.parent / path_part).resolve() if path_part else doc
            if not dest.exists():
                bad_links.append(f"{rel}: {target} (no such file)")
                continue
            if anchor and dest.suffix == ".md":
                anchor_cache.setdefault(dest, anchors(dest))
                if anchor not in anchor_cache[dest]:
                    bad_links.append(f"{rel}: {target} (no such heading)")

        # 5. Placeholders
        for match in re.finditer(r"\b(TODO|TBD|FIXME)\b|lorem ipsum", text, re.I):
            line_no = raw[: raw.find(match.group(0))].count("\n") + 1
            placeholders.append(f"{rel}:{line_no}: {match.group(0)}")

    check(not bad_spec, "every spec § reference resolves to a spec heading", "; ".join(bad_spec[:20]))
    check(not bad_bible, "every Bible § reference resolves to a Bible section", "; ".join(bad_bible[:20]))
    check(not bad_links, "every relative link and anchor resolves", "; ".join(bad_links[:20]))
    check(not placeholders, "no placeholder markers (TODO/TBD/FIXME/lorem ipsum)", "; ".join(placeholders[:20]))

    print(f"\n{len(docs)} documents checked · {'FAILED' if failures else 'OK'}: {len(failures)} failing check(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
