# Changelog

All material changes to the architecture, contracts and repository. Newest first. Entries reference ADRs in `ARCHITECTURE_DECISIONS.md`.

## 2026-10-07: Layer 4 kickoff proposed

- `LAYER_4_KICKOFF.md` proposes K4-01 to K4-27: one recommendation for each Layer 4 decision (UD-11 estimates only and no quote, UD-14 the in-clinic response with patient attestation and sibling declines, UD-23 void and minors, UD-31 the staff-assisted hand-off), each finding carried to Layer 4 (F-38 to F-43, F-65), the Layer 4 open items in the documentation pack, and the Node.js re-evaluation scheduled by ADR-0026 K3-24 (stay on Node 24 through Layer 4).
- Owner choices flagged: whether minors are in scope (recommendation: no), and legal review of the in-clinic electronic signature before first clinical use.
- Nothing of Layer 4 is built until the owner confirms; the confirmed decisions become ADR-0028.

## 2026-10-07: Layer 3 accepted

- The owner accepted the Layer 3 review (`ACCEPTANCE_CRITERIA.md` §8) on 2026-10-07. F-68 and F-70 are resolved; F-69 (the device camera check before first clinical use) stays open, with the owner items F-33, F-56 and F-59.
- Layer 4 (documents, consent, education, treatment plans) begins with its kickoff, which the owner confirms before any Layer 4 work.

## 2026-10-04: Layer 3 acceptance review (M3.9)

- `ACCEPTANCE_CRITERIA.md` §8 reviews Layer 3 against the Bible §29 exit condition ("consultation with standardized imagery is functional") and Bible §34.1 #12–21: 21 criteria, all PASS, on [CI run 114](https://github.com/cgibson24/Aestara/actions/runs/37195947250) (commit `c7679c3`), green in all nine jobs with the UI test passing on iPhone and iPad. Sign-off moves to §9; Layer 3 awaits the owner's sign-off.
- Findings: F-68 resolved (40 snapshot references committed and compared on every push); F-70 resolved (no busy main thread on the iPad in the reworked shell; the Layer 3 rebuilds found and fixed, ADR-0027).
- `TESTING_STRATEGY.md` §18.2 names the tests that cover Bible §34.1 #12–21.
- The snapshot test's trait helper runs on the main actor (three Swift concurrency warnings).

## 2026-10-04: All snapshot references committed; UI test typing and CI output fixed (F-68)

- **Snapshot references:** the 18 pictures recorded with the app's tint (view states, annotation editor, alignment editor, the five comparison modes on iPhone and iPad) are reviewed and committed. All 40 references of `ProviderSnapshotsTests` are in the repository and compared on every push.
- **UI test typing:** a field is typed into only once it has the keyboard's focus, and short fields are checked for every key: typing that started while the keyboard was still appearing kept only the "B" of "Baseline" (run 37190303393).
- **Accessibility:** the annotation editor's Undo button takes its whole 44-pt frame (the audit on iPad measured 20 × 17 pt: the frame sat outside the button); the concern menu's frame takes the tap too.
- **CI:** the UI step's api stack writes through `cat`. Node made the step's output non-blocking, and a long device log then made `echo` fail with "Resource temporarily unavailable", which ended the step before the iPad ran.

## 2026-10-04: Annotation and comparison screens are pushed in the workspace and keep their state (F-70; ADR-0027)

- **Cause found:** the lifecycle trace showed the iPad rebuilding the full-screen annotation screen on every text-size change of the accessibility audit, while the step that presented it stayed. The drawing in progress was lost, and each rebuild fetched the photo's preview again. The iPhone did not rebuild it.
- **Fix:** the annotation step creates one model per opened photo (its workbench, preview and drawing in progress); the before/after list creates one comparison session per opened set (the set, its previews, the viewing mode and an alignment in progress). A rebuilt screen shows the same state and fetches nothing again.
- **No full-screen screen over the workspace:** the next run showed the comparison screen rebuilt when the export sheet opened over it, which closed the sheet. Inside the workspace a photo and a before/after set are now pushed onto the workspace's own navigation stack instead; the profile's Before/After tab still opens a set full screen, where nothing full screen lies beneath it.
- **Accessibility audit of the comparison viewer:** "Reset view" takes a 44-pt row; the link toggle's label and the screen's notice keep their full height at large text sizes; the before photo in side by side is named by its pane's badge, as the after photo is.
- **UI test:** goes back out of a pushed photo, set or step to reach the steps and the workspace's Close button; drags the profile's tab strip from the middle of the screen.
- **Snapshot references:** the document rows and the accessibility-size timeline rows, recorded after their fixes, are reviewed and committed. The harness now applies the app's tint, set at the app's root, so toggles, sliders and links show the accent as in the app (the first comparison pictures showed the system's green and blue); the pictures with tinted controls (view states, annotation editor, alignment editor, comparison modes) are recorded again.

## 2026-10-04: Snapshot references and fixes found by them (F-68; ADR-0026 K3-22)

- **Snapshot references:** CI recorded the first references on the iPhone simulator and printed them into its log; 34 were reviewed and committed under `apps/ios-provider/Snapshots/Tests/ProviderSnapshotsTests/__Snapshots__/`. The document rows and the accessibility-size timeline rows are recorded again after the fixes below.
- **Accessibility sizes:** the pictures are measured at their text size (the look sets the environment as well as the traits). Consultation rows stack their status and date; document rows put their details on one line only when they fit, and stack them otherwise; a badge wraps instead of cutting its word off; the timeline's icon column grows with the text.
- **F-70 diagnosis:** Debug builds record in the device log when the workspace, its steps, the annotation screens and the comparison screen appear and disappear, with a number that changes when SwiftUI rebuilds a screen. CI samples the app up to four times when XCTest reports its main thread busy, taking the app's process number from that log line, and prints the samples whether the test passes or fails.
- **Tests:** the alignment test compares both originals' object key and SHA-256 before and after aligning and resetting [B §34.1 #14]; the UI test picks the older of the patient's two front photos as the before photo.

## 2026-10-04: Annotations, comparisons and exports in the provider app (M3.4–M3.7 iOS; ADR-0027)

- **Annotations:** the workspace's Annotate step lists the consultation's accepted photos (offline, the ones saved on the device). A photo opens over its display preview with every layer, each shown or hidden; one's own layers are drawn with SwiftUI `Canvas` and drag gestures (finger or Apple Pencil): freehand, line, arrow, ellipse, rectangle and text, in the token palette and the fixed widths and sizes, with no measurement tools. Layers travel as the contract's JSON. Offline, layers drawn over cached photos wait in the encrypted queue with their client UUIDv7; a `412` keeps both drawings for the author.
- **Before/after:** the profile's Before/After tab and the workspace step list the sets; a new set pairs a before photo with a later photo of the same view. The viewer draws the two display previews with the set's transform in five modes (side by side, swipe, cross-fade, blink at most 3 changes a second, overlay), with zoom and pan linked or unlinked. Alignment by hand (drag, pinch, rotate or step buttons), automatic alignment when the flag allows it (followed until it ends), and reset.
- **Exports:** from a photo (optionally with one layer) or a set, for one purpose; purposes the patient has not granted are marked. The export is followed until ready, failed or revoked, then shared from a temporary file deleted when the share sheet closes.
- **Step-up:** `403 REAUTHENTICATION_REQUIRED` opens "Confirm it's you": the password and, when the account has one, the authenticator code sign the same user in again in the same organization; the old session is logged out and nothing on the device is cleared.
- **Sign-out:** unsent note drafts and annotation layers are counted together as drafts.
- **If-Match:** the generated client wrote header values as URI components, so an ETag went out as `%22v3%22` and the api refused every change that needs `If-Match` (found by the UI test, the first use of a versioned change in the app). A client middleware now sends the literal ETag, with a module test.
- **Modules:** `Annotations` (models, repository, offline store, renderer, editor, screen), `BeforeAfter` (models, repository, viewer, alignment, list) and the export models in `Media`. Module tests: `ConsultationDomain` (7), `Annotations` (11, including the trip through the generated types) and `BeforeAfter` (6), run by CI.

## 2026-10-04: The consultation workspace in the provider app (M3.2, M3.3, M3.8 iOS; ADR-0026 K3-21, K3-23; ADR-0027)

- **Photography for a consultation (api):** a photo session may name a consultation of the patient that is `IN_PROGRESS` or `AWAITING_INFORMATION` (K3-09). It takes the consultation's practice and location; another practice answers `400 CONSULTATION_PRACTICE`, another state `409`. The session list filters by `consultationId`, and the DTO names it.
- **iPad shell (K3-23, F-70):** the sections sit in the first column of a split view beside each section's own columns; the sidebar-adaptable tab view that nested a split view is gone. iPhone keeps its tab bar.
- **Profile tabs:** Timeline (by domain, newest first, "Show older"), Consultations (archived on request, a new consultation in a practice, the open ones saved on the device), and Documents (PDF upload as a new document or a new version, preview from a temporary file deleted on close).
- **Workspace:** opened full screen from the Consultations tab; on iPad a stepper of the Layer 3 steps (reason and concerns, medical history, photography, notes, summary, review and completion), on iPhone the same steps in a navigation stack. Photos are taken for the consultation while it is under way. Completion lists what is left, records "nothing is released" and cancelling asks for a reason.
- **Notes offline (K3-06):** drafts and edits of one's own drafts wait in the encrypted queue with their client UUIDv7 and Idempotency-Key, replay after the session is re-validated, and a draft that moved on shows both texts for the author to keep one. Finalizing, transitions and the summary need a connection. Signing out counts unsent notes with unsent photos.
- **Modules:** `ConsultationDomain` (models, repository, offline store) and `DocumentsConsent` (documents) are built; the module graph gains their dependencies.

## 2026-10-04: Documents, consultation summary and patient timeline (M3.8 backend; ADR-0027)

- **Documents API:** list, read, upload intent, complete-upload and download (`document.read`, `document.manage`). Files are PDF only, at most 50 MiB, verified (size, SHA-256, `%PDF-`) and scanned like photos. A version is created at completion and served once its scan is clean. Downloads are attachments valid 10 minutes. `DOCUMENT_ADDED` and `DOCUMENT_VIEWED` never carry a title.
- **Summary:** `POST …/consultations/{id}/summary` renders the summary PDF in the api with PDFKit 0.20.2 (MIT; its dependencies fontkit, linebreak, png-js, fflate and @noble are MIT), embedding Inter Regular and SemiBold (OFL, bundled with the licence and copied into `dist/fonts`). It is allowed in `READY_FOR_REVIEW`, or after an addendum to a completed consultation, and adds a version to the consultation's one summary document. It contains final notes with their addenda, no drafts and no images.
- **Timeline:** `GET /patients/{id}/timeline` merges items from the domain tables with an exact cursor and a domain filter. A caller sees only the domains it can read.
- **Worker:** scan results apply to document versions. A failed scan of a document is logged as a security event with identifiers only.
- **Storage:** the `DOCUMENT/` prefix joins the presigning role and the GuardDuty scan prefixes in Terraform, and the local scanner's notifications.
- **CI (F-70):** the main-thread sampler runs `sample` as root, and prints why when no sample was taken; run 101 hung on the iPad again and took none.
- **Tests:** `documents.test.ts` (8), `consultation-summary.test.ts` (3) and `timeline.test.ts` (3). The generated authorization and cross-tenant tests cover the seven new operations. The api suite runs 586 tests.

## 2026-10-04: Purpose-specific exports (M3.7 backend; ADR-0027)

- **API:** `POST …/photos/{photoId}/exports` (optionally with one annotation layer) and `POST …/before-after/{setId}/exports` (`202`); `GET /patients/{patientId}/exports/{exportId}` (pending, ready, failed or revoked); `POST …/exports/{exportId}/access-urls` (10 minutes). All four need `photo.export`, `photo.view` and step-up. The request checks the current grant on every photo shown (`403 MEDIA_PERMISSION_NOT_GRANTED`), then in one transaction registers the output object, creates the derivative and its release pinning every permission version relied on, queues the render and writes `PHOTO_EXPORTED` per photo. Downloads re-check the grants and write `PHOTO_VIEWED`. 30 requests per user in 10 minutes.
- **Authorization (F-71):** the registry gains `alsoRequires`. The Layer 2 release routes now also require `photo.view`, so MARKETING, which holds `photo.export` for released assets only, can no longer create or revoke a release.
- **Revocation:** a permission change also revokes releases whose subject is a derivative, checking every photo it shows (both photos of a composite).
- **Worker:** `image.export.requested` dispatches export jobs (`IMAGE_DERIVATIVE`, keyed `export:`): it re-checks the release, the photos and the annotation layer (`SOURCE_CHANGED` if the layer changed), resolves colours from the design tokens, and verifies the written output before making it available. Retries and the stuck-job sweep work as for derivatives. The derivative worker now handles only jobs keyed `derivatives:`. The api depends on `@aestara/design-tokens`.
- **image-processing:** `export.py` renders a single photo with its annotation layer, or a before/after pair side by side by its transform. Output is upright sRGB JPEG with no metadata, at most 4096 px, never enlarged. Labels are drawn in the bundled Inter (SIL OFL 1.1), with the package's own fontconfig file, and are never read as markup.
- **Routing:** `image.export.requested` in the outbox types, the local emulator's worker rule and Terraform's `worker_event_types`.
- **Tests:**
  - `exports.test.ts` (9), covering Bible §34.1 #18, #19 and #21 and §7.1/§7.3.
  - The real-service export test in `derivatives-e2e.test.ts`.
  - 33 pytest export tests, and an export with a label in the container test.
  - The generated authorization and cross-tenant tests cover the new operations. The api suite runs 548 tests.

## 2026-10-04: Photo annotations (M3.4 backend; ADR-0027)

- **Design tokens:** a fixed `annotation` palette of six colours, the same in both appearances (`DSAnnotationColor` on iOS, `--annotation-*` in CSS).
- **API:** list, create (with an optional client UUIDv7), update and delete annotation layers on accepted, unarchived photos; versioned JSON with normalized coordinates, a fixed palette, stroke widths and text sizes, at most 500 shapes and 256 KiB, no measurement tools; only the author changes or deletes a layer, and deleting keeps the row; `PHOTO_ANNOTATED` without text.
- **Tests:** `annotations.test.ts` (5) and the generated authorization and cross-tenant tests.

## 2026-10-04: Automatic before/after registration (M3.6 backend; ADR-0027)

- **API:** `POST …/before-after/{setId}/auto-registration` queues an `IMAGE_REGISTRATION` job (`202`); the flag `beforeAfter.autoRegistration` (on by default) hides it per organization or practice.
- **Worker:** dispatches registration jobs over the two display previews and applies a result only if the set has not changed since the request; retries and the stuck-job sweep as for derivatives.
- **image-processing:** OpenCV 4.14 (`opencv-python-headless`, Apache-2.0) joins; `registration.py` fits a similarity transform with AKAZE features and RANSAC from libvips-decoded grey images, in the sandbox child. New failure code `NO_RELIABLE_ALIGNMENT`.
- **Routing:** `image.registration.requested` added to the outbox types, the local emulator's worker rule and Terraform's `worker_event_types`.
- **Tests:** 14 pytest tests (known transforms recovered, preview-size independence, featureless, unrelated and over-turned pairs refused, the contract, the consumer end to end); the container test now also runs a registration job; 5 api tests with the worker; and a real-service end-to-end test that uploads two photos, renders their previews and aligns them.

## 2026-10-04: Before/after sets (M3.5 backend; ADR-0027)

- **API:** list, create, read and update before/after sets: two accepted, unarchived photos of the patient with the same view key and pose target, the before one earlier (`422 INCOMPATIBLE_VIEWS`, `422 BEFORE_AFTER_ORDER`); one indistinguishable `404` for unknown, other-patient and other-tenant photos; manual alignment and reset with `photo.annotate` and `If-Match`; `BEFORE_AFTER_CREATED`.
- **Tests:** `before-after.test.ts` (8), covering Bible §34.1 #12–14, #17 (manual half) and #20. The api suite runs 493 tests.

## 2026-10-04: Concerns, medical history and notes (M3.3 backend; ADR-0027)

- **API:** 12 operations: the patient's concerns and medical history (list, create, correct with `If-Match`), a consultation's concern set (`PUT …/concerns`), and notes (list, draft with an optional client UUIDv7, edit and discard one's own draft, finalize, addenda). `CONSULTATION_NOTE_FINALIZED` is written on finalization; `PATIENT_UPDATED` for concerns and history, without their text.
- **Schema:** `PatientConcern` gains `version` (every `PATCH` carries `If-Match`).
- **Tests:** `consultation-notes.test.ts` (12); the generated authorization and cross-tenant tests cover the new operations. The api suite runs 471 tests.

## 2026-10-04: Consultation lifecycle (M3.1; ADR-0027)

- **Database:** the Layer 3 migrations (tables, the constraints fragment verbatim, forced RLS and grants); 45 tables; the database suite runs 157 checks with no drift.
- **API:** 12 consultation operations under `/patients/{patientId}/consultations` (list, create, read, update, and the eight transitions of spec §5.4.1), with practice scope, `If-Match`, the completion preconditions (`422 COMPLETION_PRECONDITIONS_NOT_MET`) and the audit events `CONSULTATION_CREATED`, `CONSULTATION_STATUS_CHANGED` and `CONSULTATION_COMPLETED`. Three new error codes in the catalog.
- **Tests:** `consultations.test.ts` (19), and the generated authorization and cross-tenant tests now cover the new operations.

## 2026-10-04: Layer 3 kickoff confirmed (ADR-0026)

- The owner confirmed every recommendation in `LAYER_3_KICKOFF.md` (K3-01 to K3-24), choosing for F-68 that CI records missing snapshot references into its job log and Claude reviews and commits them. Recorded as **ADR-0026**.
- **Spec corrected under change control** (Bible §0): §2.1 (Node.js re-evaluated at the Layer 4 kickoff; OpenCV's role), §5.2, §5.4.1 (confirmed transitions and preconditions, what each state allows, cancellation), §5.5, §6.1.9, §6.2 (`COMPLETION_PRECONDITIONS_NOT_MET`, `INCOMPATIBLE_VIEWS`, `BEFORE_AFTER_ORDER`), §6.3 (note discard, export status and download, `photo.annotate` for automatic registration, document limits), §6.7, §7.3, §8, §10.2.
- **Schema:** the consultation's release decision, note addenda (`correctsNoteId`), and the audit actions `CONSULTATION_NOTE_FINALIZED` and `DOCUMENT_ADDED`. **`constraints.sql`:** the consultation machine and frozen states, the note and addendum rules, frozen concern links and the before/after order rule; the behaviour suite grows to 145 checks.
- **Findings:** F-35 (compatible view), F-37, F-55 (cancellation), F-64 resolved; F-68 decided; F-70 stays open until its fix.

## 2026-10-03: Layer 2 accepted; Layer 3 kickoff proposed

- The owner accepted the Layer 2 acceptance review (`ACCEPTANCE_CRITERIA.md` §7). F-68 (snapshot references), F-69 (the device camera check before first clinical use) and F-70 (the iPad main-thread hang during an audit) stay open.
- `LAYER_3_KICKOFF.md` proposes K3-01 to K3-24: one recommendation for each Layer 3 decision (UD-15, UD-28, UD-33), each finding carried to Layer 3 (F-35's compatible-view rule, F-37, F-55's cancellation policy, F-64, F-68, F-70), the Layer 3 open items in the documentation pack, and the Node.js re-evaluation scheduled by ADR-0023 K2-22.

## 2026-10-02: Layer 2 acceptance review (M2.11)

- **Review:** [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) §7, on CI run 92 (`750394a`), green in all nine jobs. The standard photo session works end to end on iPhone and iPad against the real api, worker, image-processing and AWS emulator. Sign-off moves to §8. The api's photo test now checks job messages for the fixture patient's exact values; a bare "1988" also matched random identifiers. Awaiting the owner's sign-off; F-68 and F-69 stay open for the owner, and F-70 is open: on iPad the app's main thread sometimes stays busy during an accessibility audit.

## 2026-10-01: Layer 2 provider app: capture, gallery, permissions, offline (ADR-0025)

- **ADR-0025** records the implementation decisions of the provider app's Layer 2 work. Like ADR-0024, it was written while the work was in progress, not ahead of it.
- **Guided capture** (M2.5): the camera behind a frame source (AVFoundation, Vision and Core Motion on a device; a Debug-only synthetic source in the simulator and the UI tests), the framing oval, one instruction at a time from the 13 Bible codes, the ghost overlay with adjustable opacity and a choice of reference, the position-match score with its fixed label, a shutter that never moves, and the review with every check in words. No check blocks acceptance.
- **Sessions:** start from the active protocols (offline too), the required views left in words, completion with the acknowledgement when required views are missing, and the photos of the session still on the device.
- **Gallery and photo** (M2.7): thumbnails in one request, states in words for photos being checked or rejected, archived photos behind a toggle, the display preview, tags and archiving.
- **Media permissions and releases** (M2.8): per category, patient-wide and per photo, with only the spec §5.4.5 transitions offered and grants recorded as staff attestation; the full history; releases for the outward purposes confirmed on their own sheet, and revocation with a reason.
- **Offline** (M2.9): the encrypted store per user and organization, the upload queue, the derivative cache, the patient-summary cache, and offline view records that replay first. Sign-out asks before deleting photos that have not uploaded.
- **Shell:** the Photos tab of the patient profile, sync after sign-in, on returning to the foreground and on reconnect, the offline copies of the recent patients and opened profiles, and the camera usage description.
- **Tests:** module tests for CoreSecurity, AuditSupport, Media, PatientDomain and Photography in CI. The UI test runs a standard Face session end to end with accessibility audits. The snapshot tests of K2-21 wait for reference images recorded on a Mac (Layer 2 acceptance review).
- **Accessibility audit, F-70:** the audit's issue handler no longer queries the app; issues are read after the audit returns. That was not the cause of the iPad audits that could not complete: the device log shows the app's main thread busy for minutes. CI now samples the app's stacks when that happens.
- **Accessibility audit:** a finding other than contrast fails when a second audit of the same, unchanged screen reports it again (ADR-0025); on the iPad simulator the audit's Dynamic Type and clipping predictions varied between identical screens and runs.
- **CI scripts:** every workflow script must parse as bash (`.github/scripts/check_workflow_scripts.py`, in the spec job). In run 83 a script that did not parse ended the UI test step green without running a test; that step now keeps its exit status and requires a passing result from both devices.
- **UI tests on iPad:** they run on the 13-inch iPad in portrait, named explicitly. On the iPad mini in landscape the simulator's screenshots of the app were cut off, which the audit then measured. An audit that cannot complete in time runs once more after a pause.
- **Encrypted store:** a store key is now made once per process under a lock and kept in memory until the store is destroyed. Two first uses at once could make two keys and lose the first one's records, and every read and write waited on the Keychain (ADR-0025).
- **Capture:** an unchanged camera frame no longer redraws the capture screen, and the Debug-only synthetic camera rests once its subject has settled, so the screen is still while the UI test audits it.
- **Patients on iPhone:** a newly created patient could stay on "Opening patient", because a pushed copy of the profile screen keeps the values it was pushed with. Each patient now has one profile model, shared by every copy of the screen and never replaced; each selection loads it again, so every opening is still loaded, and audited, by the server. A new patient opens only once the creation sheet has closed: a profile pushed during the sheet's closing animation stopped updating.
- **Admin portal:** the offline-policy "Saved." notice now survives the reload a save causes.
- **Screenshots:** the iOS UI test keeps a screenshot of each screen on iPhone and iPad, and CI publishes them as the `ios-ui-screenshots` artifact.
- **CI:** the iOS UI tests run in their own job (`ios-ui`) beside the module tests, so their result arrives in about half the time. Both devices run even when the first fails. Each accessibility-audit finding names its screen and element, and audit element screenshots no longer overwrite one another. The audit's findings are fixed: the profile tabs take the tap across their whole capsule, the capture guidance wraps instead of being cut at large text sizes, the gallery's two actions sit side by side only on a regular-width screen at the standard text size, and the patient search uses the system's short prompt, naming the search formats when nothing matches. The UI test job builds once and waits for both simulators to finish their first boot, data migration included, before the first test, and runs one simulator at a time. Contrast findings are confirmed on the element's own pixels (WCAG 2, AA). A completed session's Complete button stays disabled while its screen closes, and a reviewed photo's Accept waits while the photo is saved, so neither can be sent twice.
- **image-processing on macOS:** the render child's 3 GiB data limit now applies on Linux only. On macOS (local development and CI's UI tests) the allocator's start-up reservations exceed it and every render crashed (ADR-0024).

## 2026-10-01: Layer 2 backend and image-processing (ADR-0024)

- **ADR-0024** records the implementation decisions of the Layer 2 backend: the worker and protocol-seed database roles, either-permission endpoints, photo sub-resource visibility, storage object states, the flag `PUT`, offline view replay, the relay and WORM copy, derivative jobs, malware scan results, and the image-processing service. It was written while the work was in progress, not ahead of it as change control asks.
- **Database** (M2.1–M2.4, M2.8, M2.10):
  - the Layer 2 tables and `AIJob`, with constraints, triggers, Row-Level Security and the two new roles;
  - the standard protocols seeded in every organization;
  - 36 tables in all.
- **api:** protocols, photo sessions, uploads with verification, photos, tags, archive and signed viewing (including the batch endpoint), media permissions and releases, feature flags, practice settings, the offline cache policy, retention policies and offline view replay. There are 33 new operations in `openapi.json`, and both clients are regenerated.
- **Worker** (`services/api/src/worker`, a separate process):
  - the outbox relay to EventBridge;
  - the audit WORM copy in an Object Lock bucket, with a daily reconciliation;
  - malware scan results, with an EICAR-only local scanner;
  - derivative jobs with retries and a stuck-job sweep;
  - hourly permission expiry.
- **image-processing** (M2.6): Python 3.13, pyvips and uv.
  - It renders the thumbnail and display preview as JPEG in sRGB, with the orientation applied and every metadata block removed.
  - Rendering runs in a disposable child process, with only the JPEG and PNG loaders, under the 100-megapixel and 60-second limits.
  - Outputs are written through write-once presigned URLs.
  - It has no database access and logs no URLs.
  - It ships as a non-root container that runs with a read-only root filesystem.
- **Spec corrected (ADR-0024):**
  - §3.4 flow A: the storage object is `QUARANTINED` at verification and becomes `AVAILABLE` on a clean scan.
  - §6.3: a flag `PUT` is a replace; practice settings keep `If-Match`.
- **Infrastructure (not applied, ADR-0014):** `modules/storage` gains the K2-09 controls (overwrite denial, endpoint-only object access, the presigning role, unreadable infected objects), the Object Lock `audit-archive` bucket and the GuardDuty Malware Protection plan. The new `modules/messaging` adds the event bus, the work queues with dead-letter queues, the routing rules, alarms and an alerts topic. `modules/kms` adds a messaging key.
- **Local and CI:**
  - moto joins `docker-compose.yml`.
  - `local-stack.ts` provisions its own emulator resources and starts the worker and image-processing, for `pnpm dev:stack`, the admin portal end-to-end tests and the iOS UI tests (moto from pip on the macOS runner).
  - A new CI job runs image-processing's ruff, strict mypy, pytest, a container test and a Trivy image scan. This is the first container scan.
  - OSV-Scanner now covers `uv.lock`.
  - The api job runs derivatives through the real service.
- **Fixed on the way:**
  - The audit archive `PUT` lacked the checksum-algorithm header that Object Lock requires.
  - A batch whose audit rows could not all be read could have been counted as archived.

## 2026-10-01: Layer 2 kickoff confirmed (ADR-0023)

- The owner confirmed every recommendation in `LAYER_2_KICKOFF.md` (K2-01 to K2-22), choosing explicitly that every standard view is required, every upload is scanned and `CLINICAL_USE` does not gate staff capture or viewing. Recorded as ADR-0023; ADR-0010 amended (moto replaces LocalStack).
- **Spec corrected before any Layer 2 code:**
  - §2: image-processing on pyvips, malware scanning, the CryptoKit offline store, moto
  - §5.2, §5.8: `AIJob` moves to Layer 2 for image derivatives
  - §5.4.10: the photo machine gains the scan step for every source; a protocol machine
  - §5.5: photo transition, protocol freeze and audit-feed rules
  - §6.1.9: JPEG and PNG only, 50 MiB and 100 megapixels, conditional writes, URL renewal, checksum verification
  - §6.2: `REQUIRED_VIEWS_MISSING`
  - §6.3: batch thumbnail URLs, session completion, `PHOTO_ARCHIVED` and `PHOTO_REJECTED`, flag precedence, retention rule
  - §6.6.2, §6.7: JPEG in the upload example; image jobs carry presigned URLs
  - §7.1, §7.3, §7.4, §8, §10.2: storage controls, the WORM copy, offline rules, confirmed baselines
- **Schema:** `AuditAction` gains `PHOTO_REJECTED` and `PHOTO_ARCHIVED`; `AIJobType` gains `IMAGE_DERIVATIVE`. **`constraints.sql` Layer 2:** the photo transition table, the protocol freeze and the audit-to-outbox feed, with behaviour checks C11–C14 and G5.
- **Documentation pack:** PHOTO_ARCHITECTURE, PHOTO_PROTOCOLS, SECURITY_REQUIREMENTS, THREAT_MODEL (open items 3, 6, 7 and 19 closed or narrowed), AUTHENTICATION_ARCHITECTURE §9, IOS_ARCHITECTURE, TESTING_STRATEGY (open items 1 and 2 closed), SYSTEM_ARCHITECTURE, INFRASTRUCTURE, DATABASE_SCHEMA, DEPLOYMENT, WORKFLOWS, PRODUCT_REQUIREMENTS and the findings register (F-34, F-35, F-36, F-63, F-66 and F-67 resolved; F-61 scheduled in M2.1).

## 2026-10-01: Layer 1 accepted; Layer 2 kickoff proposed

- The owner accepted the Layer 1 acceptance review (`ACCEPTANCE_CRITERIA.md` §6) and authorized Layer 2.
- `LAYER_2_KICKOFF.md` proposes K2-01 to K2-22: one recommendation for each Layer 2 decision (UD-06, UD-21, UD-22, UD-24, UD-25), each carried finding (F-34, F-35, F-36, F-61, F-63, F-66, F-67) and each Layer 2 open item in the documentation pack. Nothing is adopted until the owner confirms it; no Layer 2 code exists yet.
- Found while preparing it: LocalStack no longer starts without an account token, so K2-08 proposes moto for the local AWS emulators (amending ADR-0010).

## 2026-10-01: Layer 1 clients (ADR-0022)

- **iOS provider app** (M1.9–M1.10):
  - generated API client in `CoreNetworking` (swift-openapi-generator build plugin), with correlation, token refresh and error-envelope middleware
  - sign-in with password and TOTP, authenticator enrollment, organization choice, Face ID unlock of the saved sign-in, relock after 5 minutes in the background, privacy cover
  - adaptive shell (iPad sidebar, iPhone tabs), patient list and search, create with the duplicate check, profile with all twelve tabs, settings
  - server address per build; Release has none until F-32 and UD-34 are decided
  - CI builds both apps and runs the DesignSystem, CoreNetworking, CoreSecurity and PatientDomain tests on a simulator
- **Admin web portal** (M1.11): sign-in (TOTP or passkey), invitation acceptance, password reset, users and roles, audit viewer, account (devices, password, passkeys), on TanStack Router and Query as spec §2.2 fixes; the cache is cleared whenever the session or organization changes.
- **Admin portal Content Security Policy** decided and enforced (closes SECURITY_REQUIREMENTS.md open item 9); the end-to-end suite fails on any violation.
- **App-switcher privacy and jailbreak signals** decided (THREAT_MODEL.md open items 4 and 5); the snapshot tool and accessibility audit move to Layer 2.
- **End-to-end tests:** Playwright against the real api; iOS UI tests on iPhone and iPad against the real api on the macOS runner; CoreSecurity's Keychain tests run hosted in the app.
- **Acceptance evidence:** the database tests now check the development seed (Bible §32 #3); a new api test asserts every Layer 1 audit event and that patient events carry no demographics (#10).
- **Local development:** `pnpm dev:stack` and `pnpm dev:admin` run Layer 1 locally; Mailpit joins `docker-compose.yml` (ADR-0018 K-14).
- `packages/security` stays a placeholder until a second service shares its code (ADR-0022).
- **Sign-in under load:** the password check (Argon2id) no longer runs inside a database transaction, and a saturated database answers 503 with Retry-After instead of 500; every operation in `openapi.json` documents 503. Found by the iOS UI tests on a loaded CI runner.
- **Patient search rate limit:** a sliding 60-second window replaces the per-calendar-minute counter, which reset at each minute boundary and allowed a burst of up to 120 searches across it.
- **Layer 1 acceptance review (M1.12):** all fifteen Bible §32 criteria pass (`ACCEPTANCE_CRITERIA.md` §6), with CI run 41 on `c2cd6ec` green in every job. Layer 1 awaits the owner's sign-off; Layer 2 has not started.
- **RLS gate:** 3,000 alternating rounds (login 600) instead of 1,000 (200), so that write-path tail noise cannot decide the p95 (ADR-0021).

## 2026-10-01: Layer 1 API implementation decisions (ADR-0021)

- The owner asked for Layer 1 (M1.2 to M1.12) to be completed before Layer 2. ADR-0021 records the decisions the documentation leaves to those micro-prompts:
  - token formats and keys
  - TOTP and passkeys, factor confirmation, step-up
  - lockout, reset, change and invitation rules
  - tenant transactions, the permission guard, `ACCESS_DENIED` collapsing, cursors and idempotency
  - the organization settings registered in code
- **Spec additions:**
  - error code `SEPARATION_OF_DUTIES`
  - `POST /auth/mfa/enrollments/{id}/confirm`
  - the JWKS path
  - `UserCredential.confirmedAt`
- **Defence in depth:** the api adds an explicit tenant filter to every tenant query, on top of Row-Level Security.
- **RLS gate, end to end:** measured through the api, as ADR-0020 decided. Locally on PostgreSQL 16, with 1,500 rounds, patient open adds 0.1 to 0.7 ms p95 (0.8% to 5.8%); login and patient search add nothing measurable. CI runs the gate on PostgreSQL 18 and publishes the table.
- **Layer 1 contracts:** `packages/api-contracts` now defines every Layer 1 request and response, and an endpoint registry that generates the 62 OpenAPI operations. ADR-0021 records the contract rules: platform reach, If-Match coverage, account edits, shorter-only session policies, probable-duplicate matching, name search and profile tabs.

## 2026-10-01: Patient search under RLS decided (ADR-0020)

- The owner's decision on UD-35. No patient query bypasses Row-Level Security.
- **Search keys:** `Patient` gains five keys maintained by a database trigger. Search matches name prefixes and exact date of birth, MRN, email and phone through leakproof operators, so its indexes work under the tenant policy.
- **Indexes and extensions:** the trigram indexes, `pg_trgm` and `btree_gin` are removed; `unaccent` is added.
- **Gate:** the RLS gate for fixed per-statement cost is judged end to end at M1.8.
  - Measured on the database work: patient search now adds about 0.4 ms p95 (it was 3.5 to 3.7 ms), and the cost no longer grows with organization size.
  - Every request is under the 5 ms limit, and CI now fails on that limit.
  - RLS check S21 proves the search index is used under the tenant policy.
- **Database checks:** 101 on the full design (`K1`–`K2` added); 61 against the Layer 1 migrations.
- **Dependencies:** pnpm overrides patch two of Prisma's transitive dependencies flagged by OSV-Scanner: `deepmerge-ts` 8.0.2 (GHSA-ggr8-5vv4-36mx) and `mysql2` 3.24.5 (GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3).

## 2026-09-29: Layer 1 database foundation (M1.1)

- **`packages/database`** (ADR-0019):
  - the 21 Layer 1 tables, with `prisma/schema.prisma` generated from the design schema
  - four migrations: tables, the Layer 1 `constraints.sql` fragment, security (roles, forced RLS, sign-in lookup, platform grant guard, grants) and the permission catalog (53 permissions, 10 system roles, 139 default grants)
  - table ownership classification (K-08)
  - Prisma client
  - local synthetic seed
- **Checks:**
  - 45 unit tests, including the catalog proven equal to spec §4.4–§4.5
  - `schema:check` drift gate
  - `db:test`: migrations as a non-superuser, no Prisma drift, `check-rls.ts`, and 57 database checks (the Layer 1 fragment plus the new RLS suite)
- **Behaviour suite split per layer** (K-19): `docs/technical-spec/verification/behavior/`. It holds 99 checks over the full design, 9 of them new: one-time tokens, the MFA sign-in step, archived patients.
- **`packages/shared-types`:** enum values generated from the Prisma schema.
- **CI:** a new `database` job on PostgreSQL 18; schema and enum drift checks in `workspace`.
- **RLS performance (ADR-0004 gate), measured on the database work of each request:**
  - login: passes
  - patient open: +0.5 to 0.7 ms p95
  - patient search as specified: fails (+3.5 to 3.7 ms), because its predicates are not leakproof
  - Recorded as UD-35 (spec §10.2) for the owner.
- **Spec count corrections:** 281 foreign keys; 18 supporting tables; §10.2 confirmation note; §10.4 SHA pinning and production-access timing; §11.2 results.
- **Documentation pack aligned with ADR-0018** across 15 documents.

## 2026-09-29: Layer 1 kickoff confirmed

- The owner adopted every Layer 1 kickoff recommendation (K-01 to K-24) and included the admin web shell (M1.11). Recorded as ADR-0018; `LAYER_1_KICKOFF.md` is marked confirmed.
- **Spec corrections under change control** (ADR-0018):
  - §3.5: Row-Level Security design
  - §4.2: client token handling without PKCE, Keychain settings without a passcode fallback, the MFA rule, passwords and recovery, scoped revocation, login audit
  - §4.5 and §4.6: separation-of-duties rules 2 and 3, platform reach, `ACCESS_DENIED` collapsing
  - §5.4.10: patient status rule
  - §6.1.8: patient creation is online-only
  - §6.1.10: no secrets in URLs
  - §6.3 to §6.5: four new Layer 1 endpoints (password change, staff invitation acceptance, admin MFA reset, organization admin bootstrap); the patient invitation token moves into the body
  - §7.3: `SECURITY_CREDENTIAL_CHANGED` and `ORGANIZATION_SWITCHED`, and the Layer 1 audit tamper-resistance
- **Schema:**
  - new supporting table `UserToken`, with its constraints (88 tables)
  - `LoginEventType.MFA_CHALLENGE_ISSUED` replaces `LoginFailureReason.MFA_REQUIRED`
  - two `AuditAction` values
- **Findings:** F-13 to F-33 and F-59 are resolved, scheduled or deferred in `ACCEPTANCE_CRITERIA.md` §5.2. The roadmap marks Step 4 in progress.

## 2026-09-28: Layer 0 accepted

- The owner accepted the Layer 0 acceptance review (`ACCEPTANCE_CRITERIA.md` §4) and read the findings register (§5). Layer 1 waits for the owner's go-ahead (Bible Appendix B #38).

## 2026-09-28: Layer 0 architecture foundation

- **Documentation pack** (Bible §31, §35): all 27 documents are present. The spec stays normative and the pack explains and links it (ADR-0012). `SOFTWARE_PRODUCTION_BIBLE.md` is a verbatim export generated from the PDF. `check_docs.py` checks completeness, references, links and placeholders in CI.
- **`packages/api-contracts`**: Zod 4 → OpenAPI 3.1 with the shared primitives. The committed document is drift-checked and an oasdiff breaking-change gate runs in CI (ADR-0013).
- **`infrastructure/terraform`**: bootstrap, dev/staging/production roots, and modules for KMS, account baseline (CloudTrail delivered to an Object Lock bucket), network, storage, database and compute. validate, tflint and checkov are clean. Nothing is applied yet (ADR-0014).
- **iOS**: Tuist projects for both apps and 20 module packages with a checked tier graph. DesignSystem ships the generated tokens and 4 tests. CI builds and tests on macOS 26 with Xcode 26.6 (ADR-0015).
- **CI**: new `terraform`, `security` (OSV-Scanner) and `ios` jobs; OpenAPI and iOS-architecture gates; Dependabot (ADR-0016).
- **Errata to the locked spec and schema**: `SimulationParameter.unit` removed; §1.5, §2.1, §6.1.1, §7.5, §10.4, §11 corrected; UD-34 added. The V7 `MATCH SIMPLE` audit is now automated (90 database checks, 58 traceability checks) (ADR-0017).
- **Findings register**: 67 Layer 0 findings are recorded in `ACCEPTANCE_CRITERIA.md` §5; 14 are fixed and the rest are carried to the kickoff of the layer that needs them. Two independent accuracy reviews of the pack corrected the documents against the Bible, spec, schema and repository.

## 2026-09-25: Roadmap, environment and design prototype

- `docs/DEVELOPMENT_ROADMAP.md`: steps 0–15, with micro-prompt breakdowns for Layers 1–10.
- Repository initialized:
  - monorepo skeleton (Bible §35) with placeholders naming their layer
  - pnpm/Turborepo/TypeScript/Biome/Vitest
  - PostgreSQL 18 via docker compose
  - Codespaces dev container
  - Claude Code on the web SessionStart hook
  - GitHub Actions CI
  - `CLAUDE.md` (ADR-0010)
- `packages/design-tokens`: shared tokens for iOS and web with a WCAG contrast gate (ADR-0011).
- `apps/design-prototype`: static design prototype of the core scenes (ADR-0009); `docs/DESIGN_SYSTEM.md`.

## 2026-09-25: Technical Specification v1.0 locked

- The owner decided D-01…D-07 (ADR-0001 … ADR-0007):
  - patient data shared within an organization, never across organizations
  - first-party identity
  - React admin SPA
  - RLS with a performance gate
  - iOS/iPadOS 26 with intuitive controls
  - US only
  - default DB naming
- The remaining proposals were adopted by delegation (ADR-0008).
- The spec version moved from 0.1 (draft) to 1.0 (locked).

## 2026-09-25: Independent review resolved

- 30 review findings resolved across the spec, `schema.prisma` and `constraints.sql`. See spec §11.3.
- Verification: 57/57 traceability checks, 89/89 database behaviour tests.

## 2026-09-25: Technical Specification v0.1

- Initial pre-Layer-0 specification derived from the Software Production Bible v1.0: tech stack, draft schema (87 tables), database constraints, API contracts, verification suite.
