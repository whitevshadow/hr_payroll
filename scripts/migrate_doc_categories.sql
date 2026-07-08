-- ── migrate_doc_categories.sql ────────────────────────────────────────────────
--
-- One-time data repair: normalise doc_category → lowercase, doc_label → uppercase
-- so they match the DocCategory constants and MANDATORY_DOCS lookup in the backend.
--
-- SAFE TO RUN MULTIPLE TIMES — each UPDATE is a no-op if already normalised.
--
-- Usage (run against the hr_payroll database):
--   psql postgresql://hr:hr@localhost:5432/hr_payroll -f scripts/migrate_doc_categories.sql
--
-- Or from within the postgres container:
--   docker exec -i hr-payroll-postgres-1 \
--     psql -U hr -d hr_payroll < scripts/migrate_doc_categories.sql
-- ─────────────────────────────────────────────────────────────────────────────

\echo '--- Checking rows that need normalisation ---'

SELECT
  doc_category,
  doc_label,
  COUNT(*) AS rows
FROM blobs
WHERE
  (doc_category IS NOT NULL AND doc_category != LOWER(doc_category))
  OR
  (doc_label IS NOT NULL AND doc_label != UPPER(doc_label))
GROUP BY 1, 2
ORDER BY 1, 2;

\echo '--- Normalising doc_category to lowercase ---'

WITH updated AS (
  UPDATE blobs
  SET doc_category = LOWER(doc_category)
  WHERE doc_category IS NOT NULL
    AND doc_category != LOWER(doc_category)
  RETURNING id
)
SELECT COUNT(*) AS doc_category_rows_updated FROM updated;

\echo '--- Normalising doc_label to uppercase ---'

WITH updated AS (
  UPDATE blobs
  SET doc_label = UPPER(doc_label)
  WHERE doc_label IS NOT NULL
    AND doc_label != UPPER(doc_label)
  RETURNING id
)
SELECT COUNT(*) AS doc_label_rows_updated FROM updated;

\echo '--- Verification: all remaining mismatches (should be 0) ---'

SELECT COUNT(*) AS remaining_mismatches
FROM blobs
WHERE
  (doc_category IS NOT NULL AND doc_category != LOWER(doc_category))
  OR
  (doc_label IS NOT NULL AND doc_label != UPPER(doc_label));

\echo '--- Done. Refresh the employee documents page. ---'
