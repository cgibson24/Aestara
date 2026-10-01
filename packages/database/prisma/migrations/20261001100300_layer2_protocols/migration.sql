-- The Bible §6.2 standard photography protocols (ADR-0023 K2-11;
-- docs/PHOTO_PROTOCOLS.md §2). Every organization has them, ACTIVE and
-- organization-wide: this migration seeds the organizations that exist, and the
-- organization bootstrap (POST /organizations, platform role) seeds each new one
-- through the same function, so there is one definition of the standard set.
--
-- The function is SECURITY DEFINER because organization creation runs as
-- aestara_platform, which has no grant on clinical configuration (ADR-0018 K-06).
-- It is owned by aestara_protocol_seed, a NOLOGIN role that may only read and
-- write the two protocol tables, and it acts only inside the organization it is
-- given: it sets that tenant for its own statements and restores the caller's.
-- It does nothing for an organization that already has protocols.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aestara_protocol_seed') THEN
    CREATE ROLE aestara_protocol_seed NOLOGIN NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aestara_protocol_seed'
               AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'aestara_protocol_seed must be NOLOGIN, NOSUPERUSER and NOBYPASSRLS';
  END IF;
END $$;

-- UUIDv7 (RFC 9562): 48-bit Unix milliseconds, version 7, variant 10, random rest.
-- PostgreSQL 18 has uuidv7(); this keeps PostgreSQL 15 to 17 working (spec §2.1).
CREATE FUNCTION app_uuidv7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    set_bit(set_bit(set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
              PLACING substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
              FROM 1 FOR 6),
      52, 1), 53, 1), 54, 1), 55, 0),
    'hex')::uuid
$$;

CREATE FUNCTION app_seed_standard_protocols(p_organization_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  previous text := coalesce(current_setting('app.organization_id', true), '');
  protocol record;
  protocol_id uuid;
  created integer := 0;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'an organization is required';
  END IF;
  PERFORM set_config('app.organization_id', p_organization_id::text, true);
  IF NOT EXISTS (SELECT 1 FROM "PhotographyProtocol" WHERE "organizationId" = p_organization_id) THEN
    FOR protocol IN
      SELECT * FROM (VALUES
        ('Face', 'FACE',
         'Standard series: front, left and right 45 degrees, left and right profile.'),
        ('Breast', 'BREAST',
         'Standard series: front, left and right oblique, left and right lateral.'),
        ('Abdomen/body contour', 'ABDOMEN_BODY',
         'Standard series: front, left and right 45 degrees, left and right profile, back.')
      ) AS p(name, region, description)
    LOOP
      protocol_id := app_uuidv7();
      INSERT INTO "PhotographyProtocol" (id, "organizationId", name, "bodyRegion", description, status, "updatedAt")
      VALUES (protocol_id, p_organization_id, protocol.name, protocol.region::"BodyRegion", protocol.description,
              'DRAFT', now());
      -- Views go in while the protocol is a draft; the freeze trigger refuses them later.
      INSERT INTO "PhotographyProtocolView"
        (id, "organizationId", "protocolId", "viewKey", name, "sortOrder", "isRequired", "captureInstructions", "poseTarget")
      SELECT app_uuidv7(), p_organization_id, protocol_id, v.key, v.name, v.ord, true, v.instructions,
             jsonb_build_object(
               'subject', v.subject, 'yawDeg', v.yaw, 'yawToleranceDeg', 8,
               'pitchToleranceDeg', 8, 'rollToleranceDeg', 4, 'centerToleranceFraction', 0.08,
               'frameFill', CASE v.subject WHEN 'FACE' THEN 0.45 ELSE 0.80 END, 'frameFillTolerance', 0.08)
      FROM (VALUES
        ('FACE', 1, 'FRONT', 'Front', 'FACE', 0,
         'Patient faces the camera, head level, neutral expression, hair away from the face.'),
        ('FACE', 2, 'LEFT_45', 'Left 45', 'FACE', 45,
         'Patient turns the head to show the left side at about 45 degrees, head level, neutral expression.'),
        ('FACE', 3, 'RIGHT_45', 'Right 45', 'FACE', -45,
         'Patient turns the head to show the right side at about 45 degrees, head level, neutral expression.'),
        ('FACE', 4, 'LEFT_PROFILE', 'Left profile', 'FACE', 90,
         'Patient turns to show the left profile, head level, neutral expression.'),
        ('FACE', 5, 'RIGHT_PROFILE', 'Right profile', 'FACE', -90,
         'Patient turns to show the right profile, head level, neutral expression.'),
        ('BREAST', 1, 'FRONT', 'Front', 'TORSO', 0,
         'Patient stands facing the camera, arms relaxed at the sides, framed from the shoulders to the waist.'),
        ('BREAST', 2, 'LEFT_OBLIQUE', 'Left oblique', 'TORSO', 45,
         'Patient turns to show the left side at about 45 degrees, arms relaxed at the sides.'),
        ('BREAST', 3, 'RIGHT_OBLIQUE', 'Right oblique', 'TORSO', -45,
         'Patient turns to show the right side at about 45 degrees, arms relaxed at the sides.'),
        ('BREAST', 4, 'LEFT_LATERAL', 'Left lateral', 'TORSO', 90,
         'Patient turns to show the left side at 90 degrees, arms relaxed at the sides.'),
        ('BREAST', 5, 'RIGHT_LATERAL', 'Right lateral', 'TORSO', -90,
         'Patient turns to show the right side at 90 degrees, arms relaxed at the sides.'),
        ('ABDOMEN_BODY', 1, 'FRONT', 'Front', 'TORSO', 0,
         'Patient stands facing the camera, feet together, arms relaxed, framed from the chest to the upper thighs.'),
        ('ABDOMEN_BODY', 2, 'LEFT_45', 'Left 45', 'TORSO', 45,
         'Patient turns to show the left side at about 45 degrees, feet together, arms relaxed.'),
        ('ABDOMEN_BODY', 3, 'RIGHT_45', 'Right 45', 'TORSO', -45,
         'Patient turns to show the right side at about 45 degrees, feet together, arms relaxed.'),
        ('ABDOMEN_BODY', 4, 'LEFT_PROFILE', 'Left profile', 'TORSO', 90,
         'Patient turns to show the left side at 90 degrees, feet together, arms relaxed.'),
        ('ABDOMEN_BODY', 5, 'RIGHT_PROFILE', 'Right profile', 'TORSO', -90,
         'Patient turns to show the right side at 90 degrees, feet together, arms relaxed.'),
        ('ABDOMEN_BODY', 6, 'BACK', 'Back', 'TORSO', 180,
         'Patient stands with the back to the camera, feet together, arms relaxed.')
      ) AS v(region, ord, key, name, subject, yaw, instructions)
      WHERE v.region = protocol.region;
      UPDATE "PhotographyProtocol" SET status = 'ACTIVE' WHERE id = protocol_id;
      created := created + 1;
    END LOOP;
  END IF;
  PERFORM set_config('app.organization_id', previous, true);
  RETURN created;
END;
$$;

-- Seed the organizations created in Layer 1, while this migration still owns the
-- function (the function sets each tenant, so Row-Level Security applies as usual).
-- Listing every organization needs the owner's view of the table, so FORCE is
-- lifted for this one statement, inside this migration's transaction.
ALTER TABLE "Organization" NO FORCE ROW LEVEL SECURITY;
SELECT app_seed_standard_protocols(id) FROM "Organization";
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;

-- Transfer the function to its owner role (the pattern of the Layer 1 sign-in
-- function): SET ROLE membership without inheritance, CREATE on the schema only
-- for the moment of the transfer.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    IF NOT pg_has_role(current_user, 'aestara_protocol_seed', 'SET') THEN
      EXECUTE format('GRANT aestara_protocol_seed TO %I WITH INHERIT FALSE, SET TRUE', current_user);
    END IF;
  ELSIF NOT pg_has_role(current_user, 'aestara_protocol_seed', 'MEMBER') THEN
    EXECUTE format('GRANT aestara_protocol_seed TO %I', current_user);
  END IF;
END $$;
REVOKE ALL ON FUNCTION app_seed_standard_protocols(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_seed_standard_protocols(uuid) TO aestara_platform;
GRANT USAGE ON SCHEMA public TO aestara_protocol_seed;
GRANT CREATE ON SCHEMA public TO aestara_protocol_seed;
ALTER FUNCTION app_seed_standard_protocols(uuid) OWNER TO aestara_protocol_seed;
REVOKE CREATE ON SCHEMA public FROM aestara_protocol_seed;
GRANT SELECT, INSERT, UPDATE ON "PhotographyProtocol", "PhotographyProtocolView" TO aestara_protocol_seed;
REVOKE ALL ON FUNCTION app_uuidv7() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_uuidv7() TO aestara_protocol_seed;
