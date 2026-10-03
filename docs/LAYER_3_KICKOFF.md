# Layer 3 kickoff

| | |
|---|---|
| Version | 0.1 |
| Status | **Proposed 2026-10-03; awaiting the owner's confirmation.** Nothing here is adopted until the owner confirms it, and no Layer 3 code exists yet. |
| Authority | Bible §4.3 (profile tabs), §5 (consultation workflow), §6.6 (original protection), §7.3 (enforcement), §8 (before/after), §19.1, §22, §23 (offline), §27.2, §29 (Layer 3), §30, §33, §34.1 #12–21; ADR-0001, ADR-0004, ADR-0018, ADR-0022 to ADR-0025 |
| Normative sources | spec §5.2 (Scheduling & consultation; Photography & media; Documents), §5.4.1, §5.5, §5.8, §6.2, §6.3 (Patients rows marked L3; Consultations; Photography rows marked L3; Before / after; Documents), §6.7, §7.3, §8; [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) Step 6; [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) §5.3 |

Before any Layer 3 code, the roadmap requires confirming the decisions listed for the layer (UD-15, UD-28, UD-33). It also requires resolving the findings carried to Layer 3 (F-35's compatible-view rule, F-37, F-55's cancellation policy, F-64, F-68, F-70), the Layer 3 open items in the documentation pack, and the Node.js re-evaluation that ADR-0023 K2-22 scheduled here. This document gives one recommendation for each. Where a recommendation changes spec text, the spec is corrected under change control before implementation (Bible §0).

## 1. Scope (Bible §29)

**Authorized:** consultation lifecycle, annotations, before/after, timeline. The spec places here consultation notes and concerns, the patient's concerns and medical history, before/after sets with automatic registration, purpose-specific exports, and documents with the consultation summary (spec §5.8 Layer 3 row, §9.1 row 3).

**Exit condition:** a consultation with standardized imagery is functional [B §29], and Bible §34.1 #12–21 pass.

**Not authorized:** treatment plans, estimates, procedures, consents, education and instructions (Layer 4); releasing anything to a patient, including the consultation `/release` endpoint (Layer 5); appointments and the "schedule the next step" step (Layer 6; the appointment tables are not created early); AI visualization and its review (Layers 7–8).

Delivery follows micro-prompts M3.1–M3.9 in the roadmap. Each is written with the Bible §33 template and passes the Bible §27.2 definition of done.

## 2. Decisions

| ID | Topic | Recommendation | Source |
|---|---|---|---|
| K3-01 | Consultation transitions (UD-28) | Adopt the four proposed rows of spec §5.4.1: `/resume` (`AWAITING_INFORMATION → IN_PROGRESS`); `/submit-for-review` straight from `IN_PROGRESS`, because not every consultation waits for information; `/return-to-progress` (`READY_FOR_REVIEW → IN_PROGRESS`); and `/archive` of a `CANCELLED` consultation. A database trigger enforces the transition table, as it does for photos (ADR-0023 K2-05). | Bible §5.2; spec §5.4.1 |
| K3-02 | What each state allows | See the list after this table. | Bible §5.1, §5.2 |
| K3-03 | Completion preconditions (UD-33) | See the list after this table. | Bible §5.1; spec §5.4.1 |
| K3-04 | The release decision (F-37) | See the list after this table. | Bible §5.1, §13.2 |
| K3-05 | Cancellation policy (F-55) | Any non-final state may be cancelled by `consultation.edit` within the consultation's practice, with a required reason of at most 500 characters. The reason is stored on the consultation and never put in audit metadata or logs. Nothing attached is deleted or detached: notes, photo sessions and documents stay in the record. Layer 3 has no configurable policy: the policy is "always, with a reason". A practice setting that restricts cancellation can be added later if a customer needs one. | Bible §5.2 |
| K3-06 | Offline consultation work (F-64) | See the list after this table. | Bible §23; spec §8 |
| K3-07 | Notes and final-note corrections (UD-15) | See the list after this table. | Bible §5.1, §23.1; spec §5.2 |
| K3-08 | Concerns and medical history | See the list after this table. | Bible §5.1, §19.1; spec §5.2, §6.3 |
| K3-09 | Photo sessions in a consultation | Layer 3 adds `PhotoSession.consultationId` with its same-patient foreign key (spec §5.8 forward reference). A session started from the workspace is linked to the consultation, which must be `IN_PROGRESS` or `AWAITING_INFORMATION` and of the same patient, with its practice in the capturer's scope. The gallery filters by consultation. Sessions started outside a consultation stay unlinked, as in Layer 2. | Bible §5.1, §6.1 |
| K3-10 | Annotations | See the list after this table. | Bible §5.1, §6.6, §23.1 |
| K3-11 | Before/after sets and the compatible-view rule (F-35) | See the list after this table. | Bible §8.1, §34.1 #12–14, #20 |
| K3-12 | Comparison viewer | See the list after this table. | Bible §8.2, §34.1 #15–16 |
| K3-13 | Automatic registration and manual alignment | See the list after this table. | Bible §8.1, §8.2, §34.1 #17; spec §6.7 |
| K3-14 | Export purposes and derivative kinds (PHOTO_ARCHITECTURE.md open item) | Export purposes: `CLINICAL_USE`, `EDUCATION`, `WEBSITE`, `SOCIAL_MEDIA`, `PAID_ADVERTISING` and `RESEARCH`. `PATIENT_APP` is a release (Layer 2), not an export; `AI_TRAINING` and `INTERNAL_AI_EVALUATION` are dataset uses (Layer 7). Derivative kinds: a before/after composite is `BEFORE_AFTER_DERIVATIVE`; a single photo with one annotation layer drawn in is `ANNOTATED_DERIVATIVE`; any other single photo is `MARKETING_DERIVATIVE` for `WEBSITE`, `SOCIAL_MEDIA` and `PAID_ADVERTISING` and `EXPORT_DERIVATIVE` otherwise. The kind says what the image is; the purpose is recorded on the release. | Bible §7.1, §8.3; spec §6.6 |
| K3-15 | Export (M3.7) | See the list after this table. | Bible §7.3, §8.3, §22.4, §34.1 #18–19, #21 |
| K3-16 | Documents | See the list after this table. | Bible §12, §13.2, §14.4; spec §5.2, §6.3 |
| K3-17 | Consultation summary | See the list after this table. | Bible §5.1 |
| K3-18 | Patient timeline | See the list after this table. | Bible §4.3; spec §6.3 (`/timeline`) |
| K3-19 | Audit events | The spec's Layer 3 events: `CONSULTATION_CREATED`, `CONSULTATION_STATUS_CHANGED`, `CONSULTATION_COMPLETED`, `PHOTO_ANNOTATED`, `BEFORE_AFTER_CREATED`, `PHOTO_EXPORTED`, `DOCUMENT_VIEWED`, `PATIENT_UPDATED` (concerns and medical history), `CONFIGURATION_CHANGED` (the new flag) and `ACCESS_DENIED` on the new patient routes. Two additions: `CONSULTATION_NOTE_FINALIZED` (a final note becomes part of the legal record, and spec §6.3 audits nothing for it) and `DOCUMENT_ADDED` (an uploaded document or a generated summary, including each new version). Metadata never holds note text, concern or history descriptions, reasons or titles [B §22.2]. | Bible §22.1, §22.2; spec §7.3 |
| K3-20 | Practice ownership | Consultations are practice-owned: creating and changing one, its notes, its concern links and its summary, and linking a photo session to it, need a grant covering its practice (spec §4.6). Patient-level data is organization-owned: concerns, medical history, annotations, before/after sets and uploaded documents. Reads span the organization (ADR-0001). The generated cross-tenant tests cover every new operation. | ADR-0001; spec §4.6; AUTHORIZATION_RBAC.md open items |
| K3-21 | Consultation workspace (M3.2) | See the list after this table. | Bible §5.1, §24.4, §24.5 |
| K3-22 | Snapshot references (F-68) and Layer 3 test tooling | See the list after this table. | ADR-0023 K2-21; ADR-0025 |
| K3-23 | The iPad main-thread hang (F-70) | Fixed in the app before the Layer 3 acceptance, as F-70 already requires. CI samples the app's main thread when XCTest reports it busy and prints the sample on a failure; the fix follows from that sample. If the hang has not recurred by M3.2, M3.2 reworks the iPad navigation anyway: the workspace replaces today's sidebar tab view around a split view, the nesting the run 91 device log points at. Layer 3 adds the audits of the workspace, the annotation editor and the comparison viewer on both devices. | ACCEPTANCE_CRITERIA.md F-70 |
| K3-24 | Node.js 26 (K2-22) | Stay on Node.js 24 LTS through Layer 3. Node 26 is not yet Active LTS today; it is due to enter it in late October 2026. Re-evaluate at the Layer 4 kickoff, then move as a separate, tested change if its dependencies support it. | spec §2.1 |

**K3-02, what each state allows:**
- `DRAFT`: reason, primary provider, location and selected concerns can change. No notes yet: `/start` comes first.
- `IN_PROGRESS` and `AWAITING_INFORMATION`: everything can change; notes are drafted and finalized; photo sessions can be linked.
- `READY_FOR_REVIEW`: the content under review is frozen: reason, provider, location, concerns and notes. Changing any of it means `/return-to-progress`. The summary is generated in this state (K3-17).
- `COMPLETED`: frozen, except addenda to final notes (K3-07) and regenerating the summary after one.
- `CANCELLED` and `ARCHIVED`: frozen.
- Archived consultations are hidden from lists by default and shown by a filter with a badge, as archived photos are (ADR-0023 K2-14).
- A database trigger enforces the frozen columns, as the original's protection is enforced in Layer 2.

**K3-03, completion preconditions:**
- Adopt the spec §5.4.1 table. `/complete` checks all five preconditions and answers `422 COMPLETION_PRECONDITIONS_NOT_MET`, with `details.unmet` listing a code for each one that fails, so the workspace can say what is left:
  - a reason or at least one concern is recorded;
  - no simulation is `QUEUED`, `PROCESSING` or `VALIDATING` (true by construction until Layer 8 creates simulations; the check is written then);
  - a consultation summary was generated after the consultation last entered `READY_FOR_REVIEW`, so it shows what was reviewed;
  - a release decision is recorded (K3-04);
  - no note of the consultation is `DRAFT`.
- `/submit-for-review` already requires that no note is `DRAFT`, because notes are frozen in review (K3-02).
- The other Bible §5.1 steps stay guidance, not gates, as spec §5.4.1 says.

**K3-04, the release decision:**
- New columns on `Consultation`: `releaseDecision` (`NOTHING_TO_RELEASE` or `MATERIALS_RELEASED`), `releaseDecidedAt` and `releaseDecidedById`. A CHECK requires all three together, and requires them for `COMPLETED`.
- In Layer 3 the `/complete` request carries `releaseDecision`, and only `NOTHING_TO_RELEASE` is accepted, because nothing reaches a patient before Layer 5. The provider confirms it in the workspace in those words.
- Layer 5's `POST …/{cid}/release` records `MATERIALS_RELEASED` before completion. Documents and photos can still be released after completion through their own release actions.

**K3-06, offline consultation work:**
- **Online only:** creating a consultation, every transition, finalizing a note, generating the summary, creating a before/after set, registration, export and document upload. All of these need the server's state machine, permission checks or real-time grant checks (spec §8).
- **Offline:** drafting notes (create and edit one's own drafts, with client IDs and `If-Match`); annotating cached photos (K3-10); capturing photos into a session linked to a consultation (Layer 2 queue).
- **Cache:** for each cached patient, under the existing `offline.cachePolicy`, the patient's non-final consultations with their concerns and notes, and the medical history. They are sealed in the Layer 2 encrypted store and purged with it.
- A `412 VERSION_CONFLICT` on replay shows both versions; nothing is resolved by newest timestamp (spec §8 rule 4).

**K3-07, notes and final-note corrections:**
- A `FINAL` note is immutable (database trigger, already in `constraints.sql`).
- **Corrections are addenda:** a new column `ConsultationNote.correctsNoteId` points at the `FINAL` note it corrects, in the same consultation (trigger-checked). An addendum is itself a note, drafted and then finalized. The workspace shows each final note with its addenda.
- Anyone with `consultation.edit` covering the practice may write notes. Only the author edits, finalizes or discards their own draft, so every note has one clinical author.
- After completion only addenda may be written.
- A note body is plain text of at most 20,000 characters and is never logged.
- Finalizing writes `CONSULTATION_NOTE_FINALIZED` (K3-19) and needs a connection (K3-06).

**K3-08, concerns and medical history:**
- **Concerns:** an area from a list registered in code, as flag keys are (ADR-0023 K2-18), plus a description of at most 500 characters. Proposed areas: `FOREHEAD`, `BROW`, `EYES`, `NOSE`, `CHEEKS`, `LIPS`, `CHIN`, `JAWLINE`, `NECK`, `FACE_SKIN`, `BREAST`, `ABDOMEN`, `FLANKS`, `BACK`, `BUTTOCKS`, `ARMS`, `THIGHS`, `BODY_SKIN`, `OTHER`. Changing the list is a reviewed code change. A concern can be marked resolved. A consultation selects its concerns with `PUT …/{cid}/concerns`.
- **Medical history:** the schema's categories (allergy, medication, condition, prior procedure, prior aesthetic treatment, other), a description and optional structured details.
  - Layer 3 records the source `STAFF` only; patient intake arrives in Layer 5 and integrations in Layer 10.
  - Entries are edited with `If-Match` and never deleted.
- Both are clinical: readable with `consultation.create` (read), not with `patient.read` (spec §6.3). Changes write `PATIENT_UPDATED` without values.

**K3-10, annotations:**
- **Format:** a versioned JSON layer (`schemaVersion` 1) of shapes: freehand stroke, line, arrow, ellipse, rectangle and text label.
  - Coordinates are normalized to the upright photo.
  - Colours come from a fixed palette in the design tokens, and stroke widths from a fixed set.
  - A layer holds at most 500 shapes and 256 KiB, and a label at most 200 characters.
- **No measurement tools:** no lengths, areas or angles. A drawing is never a medical measurement (the same reasoning as Bible §6.5).
- **Drawing:** in the provider app, drawn with SwiftUI's Canvas and gestures, with Apple Pencil on iPad and touch on both devices. PencilKit's own drawing format is not stored.
- **Who changes what:** only `ACCEPTED`, unarchived photos are annotated. Only the author edits or deletes their own layer. Deleting sets `deletedAt` and keeps the row.
- **Audit:** create, update and delete write `PHOTO_ANNOTATED`.
- **Offline:** annotations of cached photos are created offline with client IDs and replay with `If-Match`.
- The original is never touched. A layer reaches pixels only in an export (K3-14).

**K3-11, before/after sets and the compatible-view rule:**
- **Photos:** exactly two different photos, both `ACCEPTED`, unarchived and of this patient.
- **Compatible view:** the two photos have the same view key, and their protocol views have the same pose target (subject and target yaw). So `FRONT` of the Face protocol never pairs with `FRONT` of the Abdomen/body protocol, while two custom protocols can pair when their views match. Otherwise the request answers `422 INCOMPATIBLE_VIEWS`.
- **Order:** the before photo was captured earlier than the after photo; otherwise `422 BEFORE_AFTER_ORDER`.
- **Unknown photos:** a photo of another tenant or patient, or one that does not exist, answers the same `404 PHOTO_NOT_FOUND` [B §34.1 #13, #20].
- A set may name a consultation of the same patient, and has an optional title of at most 120 characters.
- Sets are not deleted in Layer 3 (spec §6.3 has no endpoint).

**K3-12, comparison viewer:**
- **Rendering:** the client draws the two display previews with the set's transform. Nothing is rendered on the server and the original is never read [B §8.2, §34.1 #14]. Opening a set fetches its previews through the batch access-URL endpoint, so each view writes `PHOTO_VIEWED`.
- **Modes:**
  - side by side;
  - swipe (a draggable divider);
  - cross-fade (a slider from before to after);
  - blink (alternating at a chosen rate, never faster than 3 per second, the WCAG flash threshold);
  - overlay (both at once, the after semi-transparent over the before at a chosen opacity).
- **Zoom and pan** are synchronized by default and can be unlinked. Reset returns to the fitted view.
- **Devices:** on iPad every mode, landscape first. On iPhone every mode, with side by side stacked in portrait.

**K3-13, automatic registration and manual alignment:**
- **Transform:** a similarity transform only (uniform scale, rotation, translation), applied to the after image in the before image's normalized coordinates. No shear and no perspective, so alignment can never reshape anatomy.
- **Automatic registration:** an `AIJob` of type `IMAGE_REGISTRATION` (no model).
  - image-processing receives presigned URLs of the two display previews, never the originals.
  - It matches AKAZE features with OpenCV and estimates the transform with RANSAC.
  - It returns the transform and an inlier count; no image is written.
  - OpenCV joins as `opencv-python-headless` (Apache-2.0), as ADR-0023 K2-01 planned. Images are still decoded only by pyvips, under the Layer 2 sandbox; OpenCV only receives pixel arrays.
- **When no alignment is found:** too few inliers, a scale outside 0.5–2, or a rotation beyond 20° fails the job with "No reliable alignment found", and the set stays as it was.
- **When the job finishes:** the result is written only if the set has not changed since the request. A manual alignment made meanwhile wins.
- **Manual alignment:** `PATCH …/{setId}` with mode `MANUAL` and a transform. **Reset** sets mode `NONE` and clears the transform (already a CHECK).
- **Permissions:** `photo.annotate` for every alignment change. This corrects spec §6.3, which lists `photo.view` for `/auto-registration`: a change to a set's alignment needs the same permission however it is made.
- **Disabling it:** the flag `beforeAfter.autoRegistration` (on by default) hides automatic registration for an organization or practice [B §34.1 #17]. Registration never runs unless a user asks for it.

**K3-15, export:**
- **Starting an export:** `POST …/photos/{phid}/exports` or `…/before-after/{setId}/exports` with a purpose (and, for a photo, optionally one annotation layer). It needs `photo.export` and step-up: MFA within the last 15 minutes (ADR-0018). This designates export as a step-up action for SECURITY_REQUIREMENTS.md open item 6.
- **The grant check:** the api checks the current effective grant for the purpose on each photo, both photos of a set. A missing, revoked or expired grant answers `403 MEDIA_PERMISSION_NOT_GRANTED` [B §34.1 #18]. Otherwise one transaction:
  - registers the output object;
  - creates the derivative and a `MediaRelease` whose subject is the derivative, pinning every permission version relied on;
  - queues the job;
  - writes one `PHOTO_EXPORTED` per photo [B §34.1 #19].
- **Rendering:** image-processing renders the export with the Layer 2 derivative job, from the original through a presigned URL issued for that job.
  - The output is upright, sRGB, without metadata, and at most 4096 px on its long edge.
  - A set is rendered side by side at equal height, with the after image aligned by the set's transform.
  - The output has no text, dates, names or logos.
- **Status:** the export shows pending, ready or failed; there is no hidden background work [B §22.4]. A failed render leaves no file and says so [B §34.1 #21 "export failure"].
- **Download:** a signed URL, valid 10 minutes, with `photo.export` and step-up, while the release is active. Each download writes `PHOTO_VIEWED` for the exported photos. The app hands the file to the iOS share sheet from a temporary file that it deletes afterwards.
- **Revocation:** a grant that ends revokes the release (ADR-0023 K2-15), and the export can no longer be downloaded.
- **Where:** in Layer 3 the provider app is the only place to export.

**K3-16, documents:**
- **Types in Layer 3:** `CONSULTATION_SUMMARY` (generated, K3-17) and `UPLOADED_CLINICAL` (a PDF uploaded by staff). The other types arrive with their layers.
- **Upload:**
  - PDF only, at most 50 MiB, first bytes `%PDF-`.
  - One presigned write-once `PUT`, completed with checksum verification and scanned like every upload (ADR-0023 K2-03, K2-04).
  - Uploading to an existing document adds a version.
  - Terraform adds the `DOCUMENT/` prefix to the presigning role and to the GuardDuty plan.
- **Reading:** `document.read`. A signed download URL, valid 10 minutes, served as an attachment, writes `DOCUMENT_VIEWED`. Documents are not cached offline.
- **Changing:** `document.manage` for uploads.
- **Patients:** `releasedToPatientAt` stays empty until Layer 5.

**K3-17, consultation summary:**
- **How:** `POST …/{cid}/summary` (idempotent) renders a PDF in the api with PDFKit (MIT), embedding Inter (SIL Open Font License), the first face in the design-token stack that may be embedded. Each generation adds a version to the consultation's one `CONSULTATION_SUMMARY` document (write-once object, SHA-256) and writes `DOCUMENT_ADDED`.
- **When:** in `READY_FOR_REVIEW`, or after an addendum to a completed consultation.
- **Contents:** practice, patient name, date of birth and MRN, consultation date, provider, reason, concerns, final notes with their addenda, and the photo sessions and views captured.
- **Not included:** no drafts and no images. Photos reach a patient only through media releases, which check the `PATIENT_APP` grant [B §7.3]; an image inside a PDF would bypass that check.
- **Scanning:** the summary is generated by the platform, not uploaded, so it is not scanned (K2-04 scans uploads).

**K3-18, patient timeline:**
- **Source:** built from the domain tables, not from the audit log, newest first, with cursor pagination and a filter by kind.
- **Items:**
  - patient created and archived (`patient.read`);
  - consultations created, started, submitted, completed, cancelled and archived (`consultation.create` read);
  - photo sessions completed and before/after sets created (`photo.view`);
  - documents added (`document.read`);
  - media permission changes and releases (`photo.permission.read`).
- **Filtering:** each item is shown only to a caller with its domain permission (spec §6.3), so a demographics-only role sees only demographic items.
- **Content:** metadata only: type, time, actor and an opaque link, never note text or descriptions.

**K3-21, consultation workspace:**
- **iPad:** a stepper along Bible §5.1, opened from the patient profile's Consultations tab.
- **Steps in Layer 3:** reason and concerns; review history; photography (protocol, capture and quality review, from Layer 2); annotate; before/after; notes; summary; release decision and completion.
- **Later steps:** the steps of later layers (education, procedures, AI visualization, plans, estimates, consents, instructions, scheduling) are **not shown** until their layer delivers them, so the workspace has no placeholders (Bible §30).
- **iPhone:** the same steps as a list in a navigation stack.
- **Profile tabs:** the profile's Timeline, Consultations, Before/After and Documents tabs fill in.
- **Modules:** `ConsultationDomain`, `Annotations` and `BeforeAfter` are built, and `DocumentsConsent` starts with documents (its consent half stays Layer 4).
- **States:** every screen has its loading, empty, error, permission-denied and offline states [B §27.2].

**K3-22, snapshot references and test tooling:**
- **F-68 (owner choice):** the recommended option needs no workflow with write access to the repository.
  - A CI step on the macOS runner records any missing reference image and prints it into the job log, as the UI screenshots are printed today.
  - Claude decodes the images, reviews them and commits them to the branch, where the owner sees them in the pull request.
  - From then on the snapshot tests compare against the committed references and run in the `ios` job.
  - The alternative is that the owner records the references on a Mac with Xcode and commits them.
- **Layer 3 tests:**
  - pytest for registration (known transforms recovered within tolerance; featureless images fail cleanly);
  - api and database tests for each machine, precondition, trigger and cross-tenant case;
  - the UI test extended to a consultation from creation to completion with a before/after comparison and an export;
  - accessibility audits of the new screens on both devices.

## 3. Owner inputs that do not block Layer 3

Layer 3 is built and proven locally and in CI; nothing is deployed.

| Needed | Before | Item |
|---|---|---|
| Choose how snapshot references are recorded (K3-22) | The snapshot tests join CI (during Layer 3) | F-68 |
| The concern-area list (K3-08) and the summary's contents (K3-17) reviewed by the practice's clinical lead | First clinical use | K3-08, K3-17 |
| The open items of [LAYER_2_KICKOFF.md](LAYER_2_KICKOFF.md) §3 and [LAYER_1_KICKOFF.md](LAYER_1_KICKOFF.md) §3 (BAA scope of malware scanning, AWS accounts, Apple team, pilot metrics, repository visibility) | As listed there | F-32, F-33, F-56, F-59, UD-34 |
| The device camera check | First clinical use | F-69 |

## 4. After confirmation

1. The confirmed decisions are recorded as ADR-0026.
2. The spec, schema, `constraints.sql` and the documentation pack are corrected under change control:
   - spec §5.4.1 (UD-28, UD-33, the review freeze, the release decision);
   - §5.2 and the schema (`releaseDecision`, `correctsNoteId`, `PhotoSession.consultationId`);
   - `constraints.sql` Layer 3 (the consultation machine and frozen columns, note and addendum rules);
   - §6.2 (`COMPLETION_PRECONDITIONS_NOT_MET`, `INCOMPATIBLE_VIEWS`, `BEFORE_AFTER_ORDER`);
   - §6.3 (the `/auto-registration` permission, the `/complete` body, the export endpoints);
   - §6.7 (`image.registration.*` and export outputs);
   - §7.3 (`CONSULTATION_NOTE_FINALIZED`, `DOCUMENT_ADDED`);
   - §8 (offline consultation work).
3. F-35 (compatible view), F-37, F-55 (cancellation), F-64 and, once chosen, F-68 are marked resolved in [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) §5.3; F-70 stays open until its fix.
4. M3.1 starts.
