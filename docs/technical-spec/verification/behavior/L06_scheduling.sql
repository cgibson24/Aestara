-- =============================================================================
-- LAYER 6 - Scheduling & telehealth (spec §5.8)
-- =============================================================================
-- =============================================================================
-- A. Tenant isolation (Bible 3.1, 21.2, 36 "Tenancy")
-- =============================================================================
SELECT pg_temp.expect_error($$
  INSERT INTO "Appointment" (id, "organizationId", "patientId", "practiceId", "providerUserId", "startsAt", "endsAt", timezone, "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-0000000000a1', '0b000000-0000-7000-8000-bda01469c352',
          now(), now() + interval '30 minutes', 'America/New_York', now())$$,
  '23503', 'A3 appointment in org A cannot use a provider of org B');

SELECT pg_temp.expect_error($$
  INSERT INTO "Appointment" (id, "organizationId", "patientId", "practiceId", "locationId", "startsAt", "endsAt", timezone, "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-0000000000a1', '0a000000-0000-7000-8000-00000000a2a2',
          now(), now() + interval '30 minutes', 'America/New_York', now())$$,
  '23503', 'A4 appointment location must belong to the appointment practice');

-- =============================================================================
-- H. Scheduling
-- =============================================================================
SELECT pg_temp.expect_error($$
  INSERT INTO "Appointment" (id, "organizationId", "patientId", "practiceId", "startsAt", "endsAt", timezone, "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-0000000000a1', now(), now() - interval '1 minute', 'America/New_York', now())$$,
  '23514', 'H1 an appointment must end after it starts');
