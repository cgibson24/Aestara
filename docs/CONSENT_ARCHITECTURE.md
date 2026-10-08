# Consent architecture

| | |
|---|---|
| Version | 1.0 |
| Status | Layer 0 baseline, 2026-09-28 |
| Authority | Production Bible §7.1 (clinical consent never implies media permission), §11.1 (plan acceptance is not consent), §12 (documents, consents, instructions, education), §13.3 (patient actions), §21.1 (re-authentication), §22.1 (audit), §23 (offline), §30, §36 ("versioned templates; immutable signed snapshot/hash; audit"). ADR-0008 (spec proposals and delegated baselines). |
| Normative sources | [`TECHNICAL_SPECIFICATION.md`](TECHNICAL_SPECIFICATION.md) §1.4 (G9), §4.4, §4.7, §5.2 (Documents, consents, instructions & education), §5.4.4, §5.4.10, §6.3 (Documents, consents…; Consent templates), §6.5, §6.6.6 (consent builder block types), §7.3, §8, §10.2 (UD-23, UD-31); [`schema.prisma`](technical-spec/schema.prisma) section 6; [`constraints.sql`](technical-spec/constraints.sql) Layer 4 fragment; [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) C11, C13 |

This document describes how consent templates are built and versioned, how a consent moves from assignment to a completed, immutable signed snapshot, how void and supersede work, how in-clinic signing hands the device to the patient safely, and how education and instructions are assigned. It organizes the normative spec and adds diagrams, rules and tests.

---

## 1. Scope and layers

| Capability | Layer | Source |
|---|---|---|
| Consent template builder (13 block types), versioning and publishing | 4 | Roadmap M4.5 |
| Assignment, staff-assisted in-clinic signing, immutable snapshot and SHA-256 | 4 | Roadmap M4.6; UD-31 |
| Education CMS (versioned content) and assignment tracking | 4 | M4.7 |
| Instructions by procedure or consultation | 4 | M4.8 |
| Patient review and signing in the patient app | 5 | [B §13.3]; M5.5 |

Layer 4's exit condition, "patient-facing plan/document workflow is testable" [B §29], is met in clinic through staff-assisted signing, before the patient app exists (spec §9.1).

---

## 2. Principles

1. **Versioned templates; executed documents never change.** Publishing freezes a version; editing a template creates a new version; nothing already signed is touched [B §12.2]; spec §1.4 G9.
2. **Every completed consent has an immutable signed snapshot and its SHA-256** [B §12.3, §36].
3. **The state machine is explicit** and enforced by one server-side transition table (spec §5.4, §5.4.4).
4. **A consent is not a media permission.** Clinical consent never implies website, advertising, research, education or AI-training use [B §7.1, §30]. A signed consent can be the *evidence* for an explicit, per-category permission transition ([PHOTO_ARCHITECTURE.md](PHOTO_ARCHITECTURE.md) section 9).
5. **Choosing a treatment plan is not consent.** Plan acceptance is never medical authorization; consent is always a separate `ConsentAssignment` [B §11.1]; spec §5.4.3.
6. **Signing is online only**, idempotent, and never duplicated by a retry [B §23.3]; spec §8.

---

## 3. Data model

Excerpt; the normative catalog is spec §5.2 and the definition is `schema.prisma` section 6.

| Entity | Role | Key rules (verified by) |
|---|---|---|
| `ConsentTemplate` | Template identity; organization-owned, optionally one practice; retired, never deleted | A retired template takes no new consents (F16) |
| `ConsentTemplateVersion` | Ordered builder `blocks` (JSON, validated against a versioned JSON schema), `requiresProviderSignature`, `requiresWitnessSignature`, `contentHash` set at publish (SHA-256 of the blocks and signature flags in RFC 8785 canonical JSON, ADR-0028 K4-11); `DRAFT → PUBLISHED → RETIRED` | One open draft per template; published versions frozen and forward-only (F1–F6); the hash is hex SHA-256 (F13) |
| `ConsentAssignment` | A consent issued to one patient, optionally linked to a consultation, procedure or treatment plan; `responses` keyed by block ID; lifecycle timestamps; snapshot link and hash; void and supersede fields | The whole spec §5.4.4 machine, created `DRAFT` from a published version of a current template (F14–F19, F36–F37); signed responses frozen (F25); `COMPLETE` needs snapshot and hash (F8), the hash being the snapshot version's SHA-256 (F26); executed consents frozen and never reopened (F10, R5–R6); snapshot of the same patient (F7); supersession and voiding rules (F30–F35) |
| `ConsentSignature` | One signature per signer role (`PATIENT`, `PROVIDER`, `WITNESS`): signer, `signerName`, method (`DRAWN`, `TYPED`), signature object (vector strokes or the typed name, as JSON; ADR-0028 K4-14), exact attestation text shown, time, IP, device, idempotency key, and the hand-off of a patient signature | Append-only; one per role; idempotency key unique per organization; a hand-off of its own consent (F23) |
| `PatientHandoff` | The locked in-clinic hand-off of the provider device (ADR-0028 K4-13): hashed token, purpose (`CONSENT_SIGNING` or `PLAN_RESPONSE`) and its one target, the staff member, session and device, the identity confirmation, the idle and absolute expiry, and how it ended | One target matching its purpose, at most 60 minutes, bound to the opener's session and device, frozen once ended (F20–F24) |
| `Document` / `DocumentVersion` | The signed snapshot is a `Document` of type `SIGNED_CONSENT` with an immutable `DocumentVersion` carrying its SHA-256 | Document versions immutable (F11) |

```mermaid
erDiagram
  ConsentTemplate ||--o{ ConsentTemplateVersion : "versions"
  ConsentTemplateVersion ||--o{ ConsentAssignment : "issued as"
  Patient ||--o{ ConsentAssignment : receives
  ConsentAssignment ||--o{ ConsentSignature : "signed by"
  ConsentAssignment |o--o| DocumentVersion : "signed snapshot"
  Document ||--o{ DocumentVersion : "versions"
  ConsentAssignment |o--o| ConsentAssignment : "superseded by"
  ConsentAssignment |o--o{ ConsentAssignment : "replaces"
  ConsentAssignment ||--o{ PatientHandoff : "signed in"
  PatientHandoff |o--o{ ConsentSignature : "patient signature"
  ConsentAssignment |o--o{ PhotoPermission : "evidence for"
```

---

## 4. Templates and versioning

| Step | Endpoint (spec §6.3) | Permission | Audit |
|---|---|---|---|
| Create a template | `POST /consent-templates` | `consent.template.manage` | — |
| Start a new draft version | `POST …/{tid}/versions` | `consent.template.manage` | — |
| Edit draft blocks | `PATCH …/{tid}/versions/{vid}` with `If-Match` | `consent.template.manage` | — |
| Publish (freezes, hashes) | `POST …/{tid}/versions/{vid}/publish` | `consent.template.manage` | `CONSENT_TEMPLATE_PUBLISHED*` |
| Retire the template | `POST …/{tid}/retire` | `consent.template.manage` | — |
| Read templates | `GET /consent-templates`, `GET …/{tid}` | `consent.assign` | — |

- A published version stores `contentHash`, the SHA-256 of its canonicalized blocks, with `publishedAt` and `publishedById` (CHECK). After publishing, only `PUBLISHED → RETIRED` is possible (F3–F4).
- Only one `DRAFT` version per template can be open at a time (F6). Editing a template means starting a new version (F5).
- New assignments are prepared only from a `PUBLISHED` version (spec §5.4.4). An existing assignment keeps pointing at the frozen version it was issued from.
- In the default matrix, ORGANIZATION_ADMIN holds `consent.template.manage` organization-wide and PRACTICE_ADMIN within its practice (spec §4.5).
- Template content must be original or licensed; vendor consent or education text is never copied [B §0.1, §30].

---

## 5. The builder elements

The 13 elements of Bible §12.1 and their block types. Excerpt; normative list in spec §6.6.6. Each block is `{ "id": "<stable id>", "type": "<TYPE>", … }`, and captured values are stored in `ConsentAssignment.responses` under the block ID.

| # | Bible element | Block type | Captures a response |
|---|---|---|---|
| 1 | Heading | `HEADING` | No |
| 2 | Paragraph | `PARAGRAPH` | No |
| 3 | Bullets | `BULLETS` | No |
| 4 | Image | `IMAGE` | No |
| 5 | Video acknowledgment | `VIDEO_ACKNOWLEDGMENT` | Yes: watched and acknowledged |
| 6 | Checkbox | `CHECKBOX` | Yes, optional |
| 7 | Required checkbox | `REQUIRED_CHECKBOX` | Yes; must be checked before the patient can sign |
| 8 | Initial | `INITIAL` | Yes |
| 9 | Text field | `TEXT_FIELD` | Yes |
| 10 | Date | `DATE` | Yes |
| 11 | Patient signature | `PATIENT_SIGNATURE` | Yes → `ConsentSignature(PATIENT)` |
| 12 | Provider signature | `PROVIDER_SIGNATURE` | Yes → `ConsentSignature(PROVIDER)`; sets `requiresProviderSignature` |
| 13 | Witness signature | `WITNESS_SIGNATURE` | Yes → `ConsentSignature(WITNESS)`; sets `requiresWitnessSignature` |

The traceability check confirms all 13 (spec §11.2). Adding a block type changes a Bible list and needs an ADR first [B §0]. Required responses (ADR-0028 K4-11): `REQUIRED_CHECKBOX` is always required; `INITIAL`, `TEXT_FIELD`, `DATE` and `VIDEO_ACKNOWLEDGMENT` carry a `required` flag, on by default for `INITIAL` and `VIDEO_ACKNOWLEDGMENT`; `CHECKBOX` is never required. A version has exactly one `PATIENT_SIGNATURE` and at most one `PROVIDER_SIGNATURE` and one `WITNESS_SIGNATURE`. `IMAGE` and `VIDEO_ACKNOWLEDGMENT` blocks point at a published image or video version of the education library, so consents and education share one scanned, licensed media path. No template ships with the platform: template text is the practice's own or licensed.

---

## 6. Lifecycle

### 6.1 States

Diagram of spec §5.4.4, which is normative. "P" marks spec proposals adopted by ADR-0008; the pre-completion void rows are the UD-23 baseline.

```mermaid
stateDiagram-v2
  [*] --> DRAFT: prepare from a PUBLISHED version
  DRAFT --> ASSIGNED: assign
  DRAFT --> VOIDED: discard with reason, P
  ASSIGNED --> VIEWED: patient opens it
  VIEWED --> IN_PROGRESS: first acknowledgment or field saved
  IN_PROGRESS --> SIGNED_BY_PATIENT: patient signs, required acknowledgments present
  SIGNED_BY_PATIENT --> SIGNED_BY_PROVIDER: provider signs, when required
  SIGNED_BY_PATIENT --> SIGNED_BY_PATIENT: witness signs, when required, P
  SIGNED_BY_PROVIDER --> SIGNED_BY_PROVIDER: witness signs, when required, P
  SIGNED_BY_PROVIDER --> COMPLETE: system, all signatures, snapshot and hash
  SIGNED_BY_PATIENT --> COMPLETE: system, no provider signature required, P
  COMPLETE --> VOIDED: void with reason
  COMPLETE --> SUPERSEDED: its replacement completes
  ASSIGNED --> VOIDED: withdrawn, UD-23
  VIEWED --> VOIDED: withdrawn, UD-23
  IN_PROGRESS --> VOIDED: withdrawn, UD-23
  SIGNED_BY_PATIENT --> VOIDED: withdrawn, UD-23
  SIGNED_BY_PROVIDER --> VOIDED: withdrawn, UD-23
  VOIDED --> [*]
  SUPERSEDED --> [*]
```

### 6.2 Walkthrough

| Stage | Who | Rule | Audit |
|---|---|---|---|
| Prepare | Staff with `consent.assign` | `POST …/consents` (`Idempotency-Key` required) from the latest published version of a current template, optionally linked to a consultation, plan or procedure of the patient; `422 PATIENT_IS_MINOR` for a patient under 18 (ADR-0028 K4-12, K4-16) | `CONSENT_STATUS_CHANGED*` |
| Assign | Staff with `consent.assign` | `POST …/{consentId}/assign`; from now on the patient can see it (portal rule: status is not `DRAFT`, spec §4.7) | `CONSENT_ASSIGNED` |
| View | Patient (portal link or in-clinic hand-off) | First open | `CONSENT_VIEWED` |
| Respond | Patient | First acknowledgment or field saved | `CONSENT_STATUS_CHANGED*` |
| Patient signature | Patient | Refused with `422 CONSENT_INCOMPLETE` until every required response is present (`details.missing` lists the block IDs); a signature given in `VIEWED` passes through `IN_PROGRESS` in the same transaction | `CONSENT_SIGNED` |
| Provider countersign | Holder of `consent.sign.provider` | Only when the version requires it | `CONSENT_SIGNED` |
| Witness | Staff with `consent.assign` records it | Only when required; any time in either signed state before completion | `CONSENT_SIGNED` |
| Complete | System | All required signatures present; snapshot and SHA-256 generated in the same transaction as the last signature | `CONSENT_COMPLETED` (with the hash) |

Every transition writes its audit row in the same transaction as the state change (spec §3.3 step 10, §5.4). Invalid transitions return `409 INVALID_STATE_TRANSITION`.

---

## 7. Signing

### 7.1 Signature rules

| Rule | Design | Source |
|---|---|---|
| Endpoint | Staff: `POST …/{consentId}/signatures` (provider with `consent.sign.provider`; witness with `consent.assign`). Patient: `POST /portal/consents/{id}/signatures` (Layer 5) or the in-clinic hand-off (Layer 4) | spec §6.3, §6.5 |
| Idempotency | `Idempotency-Key` required; `ConsentSignature.idempotencyKey` unique per organization, so a retry never creates a second signature | [B §20.3, §23.3]; spec §6.1.8 |
| One per role | At most one `PATIENT`, one `PROVIDER`, one `WITNESS` signature per consent | `schema.prisma` |
| Evidence | A drawn signature as vector strokes (normalized points, at most 4,000, drawn with the annotation `Canvas` code) or the typed name, stored write-once as its own JSON object (`SIGNATURE` class); method, exact attestation text displayed, signer name, time, IP address, device. Nothing is uploaded or decoded from a file, so nothing needs scanning | ADR-0028 K4-14 |
| Append-only | Signatures are never edited or deleted | `constraints.sql` Layer 4 |
| Step-up | On the provider device, LocalAuthentication gates signing; the server can require a recent MFA verification for designated sensitive actions | [B §21.1]; spec §4.2 |
| Offline | Not available; signatures are never queued | spec §8 |
| Witness who is not a user | `signerUserId` is NULL and `signerName` identifies the witness | `schema.prisma` |

### 7.2 Signing sequence (in-clinic, with provider countersign)

```mermaid
sequenceDiagram
  autonumber
  actor Staff as Staff member
  actor Pt as Patient
  participant App as Provider app
  participant API as api
  participant DB as PostgreSQL
  participant S3 as S3
  Staff->>App: Open the assigned consent and hand the device to the patient
  Staff->>App: Confirm the patient's name and date of birth
  App->>API: POST patient-signing for consentId with Idempotency-Key and the identity confirmation
  API->>API: Authorize consent.assign
  API-->>App: Hand-off token for this consent (15 minutes idle, 60 at most)
  App->>App: Lock to signing mode with a persistent banner
  Pt->>App: Open and read the consent
  App->>API: Viewed, within the hand-off session
  API->>DB: ASSIGNED to VIEWED, audit CONSENT_VIEWED
  Pt->>App: Answer acknowledgments and fields
  App->>API: Save responses
  API->>DB: VIEWED to IN_PROGRESS, audit CONSENT_STATUS_CHANGED
  Pt->>App: Sign
  App->>API: Patient signature with Idempotency-Key, strokes or typed name, and attestation
  API->>DB: Check required acknowledgments, ConsentSignature PATIENT, SIGNED_BY_PATIENT, audit CONSENT_SIGNED
  Pt->>Staff: Return the device
  Staff->>App: Exit signing mode
  App->>App: Face ID or Touch ID, or password and code, then the token is revoked
  Staff->>App: Countersign as provider, with on-device step-up
  App->>API: POST signatures, role PROVIDER, with Idempotency-Key
  API->>DB: ConsentSignature PROVIDER, SIGNED_BY_PROVIDER, audit CONSENT_SIGNED
  API->>S3: Store the immutable PDF snapshot as a new object
  API->>DB: Document SIGNED_CONSENT and DocumentVersion with SHA-256, COMPLETE with snapshot link and hash, audit CONSENT_COMPLETED
```

In the patient app (Layer 5) the same states are reached through `GET /portal/consents`, `POST …/{id}/viewed`, `PUT …/{id}/responses` and `POST …/{id}/signatures`, with the patient's own session (spec §6.5).

---

## 8. Staff-assisted in-clinic signing

UD-31, confirmed by ADR-0028 K4-13: yes, with a consent-scoped hand-off and staff re-authentication to exit. The same hand-off, scoped to one plan option, records a patient's in-clinic response to a treatment plan (K4-06).

| Rule | Design | Source |
|---|---|---|
| Opening | `POST …/{consentId}/patient-signing` by a holder of `consent.assign`, `Idempotency-Key` required, for a consent in `ASSIGNED`, `VIEWED` or `IN_PROGRESS` | spec §4.4, §6.3 |
| Identity | The start screen shows the patient's name and date of birth; the staff member confirms they have checked the patient's identity, and the confirmation is stored with the hand-off. Before Layer 5 the patient has no account: `signerUserId` stays empty and the signature records the patient's name | ADR-0028 K4-13 |
| Token | A separate, hashed token for this one consent, bound to the staff member's session and device; it ends 15 minutes after the last activity and at most 60 minutes after opening (F20–F22) | ADR-0028 K4-13 |
| Scope | Only the `/handoff` routes accept the token: read the consent, mark it viewed, save responses, add the patient signature. The staff session cannot call them, and the token can call nothing else | spec §6.3 |
| Lock | A persistent banner shows signing mode; the patient cannot navigate elsewhere | DESIGN_SYSTEM.md C13 |
| Exit | The signed-in staff member re-authenticates with Face ID or Touch ID through the app's biometric gate, or with password and authenticator code ("Confirm it's you") without biometrics; exiting or signing revokes the token | ADR-0028 K4-13; DESIGN_SYSTEM.md C13 |
| Audit | `CONSENT_VIEWED`, `CONSENT_STATUS_CHANGED*` and `CONSENT_SIGNED`; each row names the staff member who opened the hand-off (actor type `USER`) with `metadata.handoffId`, so the trail says the patient acted in a hand-off this staff member opened. No patient identity is invented before Layer 5 | ADR-0028 K4-13 |
| Confirmation | Signing and voiding are confirmed with a sheet that says who sees what and whether it can be undone | DESIGN_SYSTEM.md C11 |

## 9. The immutable signed snapshot and hash

| Aspect | Design | Verified by |
|---|---|---|
| When | Generated by the system on the transition to `COMPLETE` | spec §5.4.4 |
| What | An immutable PDF snapshot of the executed consent, stored as a new object | spec §5.4.4 |
| Where | `Document` of type `SIGNED_CONSENT` with a `DocumentVersion` (object link and SHA-256); `ConsentAssignment.signedDocumentVersionId` and `signedSnapshotHash` | `schema.prisma` |
| Required | `COMPLETE` is impossible without the completion time, the snapshot link and the hash (CHECK) | F8 |
| Same patient | The snapshot must belong to the same patient (composite FK) | F7 |
| Immutable | The document version cannot change; the executed consent is frozen apart from void and supersede bookkeeping | F10–F11 |
| Download | `POST …/{consentId}/access-urls` (`consent.assign`), a signed URL valid 10 minutes as for other documents; writes `DOCUMENT_VIEWED*` | spec §6.3; ADR-0028 K4-15 |
| Template link | The assignment keeps its template version, whose `contentHash` identifies the exact published content | `schema.prisma` |

The api renders the snapshot with PDFKit and Inter, as it does the consultation summary (ADR-0028 K4-15). It holds the template name, version and `contentHash`; the patient's name and date of birth; every block as shown, with the responses; each signature as drawn or typed, with the signer's name, role, time and attestation text; the hand-off marker; and the consent ID. `signedSnapshotHash` is the SHA-256 of the PDF bytes, the same value as `DocumentVersion.sha256`, and a trigger checks they match (F26). `CONSENT_COMPLETED` carries the hash, and the WORM audit copy archives every audit row (ADR-0023 K2-07), so each hash is anchored outside the database (THREAT_MODEL.md item 14).

---

## 10. Void and supersede

| Transition | Rule | Permission | Audit |
|---|---|---|---|
| `COMPLETE → VOIDED` | `/void` with a reason of at most 500 characters, stored and never audited or logged; records `voidedAt`, `voidedById`, `voidReason` (CHECK, F35); refused with `409 CONSENT_IS_EVIDENCE` while a current media-permission grant cites the consent (F30) | `consent.void` | `CONSENT_VOIDED` |
| `COMPLETE → SUPERSEDED` | `/supersede` prepares the replacement from the template's latest published version (`replacesAssignmentId`); the old consent becomes `SUPERSEDED` when the replacement completes, in the same transaction, so a valid consent is never missing; one open replacement per consent (F31–F34) | `consent.assign` | `CONSENT_STATUS_CHANGED*` |
| `DRAFT → VOIDED` | Discards a draft, with a reason; a draft is never shown to the patient and never deleted (F36–F37) | `consent.void` | `CONSENT_VOIDED` |
| `ASSIGNED` … `SIGNED_BY_PROVIDER` → `VOIDED` | Withdrawn before completion, with a reason (UD-23 baseline) | `consent.void` | `CONSENT_VOIDED` |

- `VOIDED` and `SUPERSEDED` are terminal. The database allows only `COMPLETE → VOIDED` and `COMPLETE → SUPERSEDED` from an executed consent and rejects any attempt to reopen, edit or re-complete it (R5–R6, F12).
- Voiding or superseding never alters the snapshot, the signatures or the responses.
- A voided or superseded consent stays visible to the patient in the portal (the rule is "status is not `DRAFT`", spec §4.7).
- Void is destructive-styled and never the default button (DESIGN_SYSTEM.md C4).

Decided by ADR-0028 K4-16: any consent before completion, a draft, or a `COMPLETE` one can be voided with a reason. Voiding a consent that a current grant cites is refused, so staff first record a new permission version, with other evidence or as a revocation; no permission changes implicitly [B §7.1]. If a replacement is voided before it completes, the consent it would replace stays `COMPLETE`.

---

## 11. Minors and guardians

UD-23, decided by the owner in ADR-0028 K4-16: minors are out of scope for the first production build.

- Preparing a consent for a patient under 18 on that day answers `422 PATIENT_IS_MINOR`.
- No `GUARDIAN` signer role is added; `SignerRole` stays `PATIENT`, `PROVIDER` and `WITNESS`, one signature per role.
- Bringing minors into scope later needs an ADR and a schema change: a guardian signer role, one guardian signature per consent and a guardian identity confirmation in the hand-off. `PatientContact` already supports kind `GUARDIAN`.
- Age thresholds and state-specific rules are therefore not modelled (US only, ADR-0006).
- Proxy access to the patient app is deferred (UD-08).

---

## 12. Education content and instructions

| Aspect | Education [B §12.5] | Instructions [B §12.6] |
|---|---|---|
| Model | `EducationContent` with `EducationContentVersion` (`DRAFT → PUBLISHED → RETIRED`, one draft, published frozen, R7); organization-wide, changed with `content.manage` at organization scope; each version records its source and licence, which publishing requires (F38); at most one media file per version (MP4 ≤ 200 MiB, JPEG or PNG ≤ 20 MiB, PDF ≤ 50 MiB; write-once and scanned) (ADR-0028 K4-17) | `PatientInstruction` pointing at a content version (types include `PRE_OP_INSTRUCTION`, `POST_OP_INSTRUCTION`) |
| Content types | Video, image, animation, text, PDF, procedure explanation, FAQ, pre-op instruction, post-op instruction | Same library |
| Assignment | `ContentAssignment` of a `PUBLISHED` version only (F39–F40), optionally tied to a consultation or procedure; `POST …/content-assignments` (`content.read`); `…/{id}/presented` records presentation in the consultation | A `PUBLISHED` pre-op or post-op instruction version (F41–F42), assigned by procedure **or** consultation (CHECK, at least one); `POST …/instructions` (`content.read`); `…/{id}/release` (Layer 5, `consultation.edit`) sets `releasedToPatientAt` (ADR-0028 K4-18) |
| Tracking | `ASSIGNED → OPENED → VIEWED → COMPLETED → ACKNOWLEDGED` (states from the Bible, ordering proposed, spec §5.4.10), each with a timestamp | Patient acknowledgment (`patientAcknowledgedAt`) is tracked **separately** from clinical completion (`clinicalCompletedAt`, `consultation.edit`) |
| Patient app | `GET /portal/content`, `POST …/{id}/events` | `GET /portal/instructions`, `POST …/{id}/acknowledge` (`Idempotency-Key` required) |
| Audit | `CONTENT_ASSIGNED*` | `INSTRUCTION_ASSIGNED*`, `INSTRUCTION_ACKNOWLEDGED*` |
| Administration | `/content` library and versions (`content.manage`), `CONFIGURATION_CHANGED*` on versions | Same |

Content is original or licensed only [B §0.1]. Which engagement states apply to which content type ("where appropriate", [B §12.5]) is decided at the Layer 5 kickoff, where the patient states first occur (ADR-0028 K4-18).

---

## 13. Audit events

Excerpt; the catalog is normative in spec §7.3. Metadata holds identifiers and codes only, never consent text or responses [B §22.2].

| Event | Written when |
|---|---|
| `CONSENT_STATUS_CHANGED*` | Prepared (`DRAFT`), first response (`IN_PROGRESS`), superseded |
| `CONSENT_ASSIGNED` | Issued to the patient |
| `CONSENT_VIEWED` | First opened, in the portal or in-clinic |
| `CONSENT_SIGNED` | Each patient, provider or witness signature |
| `CONSENT_COMPLETED` | Snapshot and hash written; `COMPLETE`; the metadata carries the hash |
| `CONSENT_VOIDED` | Voided, before or after completion |
| `CONSENT_TEMPLATE_PUBLISHED*` | A template version is published |
| `DOCUMENT_VIEWED*` | A signed snapshot is downloaded (`…/{consentId}/access-urls` or the documents API) |
| `CONTENT_ASSIGNED*`, `INSTRUCTION_ASSIGNED*`, `INSTRUCTION_ACKNOWLEDGED*` | Education and instruction assignment and acknowledgment |
| `PHOTO_PERMISSION_CHANGED` | A media permission transition that cites a signed consent as evidence |

---

## 14. Verification

| Suite | Covers | When |
|---|---|---|
| SQL behaviour suite ([`behavior/`](technical-spec/verification/behavior/), fragment `L04`) | F1–F6, F13 (template versioning, hash format), F7–F12 and F25–F26 (snapshot, hash, frozen execution, void), F14–F19 and F30–F37 (the whole machine, supersession, voiding), F20–F24 (hand-off), F27–F29 (media-permission evidence), F38–F42 (education and instructions), R5–R7 (no reopening; content forward-only) | Every CI run |
| State-machine unit tests | Every allowed and forbidden edge of spec §5.4.4, including witness-only and pre-completion void | Layer 4 |
| API integration tests | Signing refused without required acknowledgments; one signature per role; idempotent retries; provider signature needs `consent.sign.provider`; completion writes the snapshot and a hash that matches the stored bytes | Layer 4 |
| Authorization and cross-tenant tests | Every consent, template and content route | Layer 4 |
| iOS UI tests | Hand-off locks navigation; exit requires staff re-authentication; separate confirmation sheets | Layer 4 |
| Portal visibility tests | `DRAFT` never visible; assigned consents visible; instructions only when released | Layer 5 |

---

## 15. Decisions made at the Layer 4 kickoff

Every Layer 4 open item of this document was decided in ADR-0028.

| Item | Decision |
|---|---|
| UD-23: minors in scope; guardian signer role; void policy | Minors out of scope, `422 PATIENT_IS_MINOR`, no guardian role; void with a reason before or after completion (K4-16) |
| UD-31: hand-off lifetime; patient identity confirmation in clinic; audit actor for hand-off actions | 15 minutes idle, 60 at most; staff confirmation stored with the hand-off; the staff member who opened it, actor type `USER`, with `metadata.handoffId` (K4-13) |
| Which response blocks can be required, and the error returned when signing without them | Section 5; `422 CONSENT_INCOMPLETE` with `details.missing` (K4-11, K4-12) |
| How the signature is transferred | Vector strokes or the typed name in the signature request; no upload (K4-14) |
| Canonicalization for `contentHash`; PDF snapshot layout; relation of `signedSnapshotHash` to `DocumentVersion.sha256` | RFC 8785; section 9; the same value, checked by a trigger (K4-11, K4-15) |
| When the superseded consent changes state; discarding an unused `DRAFT` | When the replacement completes; `DRAFT → VOIDED` with a reason (K4-12, K4-16) |
| `POST …/{consentId}/access-urls` audit event | `DOCUMENT_VIEWED*` (K4-23) |
| Audit of prepare and supersede | `CONSENT_STATUS_CHANGED*`, now in the spec §6.3 rows too (K4-23) |
| Education and instruction assignments reference only `PUBLISHED` versions | Yes, enforced by a trigger (K4-18; F-65) |
| Voiding a consent that was evidence for a media permission | Refused with `409 CONSENT_IS_EVIDENCE` while a current grant cites it (K4-16, K4-19) |
| Engagement states per education content type | Decided at the Layer 5 kickoff, where they first occur (K4-18) |
