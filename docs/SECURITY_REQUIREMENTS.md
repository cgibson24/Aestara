# Security requirements

| | |
|---|---|
| Version | 1.0 |
| Status | Layer 0 baseline, 2026-09-28 |
| Authority | Production Bible §21 (authentication, security, privacy), §22 (audit, retention), §26 (observability), §28 (environments, CI/CD), §30 (constitution), §36 (production readiness). ADR-0001 (organization boundary), ADR-0002 (first-party identity), ADR-0004 (Row-Level Security), ADR-0006 (United States, HIPAA). |
| Normative sources | [`TECHNICAL_SPECIFICATION.md`](TECHNICAL_SPECIFICATION.md) §7 (security, privacy, audit), §3.5 (tenant isolation), §4.2 (authentication), §8 (offline contract); [`technical-spec/schema.prisma`](technical-spec/schema.prisma); [`technical-spec/constraints.sql`](technical-spec/constraints.sql) |

This is the register of numbered, testable security requirements for Aestara. Every requirement names its source, how it is verified and the layer that implements it, so each layer's acceptance review can cite the IDs it satisfies. The threats these requirements answer are in [`THREAT_MODEL.md`](THREAT_MODEL.md); how each one is tested is in [`TESTING_STRATEGY.md`](TESTING_STRATEGY.md).

---

## 1. Scope and precedence

- **Scope.** All Bible §2 surfaces: provider iOS/iPadOS app, patient iOS app, admin web SPA, `api` and `worker`, `image-processing`, `ai-gateway` and private inference, `notifications`, `integration-service`, AWS infrastructure and the delivery pipeline. The static design prototype (`apps/design-prototype`, ADR-0009) holds no real data, has no backend and is never deployed as the product; SR-SCI-13 covers it.
- **Precedence.** Bible §0 and §30 rank this document below the ADRs, the database schema and the API contracts. In this repository the locked specification holds the schema and contract position (`CLAUDE.md`). If a requirement here disagrees with the Bible, an ADR or the spec, the higher source wins and the conflict is raised; it is never resolved silently in code.
- **No duplicated catalogs.** This register links to the normative catalogs instead of copying them: permissions spec §4.4, role matrix spec §4.5, error codes spec §6.2, endpoints spec §6.3 and §6.5, audit events spec §7.3, state machines spec §5.4, offline contract spec §8.
- **Compliance posture.** The software provides HIPAA-ready controls. Legal compliance also depends on the customer's role, BAAs, policies, training, incident response and retention configuration; code alone does not make an organization compliant [B §21.3]. Deployments are United States only, in AWS us-east-1, multi-AZ (ADR-0006).

## 2. How to read the register

**ID format:** `SR-<AREA>-nn`. IDs are permanent. A withdrawn requirement keeps its ID and is marked "withdrawn" with the ADR that removed it.

**Verification methods:**

| Code | Method |
|---|---|
| AT | Automated test: unit, integration against real PostgreSQL (Testcontainers), API contract, end-to-end (Playwright) or iOS (Swift Testing, XCUITest) |
| DB | Database behaviour suite (`technical-spec/verification/schema_behavior_tests.sql`); check IDs such as `C1` refer to its labels |
| CI | CI gate: a static check or scan that blocks the merge or the deployment |
| RV | Review: design, code, configuration or document review, recorded in the layer acceptance review |
| PT | External penetration test before production (ADR-0002) |
| EX | Exercise: restore drill, disaster-recovery exercise or alert-fire test |

**Layer values:** `L0`–`L10` are the Bible §29 build layers. `Infra` means the Terraform configuration for the first environment that holds PHI (timing in [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md) and [`DEPLOYMENT.md`](DEPLOYMENT.md)). `Pre-prod` means the production-readiness step (roadmap Step 14, Bible §36). `Every` means each layer that adds the relevant tables or endpoints.

**Areas:**

| Code | Area | Main sources |
|---|---|---|
| TEN | Tenancy | B §3.1, §21.2; ADR-0001, ADR-0004; spec §3.5 |
| IDN | Identity and sessions | B §21.1; ADR-0002; spec §4.2 |
| AUZ | Authorization | B §3.3, §13.2, §17.2; spec §4.4–§4.7 |
| DPR | Data protection in transit and at rest (KMS) | B §21.2; spec §7.1 |
| MED | Media | B §6.6, §7, §8.3, §14.4; spec §6.1.9, §7.4 |
| INT | Consent and record integrity | B §5.2, §12, §20.3, §23.3; spec §5.4, §6.1.7, §6.1.8 |
| PHI | PHI handling | B §14.3, §21.2, §26, §28.1; spec §7.2 |
| AUD | Audit | B §21.2, §22; spec §7.3 |
| MON | Logging, monitoring and alerting | B §21.2, §26; spec §7.6 |
| SEC | Secrets and keys | B §21.1, §21.2; spec §7.1 |
| DEV | Device and offline | B §23, §24.5; spec §8 |
| AI | AI | B §7.3, §9, §21.4, §34.2; spec §7.7 |
| SCI | Supply chain and CI/CD | B §21.2, §28; spec §2.3, §6.8 |
| BCR | Backups and recovery | B §22.3, §25.4, §27.1, §36; spec §7.6 |
| VEN | Vendors and BAAs | B §21.3, §25.3, §36; ADR-0006; spec §10.4 |

The INT area is added to the areas the pack names because Bible §36 has a "Consents" row that needs its own requirements.

---

## 3. Tenancy (SR-TEN)

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-TEN-01 | Every tenant-owned record carries `organizationId`. Platform-level tables are only those listed in spec §4.1. | B §3.1, §19.1; spec §4.1, §5.1 | RV | Every |
| SR-TEN-02 | Tenant context comes only from the verified session and access token. An organization ID in a header, body or path is never proof of entitlement; there is no `X-Organization-Id` header. | B §3.1; spec §3.3, §6.1.3 | AT (contract) | L1 |
| SR-TEN-03 | Each request requires an `ACTIVE` membership in the token's organization, and permissions are evaluated for that organization only. | spec §3.5, §4.6 | AT | L1 |
| SR-TEN-04 | The data layer requires a tenant context and injects `organizationId` into every query on a tenant-owned model. Unscoped access exists only through the explicitly named platform repository used by SUPER_ADMIN tooling and migrations. | spec §3.5 | AT, RV | L1 |
| SR-TEN-05 | Every parent/child link uses a composite foreign key `(organizationId, …)`, and CHECKs close every `MATCH SIMPLE` gap on nullable composite keys. | spec §3.5, §5.1, §5.5 | DB (A1–A5, C5, D9, E6, F7, R1–R2, R18, and the automated V7 `MATCH SIMPLE` audit, spec §11.2) | Every |
| SR-TEN-06 | Row-Level Security is enabled on every tenant-owned table, keyed on `SET LOCAL app.organization_id` inside the per-request transaction. The application database role has no `BYPASSRLS`; migrations run as a separate owner role. | ADR-0004; spec §3.5 | AT, DB, RV | L1, Every |
| SR-TEN-07 | RLS meets the performance gate on login, patient search and patient open: at most 10% added p95 latency and at most 5 ms absolute. A miss means the policy design is revised before Layer 1 ships; RLS is never silently dropped. | ADR-0004 | AT (benchmark) | L1 |
| SR-TEN-08 | A resource that does not exist, belongs to another tenant or is outside the caller's scope returns the same `404 <RESOURCE>_NOT_FOUND` body. `403 PERMISSION_DENIED` is returned only when the caller can already see the resource. | B §20.3, §20.4; spec §3.3, §6.1.10 | AT | L1 |
| SR-TEN-09 | A cross-tenant suite generated from the route table runs in CI against real PostgreSQL for every tenant-scoped route: tenant B's credentials against tenant A's IDs return 404 with a body identical to a random-UUID request (apart from its per-request `requestId`, spec §7.5), and no timing difference. | B §21.2, §27.1, §36; spec §3.5, §7.5 | AT, CI | L1, Every |
| SR-TEN-10 | Patient records are readable across all practices of the owning organization by staff holding the read permission. Practice/location role scope limits who may create or change practice-owned records. Nothing is readable across organizations. | ADR-0001; spec §4.6 | AT | L1, Every |
| SR-TEN-11 | Switching organization re-checks membership and issues new tokens bound to the new organization. | spec §4.2 | AT | L1 |
| SR-TEN-12 | The application-enforced links (`ConsentSignature.signerUserId`, `ThreadParticipant.userId`, `IntegrationMapping.localId`) are covered by the authorization and cross-tenant suites, because the database cannot enforce them. | spec §5.1 | AT | L4, L5, L10 |
| SR-TEN-13 | The similar-case library is organization-wide and never crosses organizations; a cross-organization dataset needs a separately approved governance model. | B §10; ADR-0001; spec §5.2 | AT | L9 |

## 4. Identity and sessions (SR-IDN)

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-IDN-01 | Identity is first-party in the API with OIDC/OAuth-compatible token semantics; native apps use PKCE-style proof at the token endpoint. | B §21.1; ADR-0002; spec §4.2 | RV, PT | L1 |
| SR-IDN-02 | Passwords are stored as Argon2id hashes. Only the vetted libraries named in ADR-0002 are used, and there is no custom cryptography. | ADR-0002; spec §2.1 | AT, RV | L1 |
| SR-IDN-03 | TOTP and passkeys (WebAuthn) are the second factors. MFA is required for the admin web and every admin role. | B §21.1; ADR-0002; spec §4.2 | AT | L1 |
| SR-IDN-04 | Access tokens are ES256 JWTs signed with a KMS-held key, valid 10 minutes, bound to the session and the active organization (`sub`, `sid`, `org`, `app`, `amr`). Permissions are not embedded in the token. | ADR-0002; spec §4.2 | AT | L1 |
| SR-IDN-05 | Every authenticated request verifies signature, expiry and audience and loads the `Session`; a revoked, expired or idle session returns 401. | B §21.1; spec §3.3 | AT | L1 |
| SR-IDN-06 | Refresh tokens are opaque, stored only as a hash and rotated on every use. Presenting an older generation revokes the whole session with reason `REFRESH_TOKEN_REUSE` and writes `SECURITY_SESSION_REVOKED`. | ADR-0002; spec §4.2, §6.3 | AT | L1 |
| SR-IDN-07 | Session idle and absolute lifetimes follow the spec §4.2 defaults per client and are configurable per organization. | spec §4.2; UD-18 | AT | L1 |
| SR-IDN-08 | Revocation is server-side: logout, own-session revoke, admin revoke, device revoke (cascades to its sessions), and user or membership disable (revokes all sessions). Each writes `SECURITY_SESSION_REVOKED`. | B §21.1, §22.1; spec §4.2 | AT | L1 |
| SR-IDN-09 | A revoked session's access and refresh tokens are both rejected on the next request, not at token expiry. | spec §7.5 | AT | L1 |
| SR-IDN-10 | Every login attempt writes a `LoginEvent` and an `AuditEvent` (`LOGIN_SUCCESS`, `LOGIN_FAILURE`, `LOGOUT`); a failure carries a failure reason. | B §22.1, §32; spec §4.2 | AT, DB (B7–B8) | L1 |
| SR-IDN-11 | Unknown account and wrong password produce identical client responses; password reset responds identically for unknown accounts. | B §20.3; spec §4.2, §6.3 | AT | L1 |
| SR-IDN-12 | Repeated login failures trigger progressive lockout (from `LoginEvent`), and WAF per-IP rate rules protect public and auth endpoints. | B §20.3, §21.2; spec §6.1.10; UD-27 | AT, CI (Terraform) | L1, Infra |
| SR-IDN-13 | The provider app keeps the refresh token in the Keychain with `.biometryCurrentSet` access control and passcode fallback; LocalAuthentication gates app unlock after 5 minutes in background and step-up actions (signing, export). | B §21.1; spec §4.2 | AT (iOS), RV | L1 |
| SR-IDN-14 | Designated sensitive actions require a recent `mfaVerifiedAt`; otherwise the API returns `403 REAUTHENTICATION_REQUIRED`. | spec §4.2, §6.2 | AT | L1, Every |
| SR-IDN-15 | The admin SPA holds its refresh token in memory plus a `SameSite=Strict` HttpOnly cookie; CORS allows only the admin web origin. | ADR-0003; spec §4.2, §6.1.10 | AT (Playwright), RV | L1 |
| SR-IDN-16 | Enrolling or removing an MFA factor requires authentication plus step-up and an `Idempotency-Key`. | spec §6.3 | AT | L1 |
| SR-IDN-17 | A patient has one identity with per-organization `PatientUserLink`s and no cross-organization view; proxy access is deferred. | spec §4.7; UD-08 | AT | L5 |
| SR-IDN-18 | The identity module is covered by the external penetration test before production. | ADR-0002; spec §10.4 | PT | Pre-prod |

## 5. Authorization (SR-AUZ)

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-AUZ-01 | Every route declares its required permission, and effective permissions are computed server-side on every request from scoped `UserRole` grants. UI hiding is convenience only. | B §3.3; spec §3.3, §4.6 | AT (contract) | L1, Every |
| SR-AUZ-02 | The permission catalog is seeded exactly as spec §4.4 lists it, plus only the proposed keys approved under UD-16. | B §3.3; spec §4.4 | AT, CI (traceability) | L1 |
| SR-AUZ-03 | Default roles follow the least-privilege matrix in spec §4.5 (UD-17). A role × endpoint suite generated from that matrix asserts allow or deny for every cell. | B §3.2; spec §4.5, §7.5 | AT, CI | L1, Every |
| SR-AUZ-04 | Separation of duties: nobody assigns a role to themselves or creates their own membership; platform-scope grants only bootstrap an organization's first ORGANIZATION_ADMIN and never carry clinical permissions; a PRACTICE_ADMIN grants only within its own scope. | B §17.2; spec §4.5 | AT, DB (R4) | L1 |
| SR-AUZ-05 | Platform operators hold no `patient.*` permission and cannot browse patient records. Support access to a tenant is not built until it is specified as a time-bound, audited grant. | B §17.1, §17.2; spec §4.5 | AT, RV | L1 |
| SR-AUZ-06 | `patient.read` unlocks demographics and profile only; clinical content needs the clinical keys mapped in spec §4.4, and the timeline filters each item by the caller's permission for its domain. | B §3.2; spec §4.4, §6.3 | AT | L1, L3 |
| SR-AUZ-07 | Access to the ORIGINAL photo variant requires `photo.export` (a permission, never a role check) and is always audited. | B §3.3; spec §6.3 | AT | L2 |
| SR-AUZ-08 | Every grant and revocation is audited (`ROLE_ASSIGNED`, `ROLE_REVOKED`) and appears in a periodic access-review export. | spec §4.5 | AT | L1 |
| SR-AUZ-09 | Authorization failures on sensitive endpoints write `ACCESS_DENIED` (subject to UD-19 approval). | B §26; spec §4.6, §7.3 | AT | L1 |
| SR-AUZ-10 | Patient-app access requires an `ACTIVE` `PatientUserLink` for the token's organization. `patientId` comes from the token and link, never the path, and every portal query applies the spec §4.7 release predicate. Entities without an approved rule are not visible. | B §13.2; spec §4.7, §6.5 | AT (portal visibility suite) | L5, L8 |
| SR-AUZ-11 | Portal handlers use a separate controller namespace, separate DTOs and release-filtered repositories only; a staff DTO cannot be serialized to a patient. | spec §6.5 | AT, RV | L5 |
| SR-AUZ-12 | Message threads require participation plus `message.send` (staff) or an active link plus participation (patient), including attachment download. | B §14.1; spec §6.3, §6.5 | AT | L5 |
| SR-AUZ-13 | Deep links and push-notification routes re-run authorization and never trust cached UI state. | B §24.5; spec §8; schema `Notification.deepLink` | AT (iOS UI) | L1, Every |
| SR-AUZ-14 | Feature flags never bypass authorization. | B §26; spec §5.2 | AT, RV | L2 |
| SR-AUZ-15 | Rate limits apply per user on sensitive endpoints (exports, AI generation, search) with `429 RATE_LIMITED` and `Retry-After`. | B §20.3, §21.2; spec §6.1.10 | AT | L1, L4, L8 |

## 6. Data protection in transit and at rest (SR-DPR)

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-DPR-01 | TLS 1.2 or later (1.3 preferred) terminates at the ALB and CloudFront, and the API sends HSTS. | B §21.2; spec §6.1.10, §7.1 | CI (checkov), AT, PT | Infra, L1 |
| SR-DPR-02 | Database connections require TLS (`rds.force_ssl`). | spec §7.1 | CI (checkov) | L0 |
| SR-DPR-03 | Internal service traffic stays inside the VPC over TLS; service-to-service calls authenticate with IAM-signed requests or mTLS, and queues are guarded by per-producer/consumer IAM policies. | B §21.2; spec §6.7, §7.1 | RV, AT | L2, L7 |
| SR-DPR-04 | RDS storage and snapshots are encrypted with a KMS customer-managed key. | B §21.2; spec §7.1 | CI (checkov) | L0 |
| SR-DPR-05 | S3 buckets use SSE-KMS with bucket keys, versioning and account-level Block Public Access. | B §21.2; spec §2.1, §7.1 | CI (checkov) | L0 |
| SR-DPR-06 | Each environment has its own customer-managed KMS keys; TOTP seeds and integration payloads are envelope-encrypted. | B §21.2; spec §2.3, §7.1 | RV, AT | L0, L1, L10 |
| SR-DPR-07 | Bucket policies deny non-TLS access and, for services, access that does not come through the VPC endpoint. | spec §7.1 | CI (checkov), RV | L0 (non-TLS deny); L2 (VPC-endpoint condition, with the first service that reads media) |
| SR-DPR-08 | On iOS, cached sensitive data uses Data Protection class *Complete*, a SQLCipher database and CryptoKit AES-GCM for cached media, with keys in the Keychain. | B §21.2, §23.3; spec §2.2, §7.1 | AT (iOS), RV | L2 |
| SR-DPR-09 | PHI responses carry `Cache-Control: no-store`, and the API sends `X-Content-Type-Options: nosniff`. | spec §3.3, §6.1.10 | AT (contract) | L1 |
| SR-DPR-10 | Error responses never contain stack traces, SQL, storage keys or cross-tenant existence hints. | B §20.4; spec §6.1.5 | AT | L1 |
| SR-DPR-11 | Per-tenant encryption keys are evaluated at the ~1,000-practice tier. | B §25.4; spec §7.1 | RV | Scale tier |

## 7. Media (SR-MED)

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-MED-01 | Original clinical photos are never destructively edited: the storage object is write-once after verification, the photo's original reference is immutable, and derivatives are separate immutable rows that reference their source. | B §6.6, §30; spec §1.4, §5.5 | DB (C1–C4, C8–C10), AT | L2 |
| SR-MED-02 | Each environment has one private bucket for clinical media and separate buckets for exports and integration payloads. | spec §7.4 | CI (checkov), RV | L0, L2 |
| SR-MED-03 | Object keys are `{objectClass}/{random UUIDv7}` with no tenant, patient or PHI; keys are never overwritten; non-admin roles are denied `s3:DeleteObject` and `s3:PutObject` on existing keys. | spec §7.4 | AT, CI, RV | L2 |
| SR-MED-04 | Storage keys are never returned as data or in errors; they appear only inside short-lived signed URLs. | B §20.4; spec §6.1.9 | AT (contract) | L2 |
| SR-MED-05 | Uploads use a presigned PUT valid 10 minutes with required `Content-Type` and `x-amz-checksum-sha256`; `complete-upload` verifies size and checksum before anything becomes visible. | B §6.3, §20.3; spec §3.4, §6.1.9 | AT | L2 |
| SR-MED-06 | Downloads use a presigned GET valid 120 seconds (exports 10 minutes) for one object and variant, with `Content-Disposition` and `Cache-Control: private, no-store`. Each issuance writes the view or download audit event. | B §14.4, §21.2; spec §6.1.9 | AT | L2 |
| SR-MED-07 | There are no public buckets, no permanent or public media URLs and no public CDN caching of patient media. | B §21.2, §25.3; spec §2.4 | CI (checkov), PT | L0, L2 |
| SR-MED-08 | Size and type allow-lists are enforced at intent and again at completion: HEIC/JPEG/PNG for photos, PDF for documents, configured types for attachments. | B §14.4; spec §6.1.9 | AT | L2, L3, L5 |
| SR-MED-09 | Patient uploads land `QUARANTINED`, pass malware and file validation, then wait in `PENDING_REVIEW` for staff acceptance before entering the clinical record. | B §13.4; spec §3.4, §5.4.10; UD-22 | AT | L5 |
| SR-MED-10 | Message attachments are scanned before use, downloaded only through signed short-lived URLs, and every download writes `ATTACHMENT_DOWNLOADED`. | B §14.4; spec §6.3 | AT | L5 |
| SR-MED-11 | Media permissions are independent per category and stored as append-only versions; no category implies another, and clinical consent never implies marketing, research or AI training. | B §7.1, §7.2, §30; spec §1.4, §5.4.5 | DB (D1–D9), AT | L2 |
| SR-MED-12 | Export and release check the current grant at use time and pin every permission version relied on; a missing grant returns `403 MEDIA_PERMISSION_NOT_GRANTED`. | B §7.3, §8.3; spec §1.4, §6.2 | AT, DB (D10, R15–R17) | L2, L3 |
| SR-MED-13 | Revocation blocks future use for that purpose immediately and emits the downstream compliance event. | B §7.3; spec §5.4.5 | AT | L2 |
| SR-MED-14 | A before/after set is exactly two different photos of the same patient; other-tenant or other-patient IDs are rejected without revealing existence. | B §8.1, §34.1; spec §5.5 | DB (C5–C7), AT | L3 |
| SR-MED-15 | Imaging and AI services reach objects only through signed per-object URLs and write derivatives as new objects. | spec §3.1, §3.4 | AT, RV | L2, L7 |
| SR-MED-16 | Purging media deletes the S3 object and marks the ledger row `PURGED`; the row, checksums and audit trail remain. | spec §5.7 | DB (C10), AT | L2 |

## 8. Consent and record integrity (SR-INT)

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-INT-01 | Publishing a consent template creates a frozen, hashed version; only one draft per template exists; published versions never change. | B §12.2; spec §1.4 | DB (F1–F6) | L4 |
| SR-INT-02 | Executed consents are frozen and can never be reopened; `VOIDED` and `SUPERSEDED` are terminal. | B §12.2, §12.4; spec §1.4 | DB (F9–F12, R5–R6) | L4 |
| SR-INT-03 | `COMPLETE` requires the immutable signed snapshot and its SHA-256 hash. | B §12.3; spec §5.4.4 | DB (F8), AT | L4 |
| SR-INT-04 | Signatures are append-only, one per role, and require an `Idempotency-Key`, so a retry never duplicates a signature. | B §23.3; spec §5.2, §6.1.8 | AT | L4 |
| SR-INT-05 | Accepting a treatment plan is never recorded as medical authorization or consent; consent is always a separate assignment. | B §11.1; spec §5.4.3 | AT | L4 |
| SR-INT-06 | Every state machine runs through one server-side transition table per aggregate; an invalid transition returns `409 INVALID_STATE_TRANSITION`. | B §5.2, §19.1; spec §5.4 | AT | Every |
| SR-INT-07 | Database immutability triggers raise `AE001`, which the API maps to `409 IMMUTABLE_RECORD`. | spec §5.1, §6.2 | AT, DB | Every |
| SR-INT-08 | Concurrently editable records require `If-Match`; a stale version returns 412 and a missing header 428; the server never silently merges. | B §20.3; spec §6.1.7 | AT | L1 |
| SR-INT-09 | Idempotency keys are scoped per actor and retained 7 days; a reused key with a different body returns `409 IDEMPOTENCY_KEY_REUSED`. | B §20.3; spec §6.1.8 | AT | L1 |
| SR-INT-10 | Money totals are computed server-side; clients never submit totals. | spec §5.1 | AT | L4 |

## 9. PHI handling (SR-PHI)

Spec §7.2 is the normative list; each rule below carries its number there.

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-PHI-01 | Logs use an allow-list serializer: only IDs, codes, durations and counts; request and response bodies are never logged. (spec §7.2 rule 1) | B §21.2, §26; spec §2.1, §7.2 | AT, CI | L1 |
| SR-PHI-02 | A CI test injects canary PHI strings through every layer's endpoints and asserts they never appear in captured log output. (spec §7.2 rule 1) | spec §7.2, §7.5 | CI | L1, Every |
| SR-PHI-03 | No PHI in URL paths or query strings; search terms, names, DOB, email and phone travel in request bodies. (spec §7.2 rule 2) | B §21.2; spec §6.1.10, §7.2 | AT (contract) | L1 |
| SR-PHI-04 | Push, email and SMS carry fixed template text only, and deep links carry opaque IDs only; the notification record has no content field. (spec §7.2 rule 3) | B §14.3, §25.2; spec §6.7, §7.2 | AT, RV | L5 |
| SR-PHI-05 | No analytics in the apps can capture PHI; any product analytics are server-side aggregates without identifiers. (spec §7.2 rule 4) | B §21.2; spec §2.4, §7.2 | RV | L1, L5 |
| SR-PHI-06 | Crash diagnostics use MetricKit; any third-party crash or session tool needs a BAA, demonstrated scrubbing and approval. (spec §7.2 rule 5) | B §21.2; spec §2.4, §7.2 | RV | L1 |
| SR-PHI-07 | Imaging and AI services receive object references and job parameters only: no name, DOB, MRN, contact details or free text, and no database access. (spec §7.2 rule 6) | spec §3.1, §6.7, §7.2 | AT (contract), RV | L2, L7 |
| SR-PHI-08 | Audit metadata holds identifiers and codes only, never clinical content. (spec §7.2 rule 7) | B §22.2; spec §7.2 | AT | L1 |
| SR-PHI-09 | Lower environments never contain production data without an approved de-identification process; seeds and fixtures are synthetic. (spec §7.2 rule 8) | B §28.1; spec §7.2 | RV | L0, Every |
| SR-PHI-10 | Distributed tracing uses safe identifiers only; the client-supplied `X-Client-Request-Id` is logged but never trusted. | B §26; spec §2.1, §6.1.4 | AT, RV | L1 |
| SR-PHI-11 | Outbox and queue payloads carry identifiers only. | spec §5.2, §6.7 | AT | L2 |
| SR-PHI-12 | Idempotency records store an outcome reference, never a request body. | spec §6.1.8 | AT | L1 |
| SR-PHI-13 | Health endpoints are unauthenticated and return no data and no dependency details; synthetic checks run against a synthetic tenant. | B §26; spec §6.1.10, §7.6 | AT, RV | L1, Pre-prod |

## 10. Audit (SR-AUD)

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-AUD-01 | Every Bible minimum audit event is emitted by the layer that owns its action (catalog: spec §7.3). | B §22.1; spec §7.3 | AT, CI (traceability) | Every |
| SR-AUD-02 | Proposed additional events are emitted once approved under UD-19. | spec §7.3 | AT | L1, Every |
| SR-AUD-03 | Each event records actor type and identity, organization, resource type and ID, action, outcome, timestamp, request ID, session and device, IP and user agent, and `patientId` as an identifier. | B §22.2; spec §7.3 | AT | L1 |
| SR-AUD-04 | The state change, its audit row and any outbox rows commit in one transaction or not at all. | spec §3.3 | AT | L1 |
| SR-AUD-05 | Every state-machine transition writes an audit event; system transitions use actor type `SERVICE`. | B §5.1, §34.2; spec §5.4 | AT | Every |
| SR-AUD-06 | Audit and login ledgers are append-only: triggers reject UPDATE, DELETE and TRUNCATE. | B §21.2; spec §5.5, §7.3 | DB (G1–G3, B8) | L1 |
| SR-AUD-07 | The application database role holds only `INSERT` and `SELECT` on audit tables. | spec §7.3 | AT, RV | L1 |
| SR-AUD-08 | Audit rows stream to an S3 bucket with Object Lock in compliance mode, and a daily job reconciles database and WORM counts and alerts on divergence. | B §21.2; spec §7.3 | AT, EX | L2 (see open item 3) |
| SR-AUD-09 | Opening a patient writes `PATIENT_VIEWED`; every signed-URL issuance writes its view or download event. | B §4.3, §14.4, §22.4; spec §6.3 | AT | L1, L2, L3, L5, L8 |
| SR-AUD-10 | Views made offline are recorded locally and replayed through `POST /audit/offline-events` with original timestamps; replay accepts only the caller's own actions on resources it may read. | B §4.3, §22.1; spec §6.3, §8 | AT | L2 |
| SR-AUD-11 | Audit is queryable in the tenant by actor, patient, action, resource and time, including a per-patient access report. | B §36; spec §6.3 | AT | L1 |
| SR-AUD-12 | SUPER_ADMIN reads platform-level audit only. | B §17.2; spec §4.5 | AT | L1 |
| SR-AUD-13 | AWS CloudTrail covers all regions with log-file validation and delivers to an Object Lock bucket in a separate security account. | B §25.3; spec §7.1 | CI (checkov), RV | L0 (multi-region trail, log-file validation); Infra (Object Lock, security account; open item 12) |
| SR-AUD-14 | Audit retention detaches and archives whole partitions to WORM storage; rows are never deleted individually. | B §22.3; spec §5.6 | RV | ~100-practice tier |

## 11. Logging, monitoring and alerting (SR-MON)

Spec §7.6 assigns the security-alert commitment to this document.

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-MON-01 | Every request gets a server-generated UUIDv7 `X-Request-Id` that appears in logs, traces, audit rows and the error envelope. | B §20.3; spec §3.3, §6.1.4 | AT | L1 |
| SR-MON-02 | Metrics cover API latency and error rate per route, queue depth and age, upload success, AI job duration and failure, integration health, outbox lag and audit-to-WORM lag. | B §26; spec §7.6 | RV | L1, Every |
| SR-MON-03 | Security alerts fire on `ACCESS_DENIED` bursts, login-failure spikes, refresh-token reuse, audit/WORM divergence, WAF blocks and IAM anomalies (CloudTrail). Each alert has an owner and a runbook link. | B §26; spec §7.1, §7.6 | EX (alert-fire test), RV | L1, L2, Pre-prod |
| SR-MON-04 | Each environment has its own operational dashboard with the SR-MON-02 metrics and SLO burn. | B §26; spec §7.6 | RV | Pre-prod |
| SR-MON-05 | AWS WAF managed rules and rate rules protect the ALB and CloudFront. | B §21.2; spec §2.3, §7.1 | CI (checkov), PT | Infra |
| SR-MON-06 | The six Bible §26 runbooks exist, including suspected data exposure, which also covers unsent offline audit records of a revoked device. | B §26; spec §7.6, §8 | RV | Pre-prod |

## 12. Secrets and keys (SR-SEC)

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-SEC-01 | Backend secrets live in AWS Secrets Manager (database credentials through RDS-managed rotation, APNs keys, vendor keys); none are in environment files, images or the repository. | B §21.2; spec §2.3, §7.1 | RV, CI (see SR-SCI-10) | L1 |
| SR-SEC-02 | The token-signing key is held in KMS. | spec §4.2 | RV | L1 |
| SR-SEC-03 | Integration records store a Secrets Manager reference, never secret material. | spec §5.2 | AT, RV | L10 |
| SR-SEC-04 | On iOS, tokens and keys are stored in the Keychain. | B §21.1; spec §2.2 | AT (iOS), RV | L1 |
| SR-SEC-05 | Refresh tokens and device installation identifiers are stored only as hashes. | spec §4.2; schema `Session`, `Device` | AT | L1 |
| SR-SEC-06 | IAM is least privilege: one role per service, S3 access scoped per object class, queue policies per producer and consumer. | B §21.2; spec §7.1 | CI (checkov), RV | L1 (first service role), L2 (object classes, queues) |

## 13. Device and offline (SR-DEV)

The offline contract is spec §8; these requirements cite its rules.

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-DEV-01 | Only the Bible §23.1 operations work offline; AI generation, EMR sync, release, export, sign-off, permission changes and consent completion need a connection. | B §23.1, §23.2; spec §8 | AT (iOS) | L2, Every |
| SR-DEV-02 | Each queued operation carries a UUIDv7 `operationId` sent as `Idempotency-Key` and a client-generated ID for creates, so retries never duplicate records, signatures or AI jobs. | B §23.3; spec §6.1.8, §8 | AT | L2 |
| SR-DEV-03 | A version conflict is shown to the user with both versions; clinical and consent data are never resolved by newest timestamp. | B §23.3; spec §8 | AT | L2, L3 |
| SR-DEV-04 | On reconnect the app re-validates its session before replaying any queued operation. | B §24.5; spec §8 | AT | L2 |
| SR-DEV-05 | Offline originals are stored encrypted with their SHA-256 and purged after the server confirms the checksum. | B §23.3; spec §8 | AT | L2 |
| SR-DEV-06 | The cache policy (maximum patients and age, purge on sign-out or device revocation) is a practice setting; the baseline is UD-25. | B §23.1; spec §8; UD-25 | AT | L2 |
| SR-DEV-07 | Offline views produce encrypted local audit records that replay first on reconnect. | B §4.3; spec §8 | AT | L2 |
| SR-DEV-08 | Staff-assisted consent signing opens a consent-scoped hand-off session; the patient cannot navigate elsewhere, and leaving it requires staff re-authentication. | spec §6.3; UD-31; DESIGN_SYSTEM.md §2 (C13) | AT (iOS UI) | L4 |

## 14. AI (SR-AI)

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-AI-01 | AI services sit behind authenticated internal APIs (`/internal/v1`) that are never internet-routable. | B §31; spec §6.1.1, §6.7 | AT, RV | L7 |
| SR-AI-02 | Inference runs in a private environment with no public egress; patient images go to no third-party AI API without a separately approved, BAA-covered decision. | B §2.1; spec §2.1, §2.4; UD-04 | CI (Terraform), RV | L7 |
| SR-AI-03 | Model identity and version content are immutable; activation happens only through an audited rollout; one version is active per scope; rollback inserts a new rollout row. | B §9.7, §28.3; spec §1.4 | DB (E1–E5, R10–R13), AT | L7 |
| SR-AI-04 | Each model version carries a parameter allow-list with no dosage, product, drug, unit, depth or technique fields, and the API rejects unknown parameters. | B §1.2, §9.6, §21.4, §34.2; spec §1.4, §6.6.3 | AT | L7, L8 |
| SR-AI-05 | Every generation records the Bible §9.4 provenance, including source assets and model version, and the provenance is immutable. | B §9.4, §34.2; spec §5.5 | DB (E6–E10, R14), AT | L8 |
| SR-AI-06 | The validation pipeline runs outside-region identity similarity and artifact detection; outputs crossing thresholds are rejected or flagged before provider review. | B §9.5, §34.2 | AT (Layer 7 harness) | L7, L8 |
| SR-AI-07 | Unsupported or poor-quality inputs fail with a safe, actionable status. | B §34.2; spec §6.2 | AT | L7, L8 |
| SR-AI-08 | Only authorized users create or generate, and only an authorized provider of the same organization approves or rejects. | B §34.2; spec §4.5 | AT, DB (R18) | L8 |
| SR-AI-09 | Release to the patient is a separate explicit action after approval and records the version, time and actor. | B §9.2, §34.2; spec §5.4.2 | AT, DB (E12–E13) | L8 |
| SR-AI-10 | Patients never see `READY_FOR_PROVIDER_REVIEW`, `REJECTED` or `FAILED` output, or any provider draft. | B §13.2, §30, §34.2; spec §4.7 | AT (portal visibility suite) | L8 |
| SR-AI-11 | The patient simulation DTO requires the Bible §9.1 disclaimer verbatim, so it cannot be serialized without it. | B §9.1, §34.2; spec §6.6.4 | AT (schema) | L8 |
| SR-AI-12 | Product copy says simulation or visualization, never guaranteed or exact; similar cases are labelled "Similar Historical Cases". | B §9, §10, §30; DESIGN_SYSTEM.md §3 | AT (copy checks), RV | L8, L9 |
| SR-AI-13 | Training and evaluation datasets include only assets with an explicit `AI_TRAINING` or `INTERNAL_AI_EVALUATION` grant and a recorded governance approval; no permission is inferred from clinical consent, and no dataset export endpoint exists before Layer 7. | B §7.3, §30; spec §7.7 | AT, RV | L7 |
| SR-AI-14 | A simulation source photo must hold the current grant that simulation use requires (UD-32 baseline: `CLINICAL_USE`). | B §7.1; spec §3.4, §7.7 | AT | L8 |
| SR-AI-15 | Intended use stays clinician-controlled visualization; claims do not expand without regulatory review. | B §21.4; spec §7.7 | RV | L8, Pre-prod |

## 15. Supply chain and CI/CD (SR-SCI)

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-SCI-01 | No deployment happens when a required gate fails. The gates are those of Bible §28.2 (mapped to CI jobs in TESTING_STRATEGY.md §4). | B §28.2 | CI | L0 (merge), Infra (deploy) |
| SR-SCI-02 | Dependency scanning runs in CI: OSV-Scanner on `pnpm-lock.yaml` in the `security` job, plus weekly Dependabot update pull requests for npm, GitHub Actions and Terraform (`.github/dependabot.yml`). | B §21.2, §28.2; spec §2.3, §7.1; ADR-0016 | CI | L0 |
| SR-SCI-03 | Container images are scanned (Trivy); deployment is blocked on high or critical findings without an approved exception. | B §21.2, §28.2; spec §2.3, §7.1 | CI | L1 |
| SR-SCI-04 | Terraform is checked with `fmt`, `validate`, `tflint` and `checkov`. | B §28.2; spec §2.3 | CI | L0 |
| SR-SCI-05 | A Terraform plan is reviewed before every apply. | B §28.2 | RV | Infra |
| SR-SCI-06 | Installs are reproducible: frozen lockfile, pinned pnpm (`packageManager`) and pinned Node (`.nvmrc`). | ADR-0010 | CI | L0 |
| SR-SCI-07 | Workflows default to read-only repository permissions (`permissions: contents: read`, as in the current `ci.yml`); a job that needs more declares it. | B §21.2 (least privilege) | RV | L0 |
| SR-SCI-08 | The committed OpenAPI document is regenerated and diffed in CI, and breaking changes fail unless the path version is bumped (`oasdiff`). | spec §6.1.1, §6.8 | CI | L0, L1 |
| SR-SCI-09 | API clients (Swift and TypeScript) are generated from the contract, never hand-written. | spec §2.2, §6.8 | CI, RV | L1 |
| SR-SCI-10 | Secret scanning blocks committed credentials. | B §21.2, §28.2; ADR-0016 | CI | L0 (GitHub's native secret scanning, ADR-0016); dedicated scanner: open item 2 |
| SR-SCI-11 | Static application security testing runs in CI. | B §28.2 ("dependency/security scanning"); ADR-0016 | CI | See open item 2 |
| SR-SCI-12 | Work happens on a feature branch, CI must be green, and the owner approves every merge to `main`. | CLAUDE.md; DEVELOPMENT_ROADMAP.md §2 | RV | L0 |
| SR-SCI-13 | The design prototype is excluded from production builds and never receives real data. | ADR-0009 | RV | L0 |
| SR-SCI-14 | Deployments are versioned and repeatable; migrations follow expand, migrate, contract with a documented rollback; AI model deployments are independent and reversible. | B §28.3; spec §7.6 | RV, CI | L1, L7 |

## 16. Backups and recovery (SR-BCR)

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-BCR-01 | RDS automated backups with point-in-time recovery are enabled and encrypted. | B §21.2, §36; spec §7.6 | CI (checkov) | L0 |
| SR-BCR-02 | Snapshots are copied to a second region, and S3 has versioning plus replication. | spec §7.6 | CI (checkov), RV | Pre-prod (see open item 5) |
| SR-BCR-03 | A restore drill into an isolated account runs before production and then quarterly, verified by row counts and checksums. | B §27.1, §36; spec §7.6 | EX | Pre-prod |
| SR-BCR-04 | A disaster-recovery exercise runs before enterprise rollout. | B §25.4, §27.1; spec §7.6 | EX | Before enterprise rollout |
| SR-BCR-05 | Retention is policy-driven per organization and record category with no hard-coded period; without a policy nothing is deleted automatically; a DELETE action needs an explicit period. | B §22.3; spec §5.7; UD-24 | DB (H6), AT | L2 |
| SR-BCR-06 | Deletion workflows account for backup windows (RDS snapshots, S3 version expiry) and downstream integrations. | B §22.3; spec §5.7 | RV | L2, L10 |

## 17. Vendors and BAAs (SR-VEN)

| ID | Requirement | Source | Verify | Layer |
|---|---|---|---|---|
| SR-VEN-01 | Only HIPAA-eligible AWS services, configured appropriately and covered by the applicable BAA, handle PHI. | B §21.3, §25.3; ADR-0006; spec §2.3 | RV | Infra, Pre-prod |
| SR-VEN-02 | The telehealth vendor is BAA-capable (UD-05); calls are not recorded, and the schema has no recording field. Recording would need separate consent, retention, encryption and jurisdiction review. | B §16.2; spec §2.1, §5.2 | RV | L6 |
| SR-VEN-03 | Malware scanning is a managed service inside BAA scope or a self-hosted worker (UD-22). | spec §2.1; UD-22 | RV | L2 |
| SR-VEN-04 | Email (SES) and SMS (AWS End User Messaging) are HIPAA-eligible services and still receive generic template text only. | B §14.3; spec §2.1 | RV, AT | L5 |
| SR-VEN-05 | APNs payloads carry no PHI, only template text and opaque identifiers. Whether APNs needs any further agreement is part of the pre-production legal review. | B §14.3, §36 | AT, RV | L5, Pre-prod |
| SR-VEN-06 | EMR integrations run under the customer's agreements with each vendor; vendor-specific code stays inside adapters, and webhooks are signature-verified and replay-protected. | B §18.1; spec §6.7 | AT, RV | L10 |
| SR-VEN-07 | Every new vendor that could receive PHI (video, SMS, crash reporting, AI, scanning) is decided through a UD or ADR before integration. | spec §10.4 | RV | Every |
| SR-VEN-08 | BAAs, contracts, policies, retention and intended use are reviewed for the actual deployment before production. | B §21.3, §36 | RV | Pre-prod |

---

## 18. Bible §36 production readiness → requirements

Every row must be true before production [B §36]. The last column names the evidence the readiness review expects.

| §36 area | Must be true | Covered by | Evidence |
|---|---|---|---|
| Tenancy | Automated cross-tenant tests pass for every sensitive domain | SR-TEN-01 to SR-TEN-13 (SR-TEN-09 is the gate) | Cross-tenant suite green for every tenant-scoped route; RLS benchmark result |
| Authentication | Session expiration and revocation tested; secrets stored securely | SR-IDN-04 to SR-IDN-09, SR-IDN-13, SR-IDN-18, SR-SEC-01 to SR-SEC-06 | Session and revocation tests; penetration test report |
| Authorization | Server-side permission checks cover sensitive endpoints | SR-AUZ-01 to SR-AUZ-15 | Role × endpoint suite; contract test asserting a declared permission on every route |
| Photos | Originals immutable; permissions enforced; private storage only | SR-MED-01 to SR-MED-16, SR-DPR-05, SR-DPR-07 | DB checks C1–C10 and D1–D10; media permission tests; checkov |
| AI | Versioned provenance; provider review and release; regression validation | SR-AI-03 to SR-AI-11 | DB checks E1–E15 and R10–R14; Layer 7 harness results; Bible §34.2 acceptance |
| Consents | Versioned templates; immutable signed snapshot and hash; audit | SR-INT-01 to SR-INT-04, SR-AUD-01 | DB checks F1–F12 and R5–R6; consent audit tests |
| Messaging | No sensitive push payload; attachment controls enforced | SR-PHI-04, SR-MED-10, SR-AUZ-12, SR-VEN-04, SR-VEN-05 | Notification contract tests; attachment scan and signed-URL tests |
| Audit | Critical events captured and queryable | SR-AUD-01 to SR-AUD-13 | Audit assertions per event; WORM reconciliation run |
| Logging | PHI filtering verified | SR-PHI-01 to SR-PHI-03, SR-PHI-10 | PHI canary test in CI |
| Backups | Encrypted backup and tested restore | SR-BCR-01 to SR-BCR-03 | Restore drill record |
| CI/CD | Security and test gates mandatory | SR-SCI-01 to SR-SCI-14 | Branch protection settings; CI run showing every gate |
| Monitoring | Operational and security alerting configured | SR-MON-02 to SR-MON-06 | Alert-fire exercise record; dashboards per environment |
| Legal/compliance | BAAs, contracts, policies, retention and intended use reviewed for the actual deployment | SR-VEN-01 to SR-VEN-08, SR-AI-15, SR-BCR-05 | Signed legal review; retention policies configured per customer |

## 19. Open items

| # | Item | Why it is open | Confirmed at |
|---|---|---|---|
| 1 | Closed in Layer 0: dependency scanning (SR-SCI-02) runs in the `security` CI job (OSV-Scanner) with Dependabot updates (ADR-0016). Kept so the numbering stays stable. | Closed | Layer 0 (ADR-0016) |
| 2 | A dedicated secret scanner (SR-SCI-10) and SAST (SR-SCI-11): ADR-0016 relies on GitHub's native secret scanning for now and defers both tool choices. | Tool choice deferred by ADR-0016 | Layer 1 kickoff |
| 3 | Audit WORM streaming (SR-AUD-08) uses the outbox relay, whose table arrives in Layer 2 (spec §5.8). In Layer 1 audit is protected by triggers and grants only. | Layer 1 has no WORM copy | Layer 1 kickoff |
| 4 | MFA policy: ADR-0002 requires MFA for admin roles, while spec §4.2 says "per deployment policy" (`security.mfaPolicy`). Whether an organization can relax the admin requirement is not stated. SR-IDN-03 follows ADR-0002. | UD-18 | Layer 1 kickoff |
| 5 | The second region for snapshot copies (SR-BCR-02) is not named. ADR-0006 requires United States only. | Not specified | Production readiness (roadmap step 14; [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md) open items) |
| 6 | The actions that require a recent MFA (SR-IDN-14) are listed only as examples (signing, export). | Designated per layer | Each layer kickoff |
| 7 | Recovery point and recovery time objectives are not specified. | Not specified | Pre-prod |
| 8 | Time-bound, audited support access to a tenant (Bible §17.1) is not specified; nothing is built until it is. | B §17.1 | Separate specification |
| 9 | Content Security Policy for the admin SPA is not specified (spec §6.1.10 lists the other headers). | Not specified | Layer 1 kickoff (admin web shell) |
| 10 | Lifetime and single-use rules for password-reset and patient-invitation tokens are not specified, and the invitation token travels in the URL path (spec §6.5), which the no-secrets-in-URLs rationale of spec §6.1.10 argues against. | Not specified | Layer 1 kickoff (reset tokens; moving the invitation token into the request body, [`API_CONTRACTS.md`](API_CONTRACTS.md) open items); Layer 5 (invitation lifetime) |
| 11 | Password policy (length, breached-password checks) and Argon2id cost parameters for SR-IDN-02; account recovery for a lost second factor. Recorded here once decided ([`AUTHENTICATION_ARCHITECTURE.md`](AUTHENTICATION_ARCHITECTURE.md) §14). | Not specified | Layer 1 kickoff (M1.3) |
| 12 | The Layer 0 Terraform (`modules/account-baseline`) delivers CloudTrail to a bucket in the same account without Object Lock; spec §7.1 requires an Object Lock bucket in a separate security account (SR-AUD-13). | Depends on the AWS Organizations structure | Before the first `apply` (Layer 1, [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md) open items) |
