#!/usr/bin/env python3
"""Checks the iOS module architecture without needing Swift or Xcode.

Rules (docs/IOS_ARCHITECTURE.md):
  1. Modules/modules.json lists exactly the Bible §24.4 modules, and each one
     has a Package.swift and at least one source file.
  2. Each Package.swift declares exactly the dependencies in modules.json.
  3. Dependencies point to a lower tier (foundation < platform < domain <
     feature < app). The same tier is allowed only for foundation and domain.
     Feature modules never depend on other feature modules.
  4. The dependency graph has no cycles.
  5. The provider Project.swift lists every module; the patient Project.swift
     uses only the modules in patientAppModules, and their dependency closure
     stays inside that set (spec §2.2).
  6. DesignSystem's DesignTokens.swift is identical to the generated copy in
     packages/design-tokens (single token source, ADR-0011).
Exit code 0 when every rule holds.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PROVIDER = ROOT / "apps" / "ios-provider"
MODULES_DIR = PROVIDER / "Modules"
PATIENT = ROOT / "apps" / "ios-patient"

BIBLE_24_4 = {
    "AppShell", "Authentication", "CoreNetworking", "CoreSecurity", "DesignSystem",
    "PatientDomain", "ConsultationDomain", "Photography", "Media", "Annotations",
    "BeforeAfter", "Simulation", "TreatmentPlans", "DocumentsConsent", "Education",
    "Appointments", "Messaging", "Telehealth", "Settings", "AuditSupport",
}
SAME_TIER_ALLOWED = {"foundation", "domain"}

failures: list[str] = []


def check(ok: bool, label: str) -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}")
    if not ok:
        failures.append(label)


def package_dependencies(package_swift: Path) -> list[str]:
    text = package_swift.read_text(encoding="utf-8")
    return re.findall(r'\.package\(\s*path:\s*"\.\./([A-Za-z]+)"\s*\)', text)


def swift_string_list(source: str, variable: str) -> list[str]:
    match = re.search(rf"let {variable} = \[(.*?)\]", source, re.S)
    return re.findall(r'"([A-Za-z]+)"', match.group(1)) if match else []


def main() -> int:
    meta = json.loads((MODULES_DIR / "modules.json").read_text(encoding="utf-8"))
    tiers: list[str] = meta["tiers"]
    modules: dict[str, dict] = meta["modules"]
    tier_rank = {tier: rank for rank, tier in enumerate(tiers)}

    # 1. Module set and files
    check(set(modules) == BIBLE_24_4, f"modules.json lists exactly the {len(BIBLE_24_4)} Bible §24.4 modules")
    on_disk = {p.name for p in MODULES_DIR.iterdir() if p.is_dir()}
    check(on_disk == set(modules), "Modules/ contains exactly the listed module directories")
    for name in sorted(modules):
        sources = list((MODULES_DIR / name / "Sources" / name).glob("*.swift"))
        check((MODULES_DIR / name / "Package.swift").is_file() and bool(sources), f"{name}: Package.swift and sources present")

    # 2. Package.swift matches modules.json
    for name, info in sorted(modules.items()):
        declared = package_dependencies(MODULES_DIR / name / "Package.swift")
        check(sorted(declared) == sorted(info["dependsOn"]), f"{name}: Package.swift dependencies match modules.json")

    # 3. Tier rules
    for name, info in sorted(modules.items()):
        tier = info["tier"]
        for dep in info["dependsOn"]:
            dep_tier = modules[dep]["tier"]
            lower = tier_rank[dep_tier] < tier_rank[tier]
            same_ok = dep_tier == tier and tier in SAME_TIER_ALLOWED
            check(lower or same_ok, f"{name} ({tier}) → {dep} ({dep_tier}) respects tier order")

    # 4. No cycles
    state: dict[str, int] = {}

    def visit(node: str, trail: list[str]) -> list[str] | None:
        if state.get(node) == 1:
            return trail + [node]
        if state.get(node) == 2:
            return None
        state[node] = 1
        for dep in modules[node]["dependsOn"]:
            cycle = visit(dep, trail + [node])
            if cycle:
                return cycle
        state[node] = 2
        return None

    cycle = next((c for c in (visit(m, []) for m in sorted(modules)) if c), None)
    check(cycle is None, "dependency graph is acyclic" + (f" (cycle: {' → '.join(cycle)})" if cycle else ""))

    # 5. App projects
    provider_listed = swift_string_list((PROVIDER / "Project.swift").read_text(encoding="utf-8"), "modules")
    check(sorted(provider_listed) == sorted(modules), "provider Project.swift lists every module")
    patient_listed = swift_string_list((PATIENT / "Project.swift").read_text(encoding="utf-8"), "sharedModules")
    allowed = set(meta["patientAppModules"])
    check(set(patient_listed) == allowed, "patient Project.swift uses exactly patientAppModules")
    closure: set[str] = set()
    stack = list(patient_listed)
    while stack:
        current = stack.pop()
        if current in closure or current not in modules:
            continue
        closure.add(current)
        stack.extend(modules[current]["dependsOn"])
    check(closure <= allowed, "patient app's dependency closure stays within patientAppModules")

    # 6. Design tokens copy
    generated = ROOT / "packages" / "design-tokens" / "generated" / "DesignTokens.swift"
    copy = MODULES_DIR / "DesignSystem" / "Sources" / "DesignSystem" / "DesignTokens.swift"
    check(copy.is_file() and copy.read_bytes() == generated.read_bytes(), "DesignSystem/DesignTokens.swift matches packages/design-tokens")

    print(f"\n{'FAILED' if failures else 'OK'}: {len(failures)} failing check(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
