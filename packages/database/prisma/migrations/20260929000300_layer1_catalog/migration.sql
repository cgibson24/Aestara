-- Layer 1 catalog data (spec §4.3–§4.5; ADR-0018 K-01): the permission catalog,
-- the system roles and the default role matrix. GENERATED from
-- packages/database/src/catalog.ts by scripts/generate-catalog-migration.ts.
-- Identifiers are fixed so every environment refers to the same rows.

INSERT INTO "Permission" (id, key, description) VALUES
  ('01a0ea76-0c00-7d4c-832b-c0cfab484d65', 'patient.read', 'Read patient demographics and the profile shell, never clinical content'),
  ('01a0ea76-0c00-74d1-9a57-685dea8bc60e', 'patient.create', 'Create patients'),
  ('01a0ea76-0c00-7018-b768-2160054550e8', 'patient.update', 'Update patient demographics, contacts and status'),
  ('01a0ea76-0c00-7b18-934c-1201f43966f3', 'patient.archive', 'Archive patients'),
  ('01a0ea76-0c00-72fe-878a-7c11992e426f', 'photo.capture', 'Capture and upload clinical photos; review patient-submitted photos'),
  ('01a0ea76-0c00-70f1-ac50-4bf8631ba3a6', 'photo.view', 'View clinical photos and derivatives'),
  ('01a0ea76-0c00-7090-af23-c6074f337596', 'photo.annotate', 'Annotate and tag photos; adjust registration'),
  ('01a0ea76-0c00-74c1-86f0-31a164d19412', 'photo.export', 'Export photos and access original images'),
  ('01a0ea76-0c00-7b82-a7b3-026d91599f31', 'photo.permission.read', 'Read media permission states'),
  ('01a0ea76-0c00-7f0e-b639-e95a54fb8989', 'photo.permission.manage', 'Record media permission changes'),
  ('01a0ea76-0c00-7aec-9334-57f4cc4ff2f9', 'consultation.create', 'Create consultations and read consultation records'),
  ('01a0ea76-0c00-72bc-98b6-ae5b112d65a5', 'consultation.edit', 'Edit consultation content; clinically complete instructions'),
  ('01a0ea76-0c00-7aea-9d45-cb945b538eb0', 'consultation.complete', 'Complete consultations and release consultation materials'),
  ('01a0ea76-0c00-79ed-b2e0-c4303f98b0d8', 'simulation.create', 'Create simulations and set their parameters'),
  ('01a0ea76-0c00-7084-8fc0-81c515843dd2', 'simulation.generate', 'Generate and regenerate simulation versions'),
  ('01a0ea76-0c00-70aa-8016-3240083eb5a9', 'simulation.review', 'View simulations, without review decisions'),
  ('01a0ea76-0c00-76a6-996a-ef422b968197', 'simulation.approve', 'Approve, reject or archive simulations'),
  ('01a0ea76-0c00-7b95-ad85-e6f48f5f47f7', 'simulation.release', 'Release approved simulations to the patient'),
  ('01a0ea76-0c00-713c-972d-282f5d7efa6d', 'treatmentplan.create', 'Create treatment plans; read plans and the treatment catalog'),
  ('01a0ea76-0c00-7792-b400-624e50013c35', 'treatmentplan.edit', 'Edit treatment plans'),
  ('01a0ea76-0c00-7360-8e5d-981bf6016abc', 'treatmentplan.send', 'Send treatment plans to the patient'),
  ('01a0ea76-0c00-72ab-94e4-0808969e6581', 'consent.template.manage', 'Manage consent templates'),
  ('01a0ea76-0c00-7ae9-bf5f-ee7f558ec84e', 'consent.assign', 'Assign consents; record witness and staff-assisted signatures'),
  ('01a0ea76-0c00-713e-9d80-7c8359fd23af', 'consent.sign.provider', 'Sign consents as the provider'),
  ('01a0ea76-0c00-7ce0-8c33-0c2f490fd8d4', 'consent.void', 'Void consents'),
  ('01a0ea76-0c00-783c-aefd-cf8f69d64c1f', 'message.send', 'Send messages and read threads the user participates in'),
  ('01a0ea76-0c00-7dcf-8b3a-823c296acb12', 'appointment.manage', 'Read and manage appointments'),
  ('01a0ea76-0c00-7387-831c-40470dc3f665', 'telehealth.start', 'Start telehealth sessions'),
  ('01a0ea76-0c00-71be-8cf5-eab523753e9f', 'user.read', 'Read users'),
  ('01a0ea76-0c00-7fe5-bf4d-3318453cedc2', 'user.create', 'Invite and create users'),
  ('01a0ea76-0c00-72d6-ab72-d624b62c3413', 'user.update', 'Update users and their provider or staff profiles'),
  ('01a0ea76-0c00-7029-b46c-421a3075c15d', 'user.disable', 'Disable users'),
  ('01a0ea76-0c00-7fbc-b466-712280de06b7', 'role.read', 'Read roles and the permission catalog'),
  ('01a0ea76-0c00-72d9-a3ed-5736016a68de', 'role.assign', 'Assign and revoke roles'),
  ('01a0ea76-0c00-7791-86c7-00041735cf58', 'practice.read', 'Read practices and locations'),
  ('01a0ea76-0c00-7a8c-8942-f24b21a3e72b', 'practice.manage', 'Manage practices, locations, protocols, the treatment catalog and appointment types'),
  ('01a0ea76-0c00-7ad8-ae5e-78e40e953f40', 'content.read', 'Read education content and assign it'),
  ('01a0ea76-0c00-71e3-a95c-c937910e01b4', 'content.manage', 'Manage education content'),
  ('01a0ea76-0c00-75e2-8742-08ed27498e96', 'integration.read', 'Read integrations and their sync status'),
  ('01a0ea76-0c00-7dc5-803d-00ee79f33339', 'integration.manage', 'Manage integrations'),
  ('01a0ea76-0c00-7330-ab86-1daa541998b8', 'audit.read', 'Read audit events'),
  ('01a0ea76-0c00-716c-9250-d94857a596ba', 'organization.read', 'Read organizations'),
  ('01a0ea76-0c00-7815-8203-b706121184e3', 'organization.manage', 'Create organizations (platform) or update one''s own organization'),
  ('01a0ea76-0c00-76c0-9d24-d4f556e7c0bc', 'document.read', 'Read clinical documents'),
  ('01a0ea76-0c00-7471-a458-050dbf2748d2', 'document.manage', 'Upload and release documents'),
  ('01a0ea76-0c00-7c07-82e9-fe178e089f32', 'procedure.manage', 'Manage procedures'),
  ('01a0ea76-0c00-759c-8c1e-bce91349cefd', 'data.export', 'Request and download patient data exports'),
  ('01a0ea76-0c00-7983-b16e-a0e94ce71db9', 'security.manage', 'Revoke sessions and devices; reset a user''s second factors'),
  ('01a0ea76-0c00-7c80-87b2-f286d0b04405', 'ai.model.read', 'Read the AI model registry'),
  ('01a0ea76-0c00-7c69-a417-7b0142030d70', 'ai.model.manage', 'Manage AI model rollouts'),
  ('01a0ea76-0c00-7252-88b7-5ed3f6261b95', 'configuration.manage', 'Manage settings and feature flags'),
  ('01a0ea76-0c00-7514-b87b-d12df40e7ac4', 'similarcase.search', 'Search similar cases'),
  ('01a0ea76-0c00-70eb-aa50-c19e2e3edd7a', 'marketing.library.read', 'Read marketing assets that have a current release');

INSERT INTO "Role" (id, "organizationId", key, name, description, "updatedAt") VALUES
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', NULL, 'SUPER_ADMIN', 'Super admin', 'Platform operations; organization metadata only, never patient data', now()),
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', NULL, 'ORGANIZATION_ADMIN', 'Organization admin', 'Administers one organization', now()),
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', NULL, 'PRACTICE_ADMIN', 'Practice admin', 'Administers the practices in the assignment''s scope', now()),
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', NULL, 'SURGEON_PHYSICIAN', 'Surgeon / physician', 'Clinical lead: consultations, simulations, plans and consents', now()),
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', NULL, 'NURSE_INJECTOR_AESTHETICIAN', 'Nurse injector / aesthetician', 'Clinical staff: capture, consultations and plans', now()),
  ('01a0ea76-0c00-7352-a1f3-9c8171d7dee3', NULL, 'PHOTOGRAPHER', 'Photographer', 'Clinical photography', now()),
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', NULL, 'CONSULTANT', 'Consultant', 'Patient consultations without clinical authority', now()),
  ('01a0ea76-0c00-792b-9034-852b80873dc0', NULL, 'FRONT_DESK', 'Front desk', 'Patient registration and scheduling', now()),
  ('01a0ea76-0c00-79ee-a176-88c6916e33b7', NULL, 'MARKETING', 'Marketing', 'Released marketing assets only', now()),
  ('01a0ea76-0c00-7f2e-8d63-ec095ff690be', NULL, 'PATIENT', 'Patient', 'Patient-app access through a patient link; holds no staff permission', now());

INSERT INTO "RolePermission" ("roleId", "permissionId") VALUES
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-71be-8cf5-eab523753e9f'), -- SUPER_ADMIN user.read
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-7fe5-bf4d-3318453cedc2'), -- SUPER_ADMIN user.create
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-72d6-ab72-d624b62c3413'), -- SUPER_ADMIN user.update
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-7029-b46c-421a3075c15d'), -- SUPER_ADMIN user.disable
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-7fbc-b466-712280de06b7'), -- SUPER_ADMIN role.read
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-72d9-a3ed-5736016a68de'), -- SUPER_ADMIN role.assign
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-7791-86c7-00041735cf58'), -- SUPER_ADMIN practice.read
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-75e2-8742-08ed27498e96'), -- SUPER_ADMIN integration.read
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-7330-ab86-1daa541998b8'), -- SUPER_ADMIN audit.read
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-716c-9250-d94857a596ba'), -- SUPER_ADMIN organization.read
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-7815-8203-b706121184e3'), -- SUPER_ADMIN organization.manage
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-7983-b16e-a0e94ce71db9'), -- SUPER_ADMIN security.manage
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-7c80-87b2-f286d0b04405'), -- SUPER_ADMIN ai.model.read
  ('01a0ea76-0c00-73ef-a18e-06d642d9ea9f', '01a0ea76-0c00-7c69-a417-7b0142030d70'), -- SUPER_ADMIN ai.model.manage
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-72ab-94e4-0808969e6581'), -- ORGANIZATION_ADMIN consent.template.manage
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-71be-8cf5-eab523753e9f'), -- ORGANIZATION_ADMIN user.read
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-7fe5-bf4d-3318453cedc2'), -- ORGANIZATION_ADMIN user.create
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-72d6-ab72-d624b62c3413'), -- ORGANIZATION_ADMIN user.update
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-7029-b46c-421a3075c15d'), -- ORGANIZATION_ADMIN user.disable
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-7fbc-b466-712280de06b7'), -- ORGANIZATION_ADMIN role.read
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-72d9-a3ed-5736016a68de'), -- ORGANIZATION_ADMIN role.assign
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-7791-86c7-00041735cf58'), -- ORGANIZATION_ADMIN practice.read
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-7a8c-8942-f24b21a3e72b'), -- ORGANIZATION_ADMIN practice.manage
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-7ad8-ae5e-78e40e953f40'), -- ORGANIZATION_ADMIN content.read
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-71e3-a95c-c937910e01b4'), -- ORGANIZATION_ADMIN content.manage
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-75e2-8742-08ed27498e96'), -- ORGANIZATION_ADMIN integration.read
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-7dc5-803d-00ee79f33339'), -- ORGANIZATION_ADMIN integration.manage
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-7330-ab86-1daa541998b8'), -- ORGANIZATION_ADMIN audit.read
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-716c-9250-d94857a596ba'), -- ORGANIZATION_ADMIN organization.read
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-7815-8203-b706121184e3'), -- ORGANIZATION_ADMIN organization.manage
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-759c-8c1e-bce91349cefd'), -- ORGANIZATION_ADMIN data.export
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-7983-b16e-a0e94ce71db9'), -- ORGANIZATION_ADMIN security.manage
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-7c80-87b2-f286d0b04405'), -- ORGANIZATION_ADMIN ai.model.read
  ('01a0ea76-0c00-7304-ade2-b05d7acb5261', '01a0ea76-0c00-7252-88b7-5ed3f6261b95'), -- ORGANIZATION_ADMIN configuration.manage
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-7d4c-832b-c0cfab484d65'), -- PRACTICE_ADMIN patient.read
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-74d1-9a57-685dea8bc60e'), -- PRACTICE_ADMIN patient.create
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-7018-b768-2160054550e8'), -- PRACTICE_ADMIN patient.update
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-7b18-934c-1201f43966f3'), -- PRACTICE_ADMIN patient.archive
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-72ab-94e4-0808969e6581'), -- PRACTICE_ADMIN consent.template.manage
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-7dcf-8b3a-823c296acb12'), -- PRACTICE_ADMIN appointment.manage
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-71be-8cf5-eab523753e9f'), -- PRACTICE_ADMIN user.read
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-7fe5-bf4d-3318453cedc2'), -- PRACTICE_ADMIN user.create
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-72d6-ab72-d624b62c3413'), -- PRACTICE_ADMIN user.update
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-7029-b46c-421a3075c15d'), -- PRACTICE_ADMIN user.disable
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-7fbc-b466-712280de06b7'), -- PRACTICE_ADMIN role.read
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-72d9-a3ed-5736016a68de'), -- PRACTICE_ADMIN role.assign
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-7791-86c7-00041735cf58'), -- PRACTICE_ADMIN practice.read
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-7a8c-8942-f24b21a3e72b'), -- PRACTICE_ADMIN practice.manage
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-7ad8-ae5e-78e40e953f40'), -- PRACTICE_ADMIN content.read
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-71e3-a95c-c937910e01b4'), -- PRACTICE_ADMIN content.manage
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-7330-ab86-1daa541998b8'), -- PRACTICE_ADMIN audit.read
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-7983-b16e-a0e94ce71db9'), -- PRACTICE_ADMIN security.manage
  ('01a0ea76-0c00-75b5-a667-62a1ebe1b353', '01a0ea76-0c00-7252-88b7-5ed3f6261b95'), -- PRACTICE_ADMIN configuration.manage
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7d4c-832b-c0cfab484d65'), -- SURGEON_PHYSICIAN patient.read
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-74d1-9a57-685dea8bc60e'), -- SURGEON_PHYSICIAN patient.create
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7018-b768-2160054550e8'), -- SURGEON_PHYSICIAN patient.update
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7b18-934c-1201f43966f3'), -- SURGEON_PHYSICIAN patient.archive
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-72fe-878a-7c11992e426f'), -- SURGEON_PHYSICIAN photo.capture
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-70f1-ac50-4bf8631ba3a6'), -- SURGEON_PHYSICIAN photo.view
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7090-af23-c6074f337596'), -- SURGEON_PHYSICIAN photo.annotate
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-74c1-86f0-31a164d19412'), -- SURGEON_PHYSICIAN photo.export
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7b82-a7b3-026d91599f31'), -- SURGEON_PHYSICIAN photo.permission.read
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7f0e-b639-e95a54fb8989'), -- SURGEON_PHYSICIAN photo.permission.manage
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7aec-9334-57f4cc4ff2f9'), -- SURGEON_PHYSICIAN consultation.create
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-72bc-98b6-ae5b112d65a5'), -- SURGEON_PHYSICIAN consultation.edit
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7aea-9d45-cb945b538eb0'), -- SURGEON_PHYSICIAN consultation.complete
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-79ed-b2e0-c4303f98b0d8'), -- SURGEON_PHYSICIAN simulation.create
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7084-8fc0-81c515843dd2'), -- SURGEON_PHYSICIAN simulation.generate
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-70aa-8016-3240083eb5a9'), -- SURGEON_PHYSICIAN simulation.review
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-76a6-996a-ef422b968197'), -- SURGEON_PHYSICIAN simulation.approve
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7b95-ad85-e6f48f5f47f7'), -- SURGEON_PHYSICIAN simulation.release
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-713c-972d-282f5d7efa6d'), -- SURGEON_PHYSICIAN treatmentplan.create
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7792-b400-624e50013c35'), -- SURGEON_PHYSICIAN treatmentplan.edit
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7360-8e5d-981bf6016abc'), -- SURGEON_PHYSICIAN treatmentplan.send
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7ae9-bf5f-ee7f558ec84e'), -- SURGEON_PHYSICIAN consent.assign
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-713e-9d80-7c8359fd23af'), -- SURGEON_PHYSICIAN consent.sign.provider
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7ce0-8c33-0c2f490fd8d4'), -- SURGEON_PHYSICIAN consent.void
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-783c-aefd-cf8f69d64c1f'), -- SURGEON_PHYSICIAN message.send
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7dcf-8b3a-823c296acb12'), -- SURGEON_PHYSICIAN appointment.manage
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7387-831c-40470dc3f665'), -- SURGEON_PHYSICIAN telehealth.start
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7791-86c7-00041735cf58'), -- SURGEON_PHYSICIAN practice.read
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7ad8-ae5e-78e40e953f40'), -- SURGEON_PHYSICIAN content.read
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-76c0-9d24-d4f556e7c0bc'), -- SURGEON_PHYSICIAN document.read
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7471-a458-050dbf2748d2'), -- SURGEON_PHYSICIAN document.manage
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7c07-82e9-fe178e089f32'), -- SURGEON_PHYSICIAN procedure.manage
  ('01a0ea76-0c00-726b-9cd5-030d0c795ca0', '01a0ea76-0c00-7514-b87b-d12df40e7ac4'), -- SURGEON_PHYSICIAN similarcase.search
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7d4c-832b-c0cfab484d65'), -- NURSE_INJECTOR_AESTHETICIAN patient.read
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-74d1-9a57-685dea8bc60e'), -- NURSE_INJECTOR_AESTHETICIAN patient.create
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7018-b768-2160054550e8'), -- NURSE_INJECTOR_AESTHETICIAN patient.update
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-72fe-878a-7c11992e426f'), -- NURSE_INJECTOR_AESTHETICIAN photo.capture
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-70f1-ac50-4bf8631ba3a6'), -- NURSE_INJECTOR_AESTHETICIAN photo.view
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7090-af23-c6074f337596'), -- NURSE_INJECTOR_AESTHETICIAN photo.annotate
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7b82-a7b3-026d91599f31'), -- NURSE_INJECTOR_AESTHETICIAN photo.permission.read
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7f0e-b639-e95a54fb8989'), -- NURSE_INJECTOR_AESTHETICIAN photo.permission.manage
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7aec-9334-57f4cc4ff2f9'), -- NURSE_INJECTOR_AESTHETICIAN consultation.create
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-72bc-98b6-ae5b112d65a5'), -- NURSE_INJECTOR_AESTHETICIAN consultation.edit
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-79ed-b2e0-c4303f98b0d8'), -- NURSE_INJECTOR_AESTHETICIAN simulation.create
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7084-8fc0-81c515843dd2'), -- NURSE_INJECTOR_AESTHETICIAN simulation.generate
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-70aa-8016-3240083eb5a9'), -- NURSE_INJECTOR_AESTHETICIAN simulation.review
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-713c-972d-282f5d7efa6d'), -- NURSE_INJECTOR_AESTHETICIAN treatmentplan.create
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7792-b400-624e50013c35'), -- NURSE_INJECTOR_AESTHETICIAN treatmentplan.edit
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7ae9-bf5f-ee7f558ec84e'), -- NURSE_INJECTOR_AESTHETICIAN consent.assign
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-783c-aefd-cf8f69d64c1f'), -- NURSE_INJECTOR_AESTHETICIAN message.send
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7dcf-8b3a-823c296acb12'), -- NURSE_INJECTOR_AESTHETICIAN appointment.manage
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7387-831c-40470dc3f665'), -- NURSE_INJECTOR_AESTHETICIAN telehealth.start
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7791-86c7-00041735cf58'), -- NURSE_INJECTOR_AESTHETICIAN practice.read
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7ad8-ae5e-78e40e953f40'), -- NURSE_INJECTOR_AESTHETICIAN content.read
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-76c0-9d24-d4f556e7c0bc'), -- NURSE_INJECTOR_AESTHETICIAN document.read
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7471-a458-050dbf2748d2'), -- NURSE_INJECTOR_AESTHETICIAN document.manage
  ('01a0ea76-0c00-7345-bae7-12b76ddf8845', '01a0ea76-0c00-7c07-82e9-fe178e089f32'), -- NURSE_INJECTOR_AESTHETICIAN procedure.manage
  ('01a0ea76-0c00-7352-a1f3-9c8171d7dee3', '01a0ea76-0c00-7d4c-832b-c0cfab484d65'), -- PHOTOGRAPHER patient.read
  ('01a0ea76-0c00-7352-a1f3-9c8171d7dee3', '01a0ea76-0c00-72fe-878a-7c11992e426f'), -- PHOTOGRAPHER photo.capture
  ('01a0ea76-0c00-7352-a1f3-9c8171d7dee3', '01a0ea76-0c00-70f1-ac50-4bf8631ba3a6'), -- PHOTOGRAPHER photo.view
  ('01a0ea76-0c00-7352-a1f3-9c8171d7dee3', '01a0ea76-0c00-7b82-a7b3-026d91599f31'), -- PHOTOGRAPHER photo.permission.read
  ('01a0ea76-0c00-7352-a1f3-9c8171d7dee3', '01a0ea76-0c00-7791-86c7-00041735cf58'), -- PHOTOGRAPHER practice.read
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-7d4c-832b-c0cfab484d65'), -- CONSULTANT patient.read
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-74d1-9a57-685dea8bc60e'), -- CONSULTANT patient.create
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-7018-b768-2160054550e8'), -- CONSULTANT patient.update
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-70f1-ac50-4bf8631ba3a6'), -- CONSULTANT photo.view
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-7b82-a7b3-026d91599f31'), -- CONSULTANT photo.permission.read
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-7aec-9334-57f4cc4ff2f9'), -- CONSULTANT consultation.create
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-72bc-98b6-ae5b112d65a5'), -- CONSULTANT consultation.edit
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-70aa-8016-3240083eb5a9'), -- CONSULTANT simulation.review
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-713c-972d-282f5d7efa6d'), -- CONSULTANT treatmentplan.create
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-7792-b400-624e50013c35'), -- CONSULTANT treatmentplan.edit
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-7360-8e5d-981bf6016abc'), -- CONSULTANT treatmentplan.send
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-7ae9-bf5f-ee7f558ec84e'), -- CONSULTANT consent.assign
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-783c-aefd-cf8f69d64c1f'), -- CONSULTANT message.send
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-7dcf-8b3a-823c296acb12'), -- CONSULTANT appointment.manage
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-7791-86c7-00041735cf58'), -- CONSULTANT practice.read
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-7ad8-ae5e-78e40e953f40'), -- CONSULTANT content.read
  ('01a0ea76-0c00-7b25-a0a4-26cc069d5336', '01a0ea76-0c00-76c0-9d24-d4f556e7c0bc'), -- CONSULTANT document.read
  ('01a0ea76-0c00-792b-9034-852b80873dc0', '01a0ea76-0c00-7d4c-832b-c0cfab484d65'), -- FRONT_DESK patient.read
  ('01a0ea76-0c00-792b-9034-852b80873dc0', '01a0ea76-0c00-74d1-9a57-685dea8bc60e'), -- FRONT_DESK patient.create
  ('01a0ea76-0c00-792b-9034-852b80873dc0', '01a0ea76-0c00-7018-b768-2160054550e8'), -- FRONT_DESK patient.update
  ('01a0ea76-0c00-792b-9034-852b80873dc0', '01a0ea76-0c00-7dcf-8b3a-823c296acb12'), -- FRONT_DESK appointment.manage
  ('01a0ea76-0c00-792b-9034-852b80873dc0', '01a0ea76-0c00-7791-86c7-00041735cf58'), -- FRONT_DESK practice.read
  ('01a0ea76-0c00-79ee-a176-88c6916e33b7', '01a0ea76-0c00-74c1-86f0-31a164d19412'), -- MARKETING photo.export
  ('01a0ea76-0c00-79ee-a176-88c6916e33b7', '01a0ea76-0c00-70eb-aa50-c19e2e3edd7a'); -- MARKETING marketing.library.read

DO $$
BEGIN
  IF (SELECT count(*) FROM "Permission") <> 53
     OR (SELECT count(*) FROM "Role" WHERE "organizationId" IS NULL) <> 10
     OR (SELECT count(*) FROM "RolePermission") <> 139 THEN
    RAISE EXCEPTION 'catalog seed incomplete';
  END IF;
END $$;
