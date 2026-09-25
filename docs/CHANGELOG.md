# Changelog

All material changes to the architecture, contracts and repository. Newest first. Entries reference ADRs in `ARCHITECTURE_DECISIONS.md`.

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
