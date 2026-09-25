#!/usr/bin/env python3
"""
Traceability check: Production Bible  ->  Technical Specification + draft schema.

Reads the Bible PDF directly (not a hand-copied list), extracts its canonical
lists (entities, permissions, audit events, state machines, resources, roles,
enumerations, required fields) and verifies that each item is represented in
docs/TECHNICAL_SPECIFICATION.md and docs/technical-spec/schema.prisma.
It also checks the spec's internal consistency (every permission, audit event
and state named in its tables exists in the catalogs / enums).

Usage:   pip install pypdf && python3 docs/technical-spec/verification/check_traceability.py
Exit 0 = every check passed; exit 1 = at least one failure (details printed).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[3]
BIBLE = ROOT / "Aesthetic_Platform_Software_Production_Bible_v1.0.pdf"
SPEC = ROOT / "docs" / "TECHNICAL_SPECIFICATION.md"
SCHEMA = ROOT / "docs" / "technical-spec" / "schema.prisma"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))


# --------------------------------------------------------------------------- #
# Load sources
# --------------------------------------------------------------------------- #
def bible_text() -> str:
    reader = PdfReader(str(BIBLE))
    lines: list[str] = []
    for page in reader.pages:
        for line in (page.extract_text() or "").splitlines():
            # Strip running headers/footers so lists spanning pages stay contiguous.
            if line.startswith("Aesthetic Platform - Software Production Bible") or line.startswith(
                "Confidential Product Specification | Page"
            ):
                continue
            # U+F0B7 is the PDF's bullet glyph.
            lines.append(line.replace("\uf0b7 ", "").replace("\uf0b7", "").rstrip())
    return "\n".join(lines)


def section(text: str, start: str, end: str) -> str:
    i = text.index(start)
    j = text.index(end, i + len(start))
    return text[i + len(start) : j]


B = bible_text()
S = SPEC.read_text()
P = SCHEMA.read_text()

models = set(re.findall(r"^model (\w+) \{", P, re.M))
enums = {
    name: re.findall(r"^\s+([A-Z][A-Z0-9_]*)\s*$", body, re.M)
    for name, body in re.findall(r"^enum (\w+) \{(.*?)^\}", P, re.M | re.S)
}


def model_fields(model: str) -> set[str]:
    body = re.search(rf"^model {model} \{{(.*?)^\}}", P, re.M | re.S).group(1)
    return set(re.findall(r"^\s+(\w+)\s+\S", body, re.M))


# --------------------------------------------------------------------------- #
# 1. Canonical data model (Bible 19) -> Prisma models + spec catalog
# --------------------------------------------------------------------------- #
region = section(B, "Domain Entities", "19.1 Global data rules")
headers = [
    "Identity & tenancy", "Provider & patient", "Scheduling & consultation", "Photography",
    "AI", "Documents", "Communication", "Integration & audit", "Commercial/config",
]
for h in headers:
    region = re.sub(rf"^{re.escape(h)} ", "", region, flags=re.M)
bible_entities = re.findall(r"\b([A-Z][A-Za-z]+)\b", region)
check("B19 entity count is 70", len(bible_entities) == 70, f"parsed {len(bible_entities)}")
missing = [e for e in bible_entities if e not in models]
check("B19 every entity exists as a Prisma model", not missing, f"missing: {missing}")
missing = [e for e in bible_entities if not re.search(rf"^\| (✚ )?{e} \|", S, re.M)]
check("B19 every entity appears in spec entity catalog (5.2)", not missing, f"missing: {missing}")
catalog = set(re.findall(r"^\| (?:✚ )?([A-Z][A-Za-z]+) \| ", section(S, "### 5.2 Entity catalog", "### 5.3"), re.M)) - {"Entity"}
check("Spec catalog lists exactly the Prisma models", catalog == models,
      f"only in spec: {sorted(catalog - models)}; only in schema: {sorted(models - catalog)}")
additions = models - set(bible_entities)
marked = set(re.findall(r"^\| ✚ ([A-Z][A-Za-z]+) \|", S, re.M))
check("Every non-Bible table is marked as an addition (✚)", additions == marked,
      f"unmarked: {sorted(additions - marked)}; wrongly marked: {sorted(marked - additions)}")

# --------------------------------------------------------------------------- #
# 2. Permissions (Bible 3.3)
# --------------------------------------------------------------------------- #
region = section(B, "3.3 Permission model", "Roles grant permissions")
tokens = region.split()
perms: list[str] = []
i = 0
while i < len(tokens):
    t = tokens[i]
    if t == "/" and perms:
        stem = perms[-1].rsplit(".", 1)[0]
        perms.append(f"{stem}.{tokens[i + 1]}")
        i += 2
        continue
    if re.fullmatch(r"[a-z]+(\.[a-z]+)+", t):
        perms.append(t)
    i += 1
check("B3.3 permission count is 41", len(perms) == 41, f"parsed {len(perms)}")
missing = [p for p in perms if f"`{p}`" not in section(S, "### 4.4 Permission catalog", "**Gaps")]
check("B3.3 every permission in spec catalog (4.4)", not missing, f"missing: {missing}")
matrix = section(S, "### 4.5 Proposed default role", "### 4.6")
missing = [p for p in perms if not re.search(rf"^\| {re.escape(p)} \|", matrix, re.M)]
check("B3.3 every permission has a row in the role matrix (4.5)", not missing, f"missing: {missing}")

proposed = set(re.findall(r"`([a-z]+(?:\.[a-z]+)+)`", section(S, "**Gaps", "### 4.5")))
used = set(re.findall(r"\b([a-z]+(?:\.[a-z]+)+)\*(?!\*)", S))
check("Every permission marked * in API tables is a proposed key", used <= proposed,
      f"unknown: {sorted(used - proposed)}")
api = section(S, "### 6.3 Endpoint catalog", "### 6.4")
api_perms = set(re.findall(r"\b((?:patient|photo|consultation|simulation|treatmentplan|consent|message|appointment|"
                           r"telehealth|user|role|practice|content|integration|audit)\.[a-z.]+[a-z])\b", api))
check("Every Bible-namespace permission in API tables exists in B3.3", api_perms <= set(perms),
      f"unknown: {sorted(api_perms - set(perms))}")

# --------------------------------------------------------------------------- #
# 3. Roles (Bible 3.2)
# --------------------------------------------------------------------------- #
region = section(B, "Role Typical scope", "3.3 Permission model")
bible_roles = re.findall(r"^([A-Z_]+(?: / [A-Z_]+)*) ", region, re.M)
role_keys = [r.replace(" / ", "_") for r in bible_roles]
check("B3.2 role count is 10", len(role_keys) == 10, f"parsed {role_keys}")
missing = [r for r in role_keys if f"`{r}`" not in section(S, "### 4.3 Roles", "### 4.4")]
check("B3.2 every role is a system role key (4.3)", not missing, f"missing: {missing}")

# --------------------------------------------------------------------------- #
# 4. Audit events (Bible 22.1) - rule: underscore token = complete name,
#    bare word = line prefix + word; documented alias PERMISSION_CHANGED.
# --------------------------------------------------------------------------- #
region = section(B, "22.1 Minimum audit events", "22.2 Audit event contents")
events: list[str] = []
for line in region.splitlines():
    parts = [p.strip() for p in line.split("/") if p.strip()]
    if not parts:
        continue
    prefix = parts[0].rsplit("_", 1)[0]  # e.g. INTEGRATION_SYNC_STARTED -> INTEGRATION_SYNC
    events.append(parts[0])
    for p in parts[1:]:
        events.append(p if "_" in p or p == "LOGOUT" else f"{prefix}_{p}")
alias = {"PERMISSION_CHANGED": "PHOTO_PERMISSION_CHANGED"}
events = [alias.get(e, e) for e in events]
check("B22.1 audit event count is 36", len(events) == 36, f"parsed {len(events)}")
missing = [e for e in events if e not in enums["AuditAction"]]
check("B22.1 every audit event exists in AuditAction enum", not missing, f"missing: {missing}")
missing = [e for e in events if e not in section(S, "### 7.3 Audit event catalog", "**Proposed additional events")]
check("B22.1 every audit event listed in spec 7.3", not missing, f"missing: {missing}")
extra = [e for e in enums["AuditAction"] if e not in events]
proposed_audit = section(S, "**Proposed additional events", "**Event contents")
missing = [e for e in extra if e not in proposed_audit]
check("Every non-Bible audit action is justified in spec 7.3", not missing, f"unjustified: {missing}")
used_events = set(re.findall(r"\b([A-Z]+(?:_[A-Z]+)+)\*(?!\*)", S))  # "**" is markdown bold
check("Every audit event marked * in API tables is a proposed event", used_events <= set(extra),
      f"unknown: {sorted(used_events - set(extra))}")
audit_cols = set(re.findall(r"\b([A-Z]{3,}(?:_[A-Z]+)+)\b", api))
event_like = {e for e in audit_cols if e.split("_")[0] in {
    "LOGIN", "LOGOUT", "PATIENT", "PHOTO", "CONSULTATION", "SIMULATION", "CONSENT", "MESSAGE", "ATTACHMENT",
    "USER", "ROLE", "INTEGRATION", "DATA", "SECURITY", "ACCESS", "MEDIA", "BEFORE", "SIMILAR", "AI",
    "TREATMENT", "DOCUMENT", "CONTENT", "INSTRUCTION", "APPOINTMENT", "TELEHEALTH", "CONFIGURATION"}}
event_like -= {"PHOTO_ANNOTATED"} if "PHOTO_ANNOTATED" in enums["AuditAction"] else set()
unknown = sorted(e for e in event_like if e not in enums["AuditAction"] and not e.endswith("_NOT_FOUND")
                 and e not in {"DOCUMENT_VIEWED", "PATIENT_APP", "SIGNED_CONSENT", "SENT_TO_PATIENT",
                               "RELEASED_TO_PATIENT", "READY_FOR_PROVIDER_REVIEW", "REQUEST_RETAKE",
                               "DISPLAY_PREVIEW", "INVALID_STATE_TRANSITION", "SOCIAL_MEDIA", "PAID_ADVERTISING",
                               "IN_PROGRESS", "ACCESS_DENIED"})
check("Audit events named in API tables exist in AuditAction", not unknown, f"unknown: {unknown}")

# Layer 1 subsets (Bible 32)
region = section(B, "INITIAL PERMISSIONS:", "REQUIRED AUDIT EVENTS:")
l1_perms = re.findall(r"[a-z]+\.[a-z]+", region)
check("B32 Layer 1 permissions (13) are all in the catalog", len(l1_perms) == 13 and set(l1_perms) <= set(perms),
      f"parsed {l1_perms}")
region = section(B, "REQUIRED AUDIT EVENTS:", "LAYER 1 ACCEPTANCE:")
l1_events = re.findall(r"[A-Z_]{4,}", region)
check("B32 Layer 1 audit events (11) are all in AuditAction", len(l1_events) == 11
      and set(l1_events) <= set(enums["AuditAction"]), f"parsed {l1_events}")

# --------------------------------------------------------------------------- #
# 5. State machines (Appendix A) - exact set equality with Prisma enums
# --------------------------------------------------------------------------- #
region = section(B, "Object Canonical states", "Appendix B")
objects = {
    "Consultation": "ConsultationStatus", "Simulation": "SimulationStatus", "Treatment Plan": "TreatmentPlanStatus",
    "Consent": "ConsentStatus", "Photo Permission": "PhotoPermissionState", "Appointment": "AppointmentStatus",
    "Message": "MessageStatus", "Telehealth": "TelehealthStatus", "Integration Sync": "SyncStatus",
}
pattern = "|".join(re.escape(o) for o in objects)
chunks = re.split(rf"^({pattern}) ", region, flags=re.M)
parsed_states = {chunks[k]: set(re.findall(r"[A-Z][A-Z_]+", chunks[k + 1])) for k in range(1, len(chunks), 2)}
check("Appendix A: 9 state machines parsed", len(parsed_states) == 9, f"parsed {list(parsed_states)}")
for obj, enum_name in objects.items():
    got = set(enums[enum_name])
    want = parsed_states.get(obj, set())
    check(f"Appendix A {obj} states == enum {enum_name}", got == want,
          f"missing: {sorted(want - got)}; extra: {sorted(got - want)}")

all_enum_values = {v for vals in enums.values() for v in vals}
sm = section(S, "### 5.4 State machines", "### 5.5")
state_tokens = set(re.findall(r"\b([A-Z]{2,}(?:_[A-Z]+)*)\b", sm))
ignore = {"B", "P", "UD", "DB", "PDF", "SHA", "ID", "IDs", "AI", "PATIENT_APP", "API", "UI", "Src", "UUID"}
ignore |= set(enums["AuditAction"]) | {"POST", "GET", "PUT", "PATCH", "DELETE"}
ignore |= set(re.findall(r"`([A-Z_]+)`", section(S, "### 6.2 Error code catalog", "### 6.3")))
unknown = sorted(t for t in state_tokens - ignore if t not in all_enum_values and not t.startswith("UD"))
check("Every state named in spec 5.4 exists in some Prisma enum", not unknown, f"unknown: {unknown}")

# --------------------------------------------------------------------------- #
# 6. API resource map (Bible 20.2)
# --------------------------------------------------------------------------- #
region = section(B, "20.2 Resource map", "20.3 Contract rules")
resources = re.findall(r"^(/[a-z\-/:]+)$", region, re.M)
check("B20.2 resource count is 22", len(resources) == 22, f"parsed {len(resources)}")
missing = []
for r in resources:
    spec_path = r.replace("/patients/:id", "/patients/{pid}")
    leaf = spec_path.rsplit("/", 1)[-1]
    in_heading = re.search(rf"^#### .*`{re.escape(spec_path)}", S, re.M)
    in_rows = re.search(rf"`[A-Z]+[^`]*(?:{re.escape(spec_path)}|…/{re.escape(leaf)})\b", S)
    if not (in_heading or in_rows):
        missing.append(r)
check("B20.2 every resource has endpoints in spec 6.3", not missing, f"missing: {missing}")
check("B20.1 namespace /api/v1 used", "`/api/v1/...`" in S)
b204 = "The requested patient could not be accessed."
check("B20.4 error envelope example preserved verbatim", b204 in S)

# --------------------------------------------------------------------------- #
# 7. Enumerations the Bible defines
# --------------------------------------------------------------------------- #
region = section(B, "7.1 Independent permission categories", "7.2 Permission states")
cats = re.findall(r"[A-Z][A-Z_]+", region)
check("B7.1 media permission categories == enum", set(cats) == set(enums["MediaPermissionCategory"]),
      f"bible {cats}")

region = section(B, "ORIGINAL (immutable)", "Original assets are never")
kinds = [k for k in re.findall(r"[A-Z][A-Z_]+", region) if k != "ANNOTATION_LAYER"]
check("B6.6 derivative kinds == enum (ANNOTATION_LAYER = PhotoAnnotation model)",
      set(kinds) == set(enums["DerivativeKind"]) and "PhotoAnnotation" in models, f"bible {kinds}")

region = section(B, "18.2 Canonical resources", "18.3 Sync states")
res = [re.sub(r"(?<!^)(?=[A-Z])", "_", w).upper() for w in re.findall(r"[A-Z][A-Za-z]+", region)]
check("B18.2 canonical resources == enum", set(res) == set(enums["CanonicalResourceType"]), f"bible {res}")

region = section(B, "Category Provider controls / restrictions", "9.7 Model registry")
rows = re.findall(r"^(Lip filler|Rhinoplasty|Botulinum|Cheek|Facelift|Breast|Skin)", region, re.M)
check("B9.6 simulation category rows (7) == enum size", len(rows) == 7 == len(enums["SimulationCategory"]),
      f"rows {rows}")

region = section(B, "12.1 Consent builder", "12.2 Consent versioning")
blocks = [b.strip() for b in region.splitlines() if b.strip()]
table = section(S, "**Consent builder block types", "**Live capture guidance codes")
missing = [b for b in blocks if f"| {b} |" not in table]
check("B12.1 all 13 consent builder elements mapped", len(blocks) == 13 and not missing, f"missing: {missing}")

region = section(B, "Content types include", "Track assigned")
check("B12.5 education content types == enum (9)", len(enums["EducationContentType"]) == 9
      and all(w in region.lower() for w in ["video", "image", "animation", "text", "pdf", "procedure explanation",
                                            "faq", "pre-op instruction", "post-op instruction"]))
check("B12.5 assignment states == enum", set(enums["ContentAssignmentStatus"]) ==
      {"ASSIGNED", "OPENED", "VIEWED", "COMPLETED", "ACKNOWLEDGED"})

region = section(B, "6.4 Live guidance vocabulary", "6.5 Ghost alignment")
codes = []
for line in region.splitlines():
    line = line.strip().replace(" - ", "_")
    if not line:
        continue
    words = line.split()
    if "/" in words:
        k = words.index("/")
        head, alt = words[:k], words[k + 1]
        codes.append("_".join(head))
        codes.append("_".join(head[:-1] + [alt]) if len(head) > 1 else alt)
        rest = words[k + 2:]
        if rest:  # e.g. MOVE CLOSER / BACK, RAISE / LOWER CHIN
            codes[-2] = "_".join(head + rest)
            codes[-1] = "_".join(([alt] if len(head) == 1 else head[:-1] + [alt]) + rest)
    else:
        codes.append("_".join(words))
missing = [c for c in codes if f"`{c}`" not in S]
check("B6.4 all live-guidance phrases have codes in spec", len(codes) == 13 and not missing,
      f"parsed {codes}; missing {missing}")

# --------------------------------------------------------------------------- #
# 8. Required fields
# --------------------------------------------------------------------------- #
pf = model_fields("Patient")
need = {"id", "organizationId", "primaryPracticeId", "firstName", "middleName", "lastName", "preferredName",
        "dateOfBirth", "email", "phone", "mrn", "externalEmrIdentifier", "status", "createdAt", "updatedAt",
        "createdById", "updatedById"}
check("B4.2 Patient minimum fields present", need <= pf, f"missing: {sorted(need - pf)}")
check("B4.2 Patient status values", set(enums["PatientStatus"]) == {"ACTIVE", "INACTIVE", "ARCHIVED", "DECEASED"})

af = model_fields("Appointment")
need = {"patientId", "practiceId", "locationId", "providerUserId", "appointmentTypeId", "startsAt", "endsAt",
        "timezone", "status", "reason", "consultationId", "procedureId", "sourceSystem", "externalId"}
check("B15.1 Appointment fields present", need <= af, f"missing: {sorted(need - af)}")

sv, si = model_fields("SimulationVersion"), model_fields("Simulation")
prov = {
    "source asset IDs": "SimulationVersionSource" in models,
    "procedure/treatment region": {"procedureKey", "treatmentRegion"} <= si,
    "model ID and version": "modelVersionId" in sv,
    "inference config + parameters": "inferenceConfig" in sv and "SimulationParameter" in models,
    "mask reference": "maskObjectId" in sv,
    "output asset ID": "outputDerivativeId" in sv,
    "timestamps": {"createdAt", "completedAt"} <= sv,
    "generating user": "generatedById" in sv,
    "reviewing provider": "reviewerUserId" in model_fields("SimulationApproval"),
    "approval and release events": {"SIMULATION_APPROVED", "SIMULATION_RELEASED"} <= set(enums["AuditAction"])
                                   and {"releasedAt", "releasedById"} <= si,
}
check("B9.4 all simulation provenance items stored", all(prov.values()),
      f"missing: {[k for k, v in prov.items() if not v]}")

ae = model_fields("AuditEvent")
need = {"actorUserId", "actorType", "organizationId", "resourceType", "resourceId", "action", "occurredAt",
        "requestId", "sessionId", "deviceId"}
check("B22.2 audit event contents present", need <= ae, f"missing: {sorted(need - ae)}")

tp, ti = model_fields("TreatmentPlan"), model_fields("TreatmentPlanItem")
need_i = {"treatmentId", "area", "providerUserId", "description", "quantity", "unitPrice", "discountAmount",
          "lineTotal", "notes", "proposedDate"}
check("B11.1 treatment plan composition present", need_i <= ti and {"estimatedTotal", "financingReference"} <= tp,
      f"missing item fields: {sorted(need_i - ti)}")
check("B16.2 no recording field on TelehealthSession",
      not any("record" in f.lower() for f in model_fields("TelehealthSession")))
check("B14.3 Notification has no free-text content field",
      not ({"body", "text", "content", "message", "payload"} & model_fields("Notification")))

# --------------------------------------------------------------------------- #
# 9. Surfaces: patient-app navigation (13.1) and patient profile tabs (4.3)
# --------------------------------------------------------------------------- #
portal = {"Home": "/portal/home", "My Consultation": "/portal/consultations", "My Simulations": "/portal/simulations",
          "My Photos": "/portal/photos", "My Treatment Plans": "/portal/treatment-plans",
          "My Procedures": "/portal/procedures", "My Documents": "/portal/documents",
          "My Instructions": "/portal/instructions", "Appointments": "/portal/appointments",
          "Messages": "/portal/message-threads", "Telehealth": "/portal/telehealth", "Profile": "/portal/profile"}
region = section(B, "13.1 Navigation", "13.2 Visibility rule")
nav = [n.strip() for n in region.splitlines() if n.strip()]
missing = [n for n in nav if n not in portal or portal[n] not in S]
check("B13.1 every patient-app screen has a portal endpoint", len(nav) == 12 and not missing, f"missing: {missing}")

tabs = {"Overview": "GET /patients/{pid}`", "Timeline": "/timeline", "Consultations": "…/consultations",
        "Photos": "…/photos", "Before / After": "…/before-after", "AI Simulations": "…/simulations",
        "Treatment Plans": "…/treatment-plans", "Procedures": "/patients/{pid}/procedures",
        "Documents": "…/documents", "Instructions": "…/instructions", "Appointments": "/patients/{pid}/appointments",
        "Messages": "/patients/{pid}/message-threads"}
region = section(B, "4.3 Patient profile", "Opening a patient requires")
prof = [t.strip() for t in region.splitlines() if t.strip()]
missing = [t for t in prof if t not in tabs or tabs[t] not in S]
check("B4.3 every patient-profile tab has an endpoint", len(prof) == 12 and not missing, f"missing: {missing}")

# --------------------------------------------------------------------------- #
# 10. Section coverage: every Bible section is referenced by the spec
# --------------------------------------------------------------------------- #
bible_sections = sorted({int(n) for n in re.findall(r"^(\d{1,2})\. [A-Z]", B, re.M) if int(n) <= 36})
refs = set(int(n) for n in re.findall(r"§(\d{1,2})(?:[.\s,\]\)–]|$)", S))
missing = [n for n in bible_sections if n not in refs]
check("Every Bible section 0-36 is referenced in the spec", len(bible_sections) == 37 and not missing,
      f"sections parsed {len(bible_sections)}; unreferenced: {missing}")
check("Appendix A referenced", "Appendix A" in S)

# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #
width = max(len(n) for n, _, _ in results)
failed = 0
for name, ok, detail in results:
    print(f"{'PASS' if ok else 'FAIL'}  {name.ljust(width)}  {'' if ok else detail}")
    failed += not ok
print(f"\n{len(results) - failed}/{len(results)} traceability checks passed")
sys.exit(1 if failed else 0)
