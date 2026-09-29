-- =============================================================================
-- Behavioural verification of the database (schema.prisma + constraints.sql)
--
-- Proves that the database itself rejects the violations the Production Bible
-- forbids, independent of application code. Each check either PASSes or aborts
-- the run. Run instructions: docs/technical-spec/verification/README.md
--
-- One fragment per layer (ADR-0018 K-19), run in one psql session in file-name
-- order: this harness, the layer fragments, then Z99 (catalog audits and the
-- summary). A fragment uses only tables of its layer and earlier ones, so:
--   - run_schema_checks.sh runs every fragment against the full design schema;
--   - packages/database runs the fragments of the layers it has built against
--     its real migrations.
--
-- SQLSTATE legend: 23503 foreign_key_violation  23505 unique_violation
--                  23514 check_violation        AE001 IMMUTABLE_RECORD (trigger)
-- =============================================================================
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
SET client_min_messages = notice;

CREATE TEMP TABLE _results (label text, passed boolean);

CREATE FUNCTION pg_temp.expect_error(stmt text, expected text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected THEN
      INSERT INTO _results VALUES (label, true);
      RAISE NOTICE 'PASS  %', label;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL  % (expected %, got %: %)', label, expected, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL  % (expected %, but the statement succeeded)', label, expected;
END;
$$;

CREATE FUNCTION pg_temp.expect_ok(stmt text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  INSERT INTO _results VALUES (label, true);
  RAISE NOTICE 'PASS  %', label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL  % (expected success, got %: %)', label, SQLSTATE, SQLERRM;
END;
$$;
