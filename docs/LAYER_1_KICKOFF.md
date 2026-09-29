# Layer 1 kickoff

| | |
|---|---|
| Version | 1.0 |
| Status | **Confirmed by the owner, 2026-09-29.** Every recommendation adopted; the admin web shell is included (K-23). Recorded as ADR-0018. |
| Authority | Bible §32 (Layer 1 prompt), §0 (change control), §3, §21, §22; ADR-0001, ADR-0002, ADR-0004, ADR-0008 |
| Normative sources | spec §4 (identity and authorization), §6.3 (Layer 1 endpoints), §7.3 (audit); [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) Step 4; [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) §5.2 |

Before any Layer 1 code, the roadmap requires confirming the decisions listed for the layer. It also requires resolving the Layer 0 findings carried to it (F-13 to F-33, F-59). This document gives one recommendation for each. The owner confirmed them all, and they are recorded as ADR-0018. The spec text they change was corrected under change control before implementation (Bible §0).

## 1. Scope (Bible §32)

**Authorized:**
- authentication and sessions
- organizations, practices, locations
- users, roles, permissions, user-role assignments
- tenant enforcement
- provider profiles
- patient create, read, update and archive; patient search; the patient profile shell
- the audit foundation
- the provider iOS shell, the Swift API client, the secure Keychain/session service, the error model and the navigation foundation
- automated tests

**Not authorized:**
- photography, consultation, AI, consent, messaging and telehealth workflows
- patient-app functionality

Delivery follows micro-prompts M1.1–M1.12 in the roadmap, and each passes the Bible §27.2 definition of done.

## 2. Decisions

| ID | Topic | Recommendation | Source |
|---|---|---|---|
| K-01 | Permission catalog and role matrix (UD-16, UD-17) | Seed the complete spec §4.4 catalog and §4.5 default matrix as data in M1.1, with the corrections in K-05 to K-07, so later layers never rewrite role data. Layer 1 endpoints enforce the 13 Bible §32 keys plus `organization.read`, `organization.manage`, `security.manage` and `configuration.manage` (spec §6.3 Layer 1 rows). | spec §4.4–§4.5, §6.3 |
| K-02 | Custom roles (UD-07, F-28) | System roles only in Layer 1. When custom roles are enabled later, `UserRole` gets a composite key so a role can never be assigned outside its organization. | spec §10.2 |
| K-03 | Session and MFA defaults (UD-18, F-13, F-22) | Session lifetimes and biometric re-authentication as in spec §4.2, configurable per organization. **MFA is always required for any admin role and for the admin web.** An organization may require it for more users, never fewer. At sign-in, before an organization is chosen, the strictest policy among the user's active memberships applies. | Bible §21.1; ADR-0002 |
| K-04 | Audit events (UD-19, F-27) | Spec §7.3 as written, plus two new actions. `SECURITY_CREDENTIAL_CHANGED` covers a password change or reset, and an MFA factor enrolled or removed; its details give the factor type and action, never a secret. `ORGANIZATION_SWITCHED` is the other. | Bible §22.1; spec §7.3 |
| K-05 | Separation-of-duties rule 2 (F-14) | The rule "a platform actor never grants a role with `consent.*` keys" applies to clinical consent actions (signing, voiding), not to `consent.template.manage`. An organization's first ORGANIZATION_ADMIN is created by an audited platform bootstrap action, allowed only while the organization has no admin. | spec §4.5 |
| K-06 | Platform (SUPER_ADMIN) reach (F-15) | Platform permissions read and manage organization-level metadata: organizations, practices, memberships and account status. They never reach patient or clinical data. This is enforced by the platform database role having no access to PHI tables (K-16). | spec §4.6 |
| K-07 | Practice-admin scope (F-17) | A PRACTICE_ADMIN manages only users whose memberships and role grants lie entirely within the admin's practice scope. Organization-wide users need an ORGANIZATION_ADMIN. | spec §4.5–§4.6 |
| K-08 | Practice-owned records (F-18) | M1.1 records, for every Layer 1 model, whether it is organization-owned or practice-owned, and tests it. Later models are classified in their layer; the location questions for plans stay with Layer 4. | spec §4.6; ADR-0001 |
| K-09 | Tokens in URLs (F-16) | From Layer 1 on, every invitation, reset or verification token travels in a request body, never in a path or query string. The patient invitation endpoint follows this rule when it arrives in Layer 5. | spec §6.1.10 |
| K-10 | `ACCESS_DENIED` audit (F-19) | Audit every denial on routes that touch patient data, collapsing identical repeats from the same actor into one event with a count. The 404 body stays identical to a missing record, so auditing never reveals existence. | spec §4.6, §7.3 |
| K-11 | Client token handling (F-21) | No PKCE, which protects redirect-based code flows we do not use; this is a first-party direct login over TLS. **iOS:** access token in memory; refresh token in the Keychain (K-22). **Admin web:** access token in memory; refresh token only in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie scoped to the refresh path; an `Origin` check guards against CSRF. The spec §4.2 wording is corrected to match. | spec §4.2 |
| K-12 | Session revocation scope (F-23) | An organization admin revokes only sessions bound to their organization. Disabling a user's membership in one organization ends only that organization's sessions. Platform security may revoke everything. | spec §4.2 |
| K-13 | Login failure for an unknown identifier (F-24) | Recorded in `LoginEvent` only (hashed identifier, IP, reason). An `AuditEvent` `LOGIN_FAILURE` is written when the identifier matches a user. The response is identical either way (no account enumeration). | spec §4.2, §7.3 |
| K-14 | Email in Layer 1 (F-25) | The api sends templated transactional email (invites, password reset; no PHI) through Amazon SES under the BAA. Mailpit joins local `docker compose` for development. The notifications service still arrives in Layer 5. | Bible §14.3; ADR-0010 |
| K-15 | Credentials and recovery (F-27) | See the list after this table. | Bible §21.1; spec §4.2 |
| K-16 | Row-Level Security design (F-26) | See the list after this table. | ADR-0004; spec §3.5 |
| K-17 | Offline patient creation (F-29) | Patient creation is online-only, because the duplicate check needs the server (Bible §4.1). Spec §6.1.8 is corrected to remove patient from the offline-queueable creates. | Bible §4.1, §23.1 |
| K-18 | Audit WORM copy (F-30) | Accept for Layer 1: append-only triggers plus insert/select-only grants. The WORM copy arrives with the outbox in Layer 2 as planned. | spec §7.3 |
| K-19 | Database test suite (F-31) | Split `schema_behavior_tests.sql` into per-layer fragments in M1.1, so each layer's migrations are tested alone. | spec §9.1 |
| K-20 | Patient status changes (F-55, Layer 1 part) | Archiving only through the archive action (`patient.archive`). Other status changes (inactive, deceased) go through update with `patient.update` and If-Match, and are audited. Nothing changes status automatically. | Bible §4.2; spec §6.3 |
| K-21 | CI security tools (F-32 part) | GitHub CodeQL for SAST and gitleaks for secret scanning in CI (both free for this repository). Pin third-party GitHub Actions to commit SHAs in M1.2. Trivy container scanning with the first image (spec §7.1 threshold). | ADR-0016 |
| K-22 | Keychain settings (F-32 part) | The refresh token is stored `WhenPasscodeSetThisDeviceOnly` with `.biometryCurrentSet`. If biometrics are unavailable or have changed, the user signs in again with password and MFA; there is no passcode fallback. The spec §4.2 wording ("plus device passcode fallback") is corrected to match. | spec §4.2 |
| K-24 | Patient login linked to several patient records (F-20) | Not a Layer 1 question: patient identities arrive in Layer 5. Decide there, together with UD-08. | spec §4.7; ACCEPTANCE_CRITERIA.md F-20 |
| K-23 | Admin web shell | **Included (owner's choice).** A minimal admin web in Layer 1 (M1.11) with sign-in, users and roles, and the audit viewer. It is only a client of the Layer 1 APIs; without it, user management would be API-only. | Bible §17, §32; ADR-0003 |

**K-15, credentials and recovery:**
- **Passwords:** follow NIST SP 800-63B. At least 12 characters, checked against a common and breached-password list, with no composition rules.
- **Lockout:** 5 consecutive failures lock the account for 15 minutes, and the lock grows on repeats. WAF rate rules protect the endpoint.
- **Reset:** a single-use email token, stored hashed, expiring in 30 minutes. Completing a reset revokes all sessions.
- **Password change:** a new endpoint that needs the current password and a recent MFA.
- **Lost factors:** a user who has lost every MFA factor needs an admin-initiated reset.
- **`MFA_REQUIRED`:** means "password accepted, second factor pending". It is recorded as a step, not a failure.

**K-16, Row-Level Security design:**
- The application database role has no `BYPASSRLS`, and tenant tables use `FORCE ROW LEVEL SECURITY`.
- Every request runs in a transaction that sets `app.organization_id` from the verified token with `SET LOCAL`. An unset value matches no rows.
- The pre-tenant membership lookup at sign-in uses one narrow `SECURITY DEFINER` function.
- Platform operations use a separate role limited to platform tables.
- Workers set the tenant for each job.
- The performance gate (≤10% p95 and ≤5 ms) is measured in M1.1. If it fails, ADR-0004 is revisited before going further.

## 3. Owner inputs that do not block Layer 1

Layer 1 is built and proven locally and in CI; nothing is deployed. These are needed later:

| Needed | Before | Finding |
|---|---|---|
| AWS accounts and organization structure (including the security account for CloudTrail), signed AWS BAA, domain names | The first deployment | F-32, F-59 |
| Apple Developer team and bundle identifier prefix | The first TestFlight build | UD-34 |
| Pilot success metrics | The pilot | F-33 |
| Repository visibility (public, but the Bible is marked confidential) | As soon as possible | F-56 |

## 4. After confirmation (done 2026-09-29)

1. The confirmed decisions are recorded as ADR-0018. The spec corrections were applied under change control; ADR-0018 lists each one:
   - §3.5 (K-16)
   - §4.2 (K-03, K-11, K-12, K-13, K-15, K-22)
   - §4.5 and §4.6 (K-05, K-06, K-07, K-10)
   - §5.4.10 (K-20)
   - §6.1.8 (K-17) and §6.1.10 (K-09)
   - §6.3 to §6.5, and the audit additions in §7.3 (K-04)
   - the `UserToken` table (K-09, K-15)
2. F-13 to F-33 and F-59 are marked resolved or scheduled in [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) §5.2.
3. M1.1 (database foundation) is under way.
