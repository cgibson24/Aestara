# Layer 2 kickoff

| | |
|---|---|
| Version | 1.0 |
| Status | **Confirmed by the owner, 2026-10-01.** Every recommendation adopted, with the owner choosing explicitly that every standard view is required (K2-11), every upload is scanned (K2-04) and `CLINICAL_USE` does not gate staff capture or viewing (K2-16). Recorded as ADR-0023. |
| Authority | Bible §6 (clinical photography), §7 (media permissions and releases), §22.3 (retention), §23 (offline), §29 (Layer 2), §30, §33; ADR-0001, ADR-0004, ADR-0008, ADR-0010, ADR-0018, ADR-0022 |
| Normative sources | spec §5.2 (Photography & media), §5.4.5, §5.4.10, §5.7, §5.8, §6.1.8, §6.1.9, §6.3 (Photography; administration rows marked L2), §6.7, §7.3, §7.4, §8; [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) Step 5; [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) §5.3 |

Before any Layer 2 code, the roadmap requires confirming the decisions listed for the layer (UD-06, UD-21, UD-22, UD-25, and UD-24 again). It also requires resolving the Layer 0 findings carried to Layer 2 (F-34, F-35, F-36, F-61, F-63, F-66, F-67) and the Layer 2 open items in the documentation pack. This document gives one recommendation for each. The owner confirmed them all, and they are recorded as ADR-0023. The spec text they change was corrected under change control before implementation (Bible §0).

## 1. Scope (Bible §29)

**Authorized:** protocols, photo sessions, camera, upload, immutable originals, derivatives, media permissions. The roadmap also places here the outbox relay, feature flags, practice settings and retention policies (spec §5.8 Layer 2 row).

**Exit condition:** a standard photo session works end to end [B §29].

**Not authorized:** annotations, before/after sets and purpose-specific exports (Layer 3); patient photo requests, patient uploads and anything a patient sees (Layer 5); AI of any kind (Layers 7–9).

Delivery follows micro-prompts M2.1–M2.11 in the roadmap. Each is written with the Bible §33 template and passes the Bible §27.2 definition of done.

## 2. Decisions

| ID | Topic | Recommendation | Source |
|---|---|---|---|
| K2-01 | image-processing service (UD-06; THREAT_MODEL open item 6) | See the list after this table. | spec §3.1, §6.7 |
| K2-02 | Photo formats and limits (F-35) | The provider app captures **JPEG** originals. In Layer 2 the upload allow-list is JPEG and PNG. HEIC is not accepted: decoding it needs an HEVC decoder, which carries patent licensing that has not been reviewed (the prebuilt libvips used in K2-01 leaves HEVC out for that reason). HEIC is re-decided with patient uploads in Layer 5. The upload limit is 50 MiB and 100 megapixels. At completion the file's first bytes must match the declared type. Spec §6.1.9 is corrected. | spec §6.1.9 |
| K2-03 | Upload details (F-35) | See the list after this table. | spec §6.1.8, §6.1.9; Bible §23.3 |
| K2-04 | Malware scanning (UD-22, F-34; THREAT_MODEL open item 19) | See the list after this table. | Bible §13.4, §14.4; spec §2.1 |
| K2-05 | Photo state machine (F-34) | Add a scan step for every source. `UPLOAD_PENDING → QUARANTINED` when the upload is verified; `QUARANTINED → ACCEPTED` for a staff capture whose scan is clean; `QUARANTINED → PENDING_REVIEW` for a patient upload whose scan is clean (Layer 5); `QUARANTINED → REJECTED` when the scan finds malware or cannot complete. The other edges stay as spec §5.4.10 has them. A database trigger enforces the transition table. `PHOTO_CAPTURED` is still written when the upload is verified. | spec §5.4.10 |
| K2-06 | Derivatives (F-35; THREAT_MODEL open item 7) | See the list after this table. | Bible §6.6; spec §6.7 |
| K2-07 | Outbox, events and the audit WORM copy (M2.2; ADR-0018 K-18) | See the list after this table. | spec §3.3, §7.3 |
| K2-08 | Local emulators (ADR-0010) | **LocalStack no longer starts without an account token** (checked 2026-10-01: version 2026.8.5 exits with "License activation failed"). Replace it with **moto** (Apache-2.0) for S3, SQS, EventBridge and KMS: a Docker image in `docker-compose.yml`, and a `pip` package on the macOS CI runner, which has no Docker. moto honours conditional writes but does not verify S3 checksums, which K2-03 covers. ADR-0010 is amended. | ADR-0010 |
| K2-09 | Storage layout and controls (F-35, F-61) | See the list after this table. | spec §7.1, §7.4 |
| K2-10 | Protocol lifecycle (F-63; F-34 freeze) | See the list after this table. | spec §5.2, §6.3 |
| K2-11 | Standard protocols (PHOTO_PROTOCOLS.md open items) | Seed the Bible §6.2 protocols as `ACTIVE`, organization-wide, in every organization: by migration for existing organizations, and in the organization bootstrap for new ones. View keys and pose targets are in the list after this table. **Every listed view is required**, because each standard protocol is the complete standard series; a practice that wants optional views authors a custom protocol [B §6.2]. Capture instructions are short positioning text with no clinical claims. | Bible §6.2 |
| K2-12 | Guided capture (M2.5; PHOTO_PROTOCOLS.md open items) | See the list after this table. | Bible §6.3–6.5 |
| K2-13 | Photo sessions | `POST …/photo-sessions/{sid}/complete` answers `422 REQUIRED_VIEWS_MISSING` with the missing view keys unless the request sets `acknowledgeMissingRequiredViews: true`. The session always reports its missing required views. Only `ACTIVE` protocols start sessions. A session names a practice (and may name a location) when the capturer's `photo.capture` grant is practice- or location-scoped, and that practice must be in scope. `ABANDONED` has no endpoint in the spec and is not used in Layer 2. | Bible §6.1–6.3 |
| K2-14 | Listing, archive, tags and viewing (F-66) | See the list after this table. | spec §6.3 |
| K2-15 | Media permissions (UD-21) and releases (F-36) | See the list after this table. | Bible §7; spec §5.4.5 |
| K2-16 | What `CLINICAL_USE` gates (PHOTO_ARCHITECTURE.md open item) | `CLINICAL_USE` does **not** gate capture or viewing by authorized staff: the photos are part of the medical record, and staff access is governed by role permissions and audit. It gates the uses the spec names (simulation sources, UD-32, Layer 8). | Bible §7.1; spec §7.7 |
| K2-17 | Offline (UD-25; AUTHENTICATION_ARCHITECTURE.md §9; THREAT_MODEL open item 3) | See the list after this table. | Bible §23; spec §8 |
| K2-18 | Feature flags and practice settings (F-67, M2.10) | Flag and setting keys are registered in code with their platform defaults, as organization settings are (ADR-0021). Organization rows need organization-scoped `configuration.manage`; practice rows need `configuration.manage` covering the practice. A practice row wins over an organization row, which wins over the code default. Platform-wide rows (`organizationId` NULL) are not written in Layer 2: changing a platform default is a reviewed code change. A flag only hides a feature and never grants access. Layer 2 registers the flags `photography.ghostOverlay` and `photography.liveGuidance` (both on by default) and the practice setting `offline.cachePolicy`. | DEPLOYMENT.md §9; spec §6.3 |
| K2-19 | Retention (UD-24, M2.10) | `GET/POST /retention-policies` records `ARCHIVE` and `REVIEW` policies (`CONFIGURATION_CHANGED`). A `DELETE` policy is refused until legal hold is modelled (UD-24 baseline). **No retention job runs in Layer 2**: nothing is archived or deleted automatically. The executor and legal hold are explicitly deferred to production readiness (roadmap Step 14). | Bible §22.3; spec §5.7 |
| K2-20 | Audit events | The spec's Layer 2 events: `PHOTO_CAPTURED`, `PHOTO_VIEWED` (also for `ORIGINAL`, and replayed offline views), `PHOTO_PERMISSION_CHANGED`, `MEDIA_RELEASED`, `MEDIA_RELEASE_REVOKED`, `CONFIGURATION_CHANGED` (protocols, flags, settings, retention) and `ACCESS_DENIED` on photo routes. Two additions: `PHOTO_REJECTED` (system actor, when a scan blocks a photo; a security event [B §26]) and `PHOTO_ARCHIVED` (spec §6.3 has no event for archiving a clinical photo, while patient archiving has one). | Bible §22.1; spec §7.3 |
| K2-21 | Test tooling (ADR-0022; TESTING_STRATEGY.md open items 1 and 2) | iOS: **swift-snapshot-testing** (Point-Free, MIT) for the Layer 2 screens in their view states, light and dark, iPad landscape and iPhone portrait, default and accessibility text sizes; XCUITest `performAccessibilityAudit()` on the capture, gallery and permission screens. Python: **pytest**, with ruff and mypy, managed by uv. | ADR-0022 |
| K2-22 | Node.js 26 (spec §2.1) | Stay on Node.js 24 LTS (supported to April 2028) through Layer 2. Node 26 is not yet Active LTS today; re-evaluate at the Layer 3 kickoff. | spec §2.1 |

**K2-01, image-processing service:**
- Python 3.13 with pyvips (libvips 8.18, the self-contained `pyvips-binary` wheel), managed with uv. OpenCV joins in Layer 3 for registration.
- A long-running SQS consumer with **no database access** and no PHI: a job carries opaque references, presigned per-object URLs issued by the api for that job (at most 10 minutes) and output parameters (spec §6.7, §7.2).
- Sandboxing: only the JPEG and PNG loaders are called, chosen from the file's first bytes; libvips' untrusted loaders are blocked; images over 100 megapixels are refused before decoding; each job has a 60-second limit. In AWS it runs as a non-root, read-only container whose only egress is the S3 and SQS endpoints.

**K2-03, upload details:**
- One presigned `PUT` per original, no multipart: originals are at most 50 MiB.
- **A fresh upload URL** comes from replaying the upload intent with the same `Idempotency-Key`: while the photo is `UPLOAD_PENDING`, its current representation includes a new 10-minute URL (spec §6.1.8).
- The `PUT` carries `If-None-Match: *`, so an object is never overwritten; the bucket policy requires it (K2-09).
- At completion the api takes the SHA-256 that S3 verified on upload. When the store reports none (the local emulator), the api computes it by reading the object. Size, type and first bytes are checked the same way.
- An intent that is never completed stays invisible. The app keeps its local original until the photo is accepted.

**K2-04, malware scanning:**
- **Every uploaded object is scanned, whatever its source.** One rule is simpler than source-dependent exceptions, and a stolen staff session could upload anything.
- In AWS: Amazon GuardDuty Malware Protection for S3 on the clinical-media bucket, provided it is confirmed in the BAA's scope before the first deployment; otherwise a ClamAV worker behind the same interface. Scan results arrive as EventBridge events; the worker records them in `StorageObject.scanStatus`.
- Locally and in CI: a scanner inside the worker that reports the standard EICAR test file as infected and everything else as clean. It refuses to start in staging or production.
- An infected or failed scan rejects the photo (K2-05): the object is never served, `PHOTO_REJECTED` is written and a security alert is raised. The photographer is told the photo could not be checked and can upload the kept local original again as a new photo, or retake it.
- Thumbnails and previews are requested only after a clean scan.

**K2-06, derivatives:**
- The generic job record `AIJob` moves from Layer 3 to Layer 2, with a new job type `IMAGE_DERIVATIVE` (no model). Spec §5.8 already describes `AIJob` as the generic job record for image processing.
- One job per photo produces a `THUMBNAIL` (long edge 400 px) and a `DISPLAY_PREVIEW` (long edge 2048 px): JPEG, sRGB, orientation applied, **all metadata stripped**.
- The api registers each output `StorageObject` before the job runs and hands image-processing a presigned `PUT` for it, so the ledger knows every object in advance and a duplicate run cannot overwrite anything.
- Transient failures are retried up to 3 attempts (after 1, 5 and 30 minutes) with fresh URLs. A file that cannot be decoded, or is over the pixel limit, fails at once. Every queue has a dead-letter queue and an alarm.
- The photo reports each derivative as pending, available or failed.

**K2-07, outbox, events and the audit WORM copy:**
- The worker is the api codebase in a separate process. Its relay claims committed `OutboxEvent` rows with `FOR UPDATE SKIP LOCKED`, publishes them to an EventBridge bus and stamps `publishedAt`; failures back off and record `attempts` and `lastErrorCode`.
- EventBridge rules route events to SQS queues, each with a dead-letter queue. Every message carries its outbox event ID, and consumers ignore an event they have already applied (by event ID or job state).
- **WORM audit copy:** a trigger on `AuditEvent` inserts an outbox row in the same transaction; the relay writes batches of audit rows to a new `audit-archive` bucket with S3 Object Lock (compliance mode for 6 years in staging and production, governance mode for 1 day in dev). A daily reconciliation compares the database with the archive per day and raises an alert on any difference (TESTING_STRATEGY.md §9 item 8).

**K2-09, storage layout and controls:**
- `clinical-media` holds every object class except `DATA_EXPORT` (the `exports` bucket) and `INTEGRATION_PAYLOAD` (`integration-payloads`). The new `audit-archive` bucket holds the WORM copy (K2-07).
- The bucket policy denies `s3:PutObject` without `If-None-Match: *` (overwrite denial, spec §7.4).
- Service roles reach the buckets only through the VPC endpoint (spec §7.1). Devices cannot, so presigned URLs are signed by a separate api presigning role that may only put and get clinical objects, with a signature at most 10 minutes old.
- The GuardDuty malware protection plan is added to `modules/storage` (K2-04).

**K2-10, protocol lifecycle:**
- Machine: `DRAFT → ACTIVE` (activate), `ACTIVE → RETIRED` (retire), `DRAFT → RETIRED` (discard a draft). No deletes; the trigger enforces forward-only status.
- Once a protocol leaves `DRAFT`, its fields and views are frozen by a database trigger, not only by the api.
- A change is a new `DRAFT` that supersedes an `ACTIVE` or `RETIRED` protocol. **Activating it retires its predecessor in the same transaction.** Sessions already started under the predecessor continue.
- A practice-scoped admin manages only protocols of a practice in its scope; organization-wide protocols need organization scope.

**K2-11, standard view keys and pose targets:**

| Protocol | Views and keys, in Bible order |
|---|---|
| Face (`FACE`) | Front `FRONT`; Left 45 `LEFT_45`; Right 45 `RIGHT_45`; Left profile `LEFT_PROFILE`; Right profile `RIGHT_PROFILE` |
| Breast (`BREAST`) | Front `FRONT`; Left oblique `LEFT_OBLIQUE`; Right oblique `RIGHT_OBLIQUE`; Left lateral `LEFT_LATERAL`; Right lateral `RIGHT_LATERAL` |
| Abdomen/body contour (`ABDOMEN_BODY`) | Front `FRONT`; Left 45 `LEFT_45`; Right 45 `RIGHT_45`; Left profile `LEFT_PROFILE`; Right profile `RIGHT_PROFILE`; Back `BACK` |

- `poseTarget` gives the subject (`FACE` or `TORSO`), the target yaw (0, ±45 and ±90 degrees; 180 for `BACK`), and tolerances for yaw, pitch, roll, frame fill and centring.
- Yaw is the subject's turn from facing the camera, positive when the subject's left side turns toward it. "Left 45" shows the patient's left side.
- Default tolerances: yaw ±8°, pitch ±8°, roll ±4°, centring ±8% of the frame; frame fill 45% ±8% for faces and 80% ±8% for torsos.

**K2-12, guided capture:**
- Faces use Vision's face pose (yaw, pitch, roll) and landmarks; torsos use Vision's body pose. Device tilt comes from Core Motion (`LEVEL_CAMERA`), lighting from frame brightness (`LIGHTING_TOO_DARK`), and motion blur from a sharpness measure after capture (`RETAKE_MOTION_BLUR`). Only the 13 Bible §6.4 codes exist.
- One instruction at a time, in a fixed priority order: level the camera, then distance, framing, pose and lighting.
- **No check blocks acceptance.** The photographer accepts or retakes [B §6.3], and every result is stored in `qualityChecks`.
- **Ghost overlay:** by default, the latest earlier accepted photo of the same patient and view key, as its display preview; the photographer may choose another earlier photo of that view. Offline, it is available only if cached; otherwise the app says "No reference photo available".
- The position-match score compares the live pose with the reference photo's recorded pose, with the fixed label "Photographic position match, not a medical measurement." [B §6.5].
- The simulator has no camera. Capture runs behind a frame-source interface; UI tests use a synthetic frame source compiled only into Debug builds.

**K2-14, listing, archive, tags and viewing:**
- Archived photos are hidden by default. A filter shows them with an "Archived" badge. They cannot be released or used in new work, and the original is kept. There is no unarchive, because the machine has none (spec §5.4.10).
- Quarantined and rejected photos are never served. In its session, a rejected photo shows the reason without an image.
- Tags are trimmed and lower-cased, at most 40 characters and 20 per photo, and never logged.
- New `POST /patients/{pid}/photos/access-urls` returns signed thumbnail or preview URLs for up to 60 photos at once, so a gallery is one request. It still writes one `PHOTO_VIEWED` per photo. `ORIGINAL` stays single-photo and needs `photo.export`.

**K2-15, media permissions and releases:**
- **Granularity (UD-21):** the UI offers patient-wide permissions plus per-photo exceptions; the API also accepts session scope.
- **Precedence:** the most specific current row wins (photo, then session, then patient-wide). No row means `NOT_REQUESTED`. `expiresAt` is honoured at read time.
- **Evidence in Layer 2:** `STAFF_ATTESTATION` only. `SIGNED_CONSENT` arrives in Layer 4, `PATIENT_APP_ACTION` in Layer 5 and `INTEGRATION_IMPORT` in Layer 10. So until Layer 4 a grant takes two steps (requested, then granted).
- **Revocation (F-36):** any change that leaves a release's effective grant other than `GRANTED` (revocation, expiry, or a more specific decline) also revokes the dependent active releases in the same transaction, with `MEDIA_RELEASE_REVOKED`. A later re-grant therefore never revives an old release. Every use still re-checks the grant at read time, and the outbox event `photo_permission.revoked` lists the affected releases for the downstream compliance workflow [B §7.3].
- **Expiry:** an hourly worker job moves `GRANTED` to `EXPIRED` at `expiresAt` (system actor, `PHOTO_PERMISSION_CHANGED`).
- **A release** needs an accepted, unarchived photo and a current effective grant for the purpose, and pins that permission version. `PATIENT_APP` releases are recorded in Layer 2, but nothing is visible to patients before Layer 5.

**K2-17, offline:**
- **Cache policy:** the practice setting `offline.cachePolicy`, by default 25 recent patients and 7 days. It holds patient summaries and the thumbnails and previews already viewed. It is purged on sign-out, on device revocation (at the next contact) and when the session's absolute lifetime ends.
- **Longest offline use:** until the session's absolute expiry (at most 7 days). After it, the cache cannot be unlocked until the user signs in again.
- **The queue belongs to one user in one organization.** It replays only after that same user signs in again to that organization, with re-validation first (spec §8 rule 5); anyone else signing in on the device cannot read it. Signing out with unsent photos asks for confirmation, because it deletes them.
- **Store:** CryptoKit AES-GCM-sealed records and media files with Data Protection *Complete* and a Keychain key (`WhenUnlockedThisDeviceOnly`), instead of GRDB with SQLCipher. The store is small, and this avoids a third-party cryptography dependency. Spec §7.1 and §8 rule 6 and IOS_ARCHITECTURE.md are corrected.
- **Devices:** a device passcode is already required, because the Keychain class needs one (ADR-0018 K-22). Device management and remote wipe belong to the customer's MDM. Server-side device revocation purges the cache at the next contact.
- Offline views replay first through `POST /audit/offline-events` (spec §8 rule 8).

## 3. Owner inputs that do not block Layer 2

Layer 2 is built and proven locally and in CI; nothing is deployed.

| Needed | Before | Item |
|---|---|---|
| Confirm Amazon GuardDuty Malware Protection for S3 is within the signed AWS BAA (else K2-04 uses ClamAV) | The first deployment | K2-04 |
| A licensed HEVC decoder, only if HEIC uploads are wanted | Layer 5 | K2-02 |
| The open items of [LAYER_1_KICKOFF.md](LAYER_1_KICKOFF.md) §3 (AWS accounts and BAA, Apple team, pilot metrics, repository visibility) | As listed there | F-32, F-33, F-56, F-59, UD-34 |

## 4. After confirmation (done 2026-10-01)

1. The confirmed decisions are recorded as ADR-0023, with the ADR-0010 amendment (K2-08).
2. The spec, schema, `constraints.sql` and the documentation pack are corrected under change control.
3. F-34, F-35, F-36, F-61, F-63, F-66 and F-67 are marked resolved or scheduled in [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) §5.3.
4. M2.1 starts.
