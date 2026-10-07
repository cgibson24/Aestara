# Layer 4 kickoff

| | |
|---|---|
| Version | 1.0 |
| Status | **Proposed, 2026-10-07; awaiting the owner's confirmation.** Nothing of Layer 4 is built before it. |
| Authority | Bible §0.1, §4.3 (profile tabs), §5.1 (consultation sequence), §7.1, §11 (plans, estimates, procedures), §12 (documents, consents, instructions, education), §17.1 (admin modules), §21.1, §22 (audit, export), §23 (offline), §27.2, §29 (Layer 4), §30, §33, §36; ADR-0001, ADR-0018, ADR-0022 to ADR-0027 |
| Normative sources | spec §4.4–4.6, §5.2 (Documents, consents, instructions & education; Commercial & configuration; the Layer 4 rows of Provider & patient and Scheduling & consultation), §5.4.3, §5.4.4, §5.4.10, §5.5, §5.8, §6.2, §6.3 (Treatment plans & estimates; Documents, consents…; Consent templates & content; exports), §6.6.6, §7.3, §8, §10.2 (UD-11, UD-14, UD-23, UD-31); [CONSENT_ARCHITECTURE.md](CONSENT_ARCHITECTURE.md); [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) Step 7; [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) §5.3 |

Before any Layer 4 code, the roadmap requires confirming the decisions listed for the layer (UD-11, UD-14, UD-23, UD-31). It also requires resolving the findings carried to Layer 4 (F-38 to F-43, F-65), the Layer 4 open items in the documentation pack, and the Node.js re-evaluation that ADR-0026 K3-24 scheduled here. This document gives one recommendation for each. Once the owner confirms them, they are recorded as ADR-0028, and the spec text they change is corrected under change control before implementation (Bible §0).

## 1. Scope (Bible §29)

**Authorized:** versioned documents, consents and content; plans and estimates [B §29]. The spec places here the treatment catalog, treatment plans A/B/C, estimates, procedures, consent templates and their builder, consent assignment and staff-assisted in-clinic signing with the immutable signed snapshot, the education library and its assignment, instructions by procedure or consultation, and patient data exports (spec §5.8 Layer 4 row, §9.1 row 4; roadmap M4.1–M4.9).

**Exit condition:** the patient-facing plan and document workflow is testable [B §29]. Before the patient app exists, it is tested in clinic: the patient signs consents on the provider's device in a locked hand-off (UD-31), and staff record the patient's response to a plan with the patient's attestation (UD-14) (spec §9.1 row 4).

**Not authorized:**
- Anything that reaches a patient through the patient app: sending a plan, the patient's own viewing and responses, releasing documents and instructions, and patient engagement with education (Layer 5).
- Appointments and appointment links (Layer 6).
- AI visualization, and the simulation category of a treatment (Layers 7–8).
- Payments, a ledger, claims or invoices: estimates and references only [B §11.3]. Invoice references arrive with practice-system integrations (Layer 10, K4-02).

Delivery follows micro-prompts M4.1–M4.10 in the roadmap. Each is written with the Bible §33 template and passes the Bible §27.2 definition of done.

## 2. Decisions

| ID | Topic | Recommendation | Source |
|---|---|---|---|
| K4-01 | Estimate versus quote (UD-11) | **Estimates only; the `Quote` table is not created.** An estimate is the frozen priced snapshot of a plan option, with a PDF. Bible §11 names estimates and §11.3 rules out a billing ledger, so nothing in Layers 4–10 issues a formal quote. The UD-11 baseline says "drop if unused", so `Quote` and `QuoteStatus` leave the spec until a separately approved billing scope needs them. Details after this table. | Bible §11.1, §11.3 |
| K4-02 | Invoice references | `InvoiceReference` moves to Layer 10, where practice-system adapters create it. Layer 4 keeps the plan's free-text `financingReference` [B §11.1]. No screen lets staff type an invoice number: an invoice lives in the practice's billing system, and a hand-typed copy would drift from it. | Bible §11.3, §18 |
| K4-03 | Treatment catalog | See the list after this table. | Bible §11.1, §17.1 |
| K4-04 | Plan options and totals | See the list after this table. | Bible §11.1 |
| K4-05 | The plan machine in Layer 4 | See the list after this table. | Bible §11.2; spec §5.4.3 |
| K4-06 | In-clinic plan response (UD-14) | See the list after this table. | Bible §11.1; spec §5.4.3 |
| K4-07 | Sibling options (UD-14; F-40) | When a patient accepts one option, every other option of the same consultation that the patient was shown declines in the same transaction. The other options are those in `PROPOSED`, and from Layer 5 also `SENT_TO_PATIENT` and `VIEWED`. The decline is a system transition with reason `SIBLING_ACCEPTED`, audited `TREATMENT_PLAN_STATUS_CHANGED` with actor `SYSTEM`. Drafts stay drafts: the patient never saw them. A plan without a consultation has no siblings. Spec §5.4.3 gains the system rows. | Bible §11.1; spec §5.4.3 |
| K4-08 | Scheduling an accepted plan before Layer 6 (F-42) | `/schedule` (`ACCEPTED → SCHEDULED`) creates one `PLANNED` procedure for each item of the plan, linked to the item, in one transaction. It needs `procedure.manage` in Layer 4, because it creates procedures; Layer 6 adds appointment links with `appointment.manage`. `/complete` needs every linked procedure `COMPLETED` or `CANCELLED`, at least one `COMPLETED`; otherwise `409 INVALID_STATE_TRANSITION` lists what is open. `/cancel` takes a reason and cancels the plan's open procedures with it. | Bible §11.2; spec §5.4.3 |
| K4-09 | Procedures | See the list after this table. | Bible §4.3, §11 |
| K4-10 | Estimates | See the list after this table. | Bible §11.1, §11.3 |
| K4-11 | Consent templates and the builder | See the list after this table. | Bible §12.1, §12.2, §17.1 |
| K4-12 | The consent lifecycle (F-39, F-43) | See the list after this table. | Bible §12.3, §12.4; spec §5.4.4 |
| K4-13 | Staff-assisted in-clinic signing (UD-31; F-41) | See the list after this table. | Bible §12.3, §21.1, §29; DESIGN_SYSTEM.md C11, C13 |
| K4-14 | Signature capture (F-43) | The app captures a drawn signature as vector strokes: normalized points, at most 4,000, drawn with the same `Canvas` code as annotations (ADR-0027). A typed signature is the typed name. The signature request carries the strokes or the name; there is no image upload. The api stores them write-once as the signature object (class `SIGNATURE`, `application/json`) and draws them into the snapshot PDF. Nothing is decoded from an uploaded file, so nothing needs scanning (ADR-0023 K2-04 scans uploads). The exact attestation text shown is stored with the signature. | Bible §12.3; spec §5.2 |
| K4-15 | Signed snapshot and hash (F-43; THREAT_MODEL.md item 14) | See the list after this table. | Bible §12.3, §22.1, §36 |
| K4-16 | Void, supersede and minors (UD-23; F-38, F-43) | See the list after this table. | Bible §12.4 |
| K4-17 | Education library | See the list after this table. | Bible §0.1, §12.5, §17.1 |
| K4-18 | Assignments and instructions (F-42, F-65) | See the list after this table. | Bible §12.5, §12.6 |
| K4-19 | Media-permission evidence | Layer 4 re-creates the `SIGNED_CONSENT` evidence check (`constraints.sql` Layer 4): a permission version may cite a `COMPLETE` consent of the same patient. The permission screen offers it. A consent still grants no media permission by itself: each category is its own explicit row [B §7.1, §30]. Voiding a consent that a current grant cites is refused (K4-16). | Bible §7.1, §7.2 |
| K4-20 | The consultation workspace and profile | See the list after this table. | Bible §4.3, §5.1 |
| K4-21 | Patient data export (M4.9) | See the list after this table. | Bible §22.4; SECURITY_REQUIREMENTS.md SR-AUZ-15 |
| K4-22 | Ownership and authorization | Plans, estimates and procedures are practice-owned, as consultations are (ADR-0026 K3-20): they take the consultation's practice when linked to one, and need a grant covering it. A consent assignment takes the practice of its linked consultation, plan or procedure, or of a practice template; otherwise it is patient-level, as concerns are. The catalog and the education library are organization-wide and need an organization-wide grant to change, as organization-wide protocols do (ADR-0023). A consent template is organization-wide or belongs to one practice. Plans have no location, so a LOCATION-scoped grant reads plans but never changes them (AUTHORIZATION_RBAC.md open item). The generated authorization and cross-tenant suites cover every new operation, with IDs swapped in paths and bodies. | spec §4.6; ADR-0001 |
| K4-23 | Audit events (UD-19 gaps; F-39) | Adopt the spec §7.3 Layer 4 events, with these corrections. Preparing (`DRAFT`) and superseding a consent write `CONSENT_STATUS_CHANGED`, as §5.4.4 says (the §6.3 rows gain them). Downloading a signed consent writes `DOCUMENT_VIEWED`, as other documents do. The estimate PDF and the consent snapshot write `DOCUMENT_ADDED` (ADR-0026 K3-19). The in-clinic response writes `TREATMENT_PLAN_STATUS_CHANGED` with its channel. One addition: `PROCEDURE_STATUS_CHANGED`, so procedures are traceable as plans are. Metadata never holds consent text, responses, signatures, names, notes, reasons or prices [B §22.2]. | Bible §22.1, §22.2; spec §7.3 |
| K4-24 | Offline | No Layer 4 action works offline. Signatures and completion need real-time authorization and are never queued (spec §8). Plans, consents, education and instructions are read online, and their workspace steps say so when offline. The offline copy of consultations (ADR-0026 K3-06) is unchanged. | Bible §23; spec §8 |
| K4-25 | Admin portal | Four modules join the admin portal: the treatment catalog, the consent template builder with a preview of the patient's view, the education library, and patient data exports. Each module has the five view states and runs Playwright tests against the real api, as the Layer 1–2 modules do (ADR-0022). | Bible §17.1 |
| K4-26 | iOS modules and test tooling | `TreatmentPlans` and `Education` are built, and `DocumentsConsent` gains its consent half (IOS_ARCHITECTURE.md). The module graph gains their dependencies under its tier rules. Tests: behaviour-suite checks for every new trigger; api tests for each machine, precondition and cross-tenant case; snapshot tests for the new screens in both appearances and an accessibility size; the UI test extended through a plan with an estimate and an in-clinic response, and a consent signed in hand-off and countersigned, with accessibility audits of the new screens on both devices. | Bible §27; ADR-0026 K3-22 |
| K4-27 | Node.js 26 (K3-24) | Stay on Node.js 24 LTS through Layer 4. Node 26 is due to enter Active LTS in late October 2026, after Layer 4 starts. Re-evaluate at the Layer 5 kickoff, then move as a separate, tested change if its dependencies support it. | spec §2.1 |

**K4-01, estimates (UD-11):**
- `Quote` and `QuoteStatus` leave spec §5.2, §5.8 and the schema; `Estimate` keeps its foreign keys unchanged.
- The decision is reversible: a later billing scope can add a quote that references an estimate, as the UD-11 baseline sketched.

**K4-03, treatment catalog:**
- **Owner:** organization-wide categories (a tree) and treatments. Managing them needs `practice.manage` at organization scope; reading them needs `treatmentplan.create` (spec §4.4).
- **Codes:** a treatment code is unique in the organization and optional.
- **Prices:** the default unit price is optional and prefills a plan item, which can change it.
- **Retiring:** status `ACTIVE` or `INACTIVE`. A treatment is retired, never deleted: plans and procedures keep pointing at it.
- **Seeding:** nothing is seeded. Each practice builds its own catalog; no vendor catalog or wording is copied [B §0.1, §30].
- **Simulation category:** stays empty until Layer 8.
- **Audit:** changes write `CONFIGURATION_CHANGED`.

**K4-04, plan options and totals:**
- **Options:** a plan option belongs to one consultation (created from the workspace) or stands alone (created from the profile). Options of one consultation get the next free letter, A, B, C and on, which the provider can rename. There is no maximum [B §11.1].
- **Items:** an item names a catalog treatment, area, provider, description, quantity (default 1), unit price, discount amount, notes and proposed date [B §11.1]. Plan-level notes, proposed date and `financingReference` complete the Bible §11.1 fields.
- **Totals:** the server computes them; clients never send them (SR-INT-10).
  - Line total = quantity × unit price, rounded half-up to cents, less the discount.
  - The discount is never more than quantity × unit price (CHECK).
  - Subtotal, discount total and estimated total are the sums.
- **Money:** USD only (ADR-0006). DTOs carry amounts as decimal strings, never floating point. Estimates show amounts before any tax, and say so.
- **Not consent:** the plan's DTO and every screen that shows a plan say that accepting a plan is not consent to treatment [B §11.1].

**K4-05, the plan machine in Layer 4:**
- **Rows used in Layer 4:**
  - `DRAFT → PROPOSED` (`/propose`);
  - `PROPOSED → ACCEPTED | DECLINED` recorded in clinic (K4-06);
  - sibling declines (K4-07);
  - `ACCEPTED → SCHEDULED → COMPLETED | CANCELLED` (K4-08).
- **Two added rows, both proposals:**
  - `DRAFT → CANCELLED` discards a draft, since nothing is deleted;
  - `PROPOSED → DRAFT` (`/revise`) lets the provider change an option before the patient responds.
- **Layer 5 rows:** `/send`, `VIEWED` and expiry come with the patient app. A plan sent before then could never be viewed and would only expire.
- **Edits:** only a `DRAFT` plan's fields and items change.
- **Enforcement:** a database trigger enforces the transition table and the frozen content, as for consultations (ADR-0026 K3-01, K3-02).

**K4-06, in-clinic plan response (UD-14):**
- **Endpoint:** `POST …/{planId}/record-response` with `ACCEPTED` or `DECLINED`, from `PROPOSED`, by `treatmentplan.send` (SURGEON_PHYSICIAN and CONSULTANT in the default matrix).
- **Patient attestation:**
  - The provider hands the device to the patient in the locked hand-off of K4-13, scoped to this one response.
  - The patient sees the option, its items, its estimated total, and "Accepting this plan is not consent to treatment".
  - The patient chooses accept or decline and types their name.
- **Stored on the plan:** the response channel `IN_CLINIC`, the exact attestation text shown, the typed name, and the staff member who opened the hand-off. These are schema additions.
- **Audit:** `TREATMENT_PLAN_STATUS_CHANGED`, with the channel and without the name.

**K4-09, procedures:**
- **Machine:** spec §5.4.10, `PLANNED → SCHEDULED → COMPLETED` and `PLANNED | SCHEDULED → CANCELLED`, enforced by a trigger. Each transition writes `PROCEDURE_STATUS_CHANGED`.
- **Creating one:** from an accepted plan (K4-08), or directly by `procedure.manage`. A procedure is practice-owned; its location is optional.
- **Fields:** treatment, area, scheduled time (`SCHEDULED` needs one), performer and performed time (`COMPLETED` needs both), and free-text notes. Notes never appear in audit metadata or logs.
- **No dosing fields:** there are no dose, product or lot fields and no computed amounts. The platform never recommends dosing or treatment [B §30].
- **Photo sessions:** Layer 4 adds `PhotoSession.procedureId` with its same-patient foreign key (a spec §5.8 forward reference). A session can be taken for a procedure, as one is for a consultation (ADR-0026 K3-09).
- **Where it shows:** the profile's Procedures tab fills in.

**K4-10, estimates:**
- **Issuing:** an estimate is issued for a plan in `PROPOSED`, `ACCEPTED` or `SCHEDULED` (`treatmentplan.edit`, `Idempotency-Key`). It freezes the items and totals as they are at that moment.
- **Versions:** they are numbered per plan. Issuing a new one supersedes the previous `ISSUED` estimate in the same transaction, so a plan has at most one current estimate.
- **Voiding:** with a reason, stored but not audited, as for cancellations (ADR-0026 K3-05).
- **PDF:** the api renders it with PDFKit and Inter, as it does the consultation summary (ADR-0026 K3-17), as a `Document` of type `ESTIMATE` with one immutable version.
  - **Contents:** practice, patient name and date of birth, option label, items, totals, "estimate, not a bill", "amounts before tax", "accepting a plan is not consent to treatment", the validity date if the provider sets one, and the estimate number.
- **Reading:** with `treatmentplan.create`; the PDF downloads with `document.read`. Nothing reaches a patient before Layer 5.
- **Enforcement:** the database already enforces "issued is frozen" and the forward-only states (R8–R9).

**K4-11, consent templates and the builder:**
- **Blocks:** the 13 Bible block types of spec §6.6.6, each validated against a versioned JSON schema.
  - `IMAGE` and `VIDEO_ACKNOWLEDGMENT` blocks point at a published image or video version in the education library (K4-17). Consents and education then share one scanned, licensed media path.
- **Required responses:**
  - `REQUIRED_CHECKBOX` is always required.
  - `INITIAL`, `TEXT_FIELD`, `DATE` and `VIDEO_ACKNOWLEDGMENT` carry a `required` flag: on by default for `INITIAL` and `VIDEO_ACKNOWLEDGMENT`, off for the others.
  - `CHECKBOX` is never required.
- **Signatures:** a version has exactly one `PATIENT_SIGNATURE`, and at most one `PROVIDER_SIGNATURE` and one `WITNESS_SIGNATURE`. Those two blocks set `requiresProviderSignature` and `requiresWitnessSignature`.
- **Versions:** one draft per template; publishing freezes it (F1–F6).
  - `contentHash` is the SHA-256 of the version's blocks and signature flags, canonicalized by RFC 8785 (JSON Canonicalization Scheme).
  - `CONSENT_TEMPLATE_PUBLISHED` records the hash.
- **Retiring:** a retired template takes no new assignments; existing ones are untouched [B §12.2].
- **Scope:** a practice-scoped admin manages its practice's templates; organization-wide templates need organization scope (K4-22).
- **Text:** template text is the practice's own or licensed. The builder says so at publishing, and nothing is copied from a vendor [B §0.1, §30].
- **Shipped templates:** none. Template content is the practice's clinical and legal responsibility (§3).

**K4-12, the consent lifecycle:**
- **Prepare:** from the latest `PUBLISHED` version of a template, optionally linked to a consultation, plan or procedure of the same patient and practice. It writes `CONSENT_STATUS_CHANGED`.
- **Discard a draft:** a new row, `DRAFT → VOIDED`, with a reason. A draft is never visible to the patient and is never deleted.
- **Responses:** saved under `If-Match`. The first one moves `VIEWED → IN_PROGRESS`.
- **Missing responses:** a patient signature without every required response answers `422 CONSENT_INCOMPLETE`, with `details.missing` listing the block IDs.
- **Completion:** when the last required signature arrives, the same transaction generates the snapshot and hash (K4-15) and moves the consent to `COMPLETE`.
- **Enforcement:** a database trigger enforces the whole spec §5.4.4 table, not only the frozen executed states (F8–F12, R5–R6), as for consultations (ADR-0026 K3-01).

**K4-13, staff-assisted in-clinic signing (UD-31):**
- **Opening:** `POST …/{consentId}/patient-signing` (`consent.assign`, `Idempotency-Key`) for a consent in `ASSIGNED`, `VIEWED` or `IN_PROGRESS`.
- **Identity:**
  - The start screen shows the patient's name and date of birth.
  - The staff member confirms they have checked the patient's identity, and that confirmation is stored with the hand-off.
  - Before Layer 5 the patient has no account: `signerUserId` stays empty and the signature records the patient's name.
- **The hand-off token:**
  - It is a separate, hashed, single-consent token tied to the staff member's session and device.
  - It ends after 15 minutes without activity, and at most 60 minutes after opening.
  - It can only read the consent, mark it viewed, save responses and add the patient signature, through hand-off routes that accept nothing else.
  - The staff session cannot call those routes, and the token can call nothing else.
- **Audit:**
  - Rows for the patient's actions in the hand-off name the staff member who opened it (actor type `USER`), with metadata marking the hand-off and its ID.
  - The audit trail therefore says the patient acted in a hand-off this staff member opened.
  - The actor type is not changed, and no patient identity is invented before Layer 5.
- **On the device:**
  - Signing mode shows a persistent banner, and the patient cannot leave it (C13).
  - To exit, the signed-in staff member re-authenticates with Face ID or Touch ID through the app's existing biometric gate. Without biometrics, they enter their password and authenticator code ("Confirm it's you", ADR-0027).
  - Exiting revokes the token, and so does signing.
- **The plan response (K4-06)** uses the same hand-off, scoped to that response.

**K4-15, signed snapshot and hash:**
- **PDF:** the api renders it with PDFKit and Inter, as a `Document` of type `SIGNED_CONSENT` with one immutable version (F11).
  - It holds the template name, version and `contentHash`; the patient's name and date of birth; and every block as shown, with the responses.
  - It also holds each signature as drawn or typed, with the signer's name, role, time and attestation text; the hand-off marker; and the consent ID.
- **Hash:** `signedSnapshotHash` is the SHA-256 of the PDF bytes, the same value as `DocumentVersion.sha256`. A trigger checks they match.
- **Anchoring (THREAT_MODEL.md item 14):** `CONSENT_COMPLETED` carries the hash in its metadata, and the WORM audit copy archives every audit row (ADR-0023 K2-07). Each hash is therefore anchored outside the database without a new mechanism.
- **Download:** `POST …/{consentId}/access-urls` gives a signed URL valid 10 minutes, as for other documents (ADR-0026 K3-16), and writes `DOCUMENT_VIEWED`.

**K4-16, void, supersede and minors (UD-23):**
- **Void:** any non-terminal consent, or a `COMPLETE` one, can be voided with a reason of at most 500 characters (`consent.void`). The reason is stored, never audited or logged. Voiding never changes the snapshot, signatures or responses.
- **Void while it is evidence:** voiding a consent that a current media-permission grant cites as evidence answers `409 CONSENT_IS_EVIDENCE`. Staff first record a new permission version, with other evidence or as a revocation, so no permission is changed implicitly [B §7.1].
- **Supersede:** `/supersede` prepares the replacement from the template's latest published version. The old consent becomes `SUPERSEDED` when the replacement completes, in the same transaction, so a valid consent is never missing. If the replacement is voided first, the old one stays `COMPLETE`.
- **Minors, the owner's choice:**
  - Recommendation: minors are out of scope for the first production build. Preparing a consent for a patient under 18 on that day answers `422 PATIENT_IS_MINOR`, no guardian signer role is added, and F-38 closes as not needed.
  - Alternative: if the owner puts minors in scope, Layer 4 adds a `GUARDIAN` signer role, one guardian signature per consent and a guardian identity confirmation in the hand-off, through ADR-0028 and a schema change.

**K4-17, education library:**
- **Owner:** organization-wide; `content.manage` at organization scope changes it, and `content.read` reads and assigns it.
- **Types:** the nine Bible types: video, image, animation, text, PDF, procedure explanation, FAQ, pre-op instruction and post-op instruction.
- **Versions:** `DRAFT → PUBLISHED → RETIRED`, one draft, published frozen (R7).
- **Body:** structured text blocks (heading, paragraph, bullets) and at most one media file per version.
- **Media:** one write-once upload, verified and scanned like every upload (ADR-0023 K2-03, K2-04). No transcoding in Layer 4. Size limits:
  - MP4 (H.264 and AAC), at most 200 MiB;
  - JPEG or PNG, at most 20 MiB;
  - PDF, at most 50 MiB.
- **Licence:** each version records its source and licence, and publishing requires them, so only original or licensed content is used [B §0.1, §30]. This is a schema addition.
- **Audit:** changes write `CONFIGURATION_CHANGED`.

**K4-18, assignments and instructions:**
- **Published versions only (F-65):** education assignments and instructions point at `PUBLISHED` versions. The database enforces it with a trigger, as consents are held to published versions.
- **Education in Layer 4:**
  - Assigning, optionally to a consultation or procedure, writes `CONTENT_ASSIGNED`.
  - "Presented in the consultation" is recorded from the workspace.
- **Patient engagement:** the other states (`OPENED`, `VIEWED`, `COMPLETED`, `ACKNOWLEDGED`) come from the patient app. Which of them apply to which content type ("where appropriate", [B §12.5]) is decided at the Layer 5 kickoff, where they first occur.
- **Instructions:**
  - They point at pre-op or post-op instruction content.
  - They are assigned by procedure or consultation (CHECK) with `content.read`, writing `INSTRUCTION_ASSIGNED`.
  - They are clinically completed with `consultation.edit`, which records who and when [B §12.6].
- **Instruction release (F-42):** `/release` makes an instruction visible to the patient, so it comes with the patient app in Layer 5, needing `consultation.edit`. Releasing is a clinical decision, like completing.

**K4-20, the consultation workspace and profile:**
- **New steps** join in Bible §5.1 order, so the full list becomes reason and concerns, history, photography, annotate, **education**, before/after, **treatment plans**, **consents**, **instructions**, **next step**, notes, summary, and review and completion:
  - **Education** ("present assigned education");
  - **Treatment plans** ("discuss procedures", "create treatment plan options", "create estimate"), with the catalog, options, estimates and the in-clinic response;
  - **Consents** ("assign consents"), with in-clinic signing;
  - **Instructions** ("assign instructions");
  - **Next step** ("schedule/propose next step"): scheduling an accepted plan into procedures.
- **Not yet shown:** AI visualization steps (Layers 7–8).
- **Summary (extends ADR-0026 K3-17):**
  - It adds the consultation's plan options with their status and estimated totals, consents with their status, education presented, and instructions assigned.
  - It still holds no drafts and no images.
- **Completion:** the preconditions stay as in ADR-0026 K3-03; the new steps are guidance, not gates.
- **Profile:** the Treatment Plans, Procedures and Instructions tabs fill in, and Documents gains signed consents and estimates.

**K4-21, patient data export:**
- **Where:** requested in the admin portal by a holder of `data.export` (ORGANIZATION_ADMIN in the default matrix). The holder identifies the patient by patient ID or MRN; the portal shows the matched patient's name and date of birth to confirm, which writes `PATIENT_VIEWED`.
- **What it needs:**
  - a purpose: `PATIENT_REQUEST`, `TRANSFER_OF_CARE`, `LEGAL_REQUEST` or `OTHER` with a note;
  - step-up: a second factor within the last 15 minutes (ADR-0018);
  - at most 5 requests per user per hour (SR-AUZ-15).
- **Authority:** `data.export` is the authority for an export. It is a separate, audited, purpose-bound permission held by organization administrators. It is not the clinical read permissions, which those administrators do not hold.
- **Contents, one patient only:**
  - demographics and contacts;
  - consultations with final notes and addenda (no drafts);
  - concerns and medical history;
  - accepted photos as originals, with their annotations;
  - before/after sets;
  - plans and estimates with their PDFs;
  - consents with their signed snapshots;
  - documents, every clean version.
- **Format:** JSON and the stored PDFs and images, with a readable index. The file name holds no PHI.
- **Building it:** the worker builds a ZIP as a job (`DATA_EXPORT`) into the exports bucket (KMS, write-once), with status visible throughout [B §22.4]. The job runs `REQUESTED → RUNNING → COMPLETED | FAILED`, then `COMPLETED → EXPIRED`, or `REQUESTED → CANCELLED`.
- **Expiry:** after 7 days, by bucket lifecycle and a sweep.
- **Download:** a signed URL valid 10 minutes, with step-up. Each download writes `DATA_EXPORT_DOWNLOADED` and counts.
- **Audit:** `DATA_EXPORT_REQUESTED`, and `DATA_EXPORT_COMPLETED` with actor `SERVICE`.
- **Not in Layer 4:** organization-wide exports.

## 3. Owner inputs that do not block Layer 4

Layer 4 is built and proven locally and in CI; nothing is deployed.

| Needed | Before | Item |
|---|---|---|
| Whether minors are in scope (recommendation: no) | M4.6 | K4-16, F-38 |
| Legal review that the in-clinic electronic signature process meets ESIGN, UETA and the practice's state rules: identity confirmation, attestation text, the signed snapshot, and voiding | First clinical use | K4-13 to K4-16 |
| The practice's own consent templates and education content, written or licensed by the practice and reviewed by its clinical lead | First clinical use | K4-11, K4-17 |
| The estimate wording ("estimate, not a bill", "amounts before tax") and the export purposes reviewed by the practice's billing and privacy leads | First clinical use | K4-10, K4-21 |
| The open items of the earlier kickoffs (AWS accounts, Apple team, pilot metrics, repository visibility, the device camera check) | As listed there | F-32, F-33, F-56, F-59, F-69 |

## 4. After confirmation

1. The confirmed decisions are recorded as ADR-0028, with a `CHANGELOG.md` entry.
2. The spec, schema, `constraints.sql` and the documentation pack are corrected under change control:
   - spec §5.2, §5.8 and the schema: `Quote` and `QuoteStatus` leave; `InvoiceReference` moves to Layer 10; the plan's response fields (K4-06); `PhotoSession.procedureId` (K4-09); the education version's source and licence (K4-17);
   - spec §5.4.3: the sibling, discard and revise rows (K4-05, K4-07);
   - §5.4.4: the draft discard row (K4-12);
   - `constraints.sql` Layer 4: the plan, consent and procedure transition triggers; published-only assignments; the snapshot hash match; the `SIGNED_CONSENT` evidence check;
   - §6.2: `CONSENT_INCOMPLETE`, `CONSENT_IS_EVIDENCE` and, if minors stay out of scope, `PATIENT_IS_MINOR`;
   - §6.3: the record-response, revise and hand-off routes; `/schedule` with `procedure.manage`; `/send` and instruction `/release` marked Layer 5; the audit columns of K4-23;
   - §7.3: `PROCEDURE_STATUS_CHANGED`;
   - [CONSENT_ARCHITECTURE.md](CONSENT_ARCHITECTURE.md) and [WORKFLOWS.md](WORKFLOWS.md): their Layer 4 open items, marked decided.
3. F-38 to F-43 and F-65 are marked resolved or scheduled in [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) §5.3.
4. M4.1 starts.
