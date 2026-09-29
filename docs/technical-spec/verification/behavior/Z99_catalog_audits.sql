-- =============================================================================
-- CATALOG AUDITS - run last, over whatever tables exist
-- =============================================================================

-- =============================================================================
-- V7  MATCH SIMPLE audit (spec §11.1). PostgreSQL skips a composite foreign
-- key whenever any of its columns is NULL, so every composite FK with two or
-- more nullable columns needs a CHECK on the same table that mentions all of
-- those columns and forces the FK to be evaluated. Read from the live catalog,
-- so a new table cannot slip past it.
-- =============================================================================
DO $$
DECLARE
  fk record;
  uncovered text[] := '{}';
  audited int := 0;
BEGIN
  FOR fk IN
    SELECT c.conrelid, c.conname, c.conrelid::regclass::text AS tbl,
           array_agg(a.attname::text ORDER BY a.attnum) FILTER (WHERE NOT a.attnotnull) AS nullable_cols
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) AS k(attnum)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f' AND cardinality(c.conkey) >= 2
      AND c.connamespace = 'public'::regnamespace
    GROUP BY c.conrelid, c.conname
    HAVING count(*) FILTER (WHERE NOT a.attnotnull) >= 2
  LOOP
    audited := audited + 1;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint ck
      WHERE ck.conrelid = fk.conrelid AND ck.contype = 'c'
        AND NOT EXISTS (
          SELECT 1 FROM unnest(fk.nullable_cols) AS col
          WHERE position(quote_ident(col) IN pg_get_constraintdef(ck.oid)) = 0)
    ) THEN
      uncovered := uncovered || (fk.tbl || '.' || fk.conname);
    END IF;
  END LOOP;
  IF audited = 0 THEN
    RAISE EXCEPTION 'FAIL  V7 audit found no composite FKs with nullable columns; the catalog query is broken';
  END IF;
  IF cardinality(uncovered) > 0 THEN
    RAISE EXCEPTION 'FAIL  V7 composite FKs without a covering CHECK: %', uncovered;
  END IF;
  INSERT INTO _results VALUES (format('V7 %s composite FKs with nullable columns are covered by CHECKs', audited), true);
  RAISE NOTICE 'PASS  V7 % composite FKs with nullable columns are covered by CHECKs', audited;
END $$;

-- =============================================================================
-- Summary
-- =============================================================================
SELECT count(*) AS checks_passed FROM _results WHERE passed;
