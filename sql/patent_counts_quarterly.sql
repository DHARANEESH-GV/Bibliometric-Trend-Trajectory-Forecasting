-- Quarterly patent counts: US granted patents, by GRANT quarter AND FILING
-- quarter, 2000-2025, for the 20 configured technology domains.
--
-- Companion to sql/patent_counts.sql (annual, grant-year only, 2014+).
-- THIS query exists because the annual file discarded sub-annual resolution:
-- it reduced the date with DIV(<date>, 10000), losing month and day, so its
-- 491-row output cannot be subdivided into quarters after the fact.
--
-- Source: patents-public-data.patents.publications (Google Patents Public
-- Data, CC BY 4.0). Run in the BigQuery sandbox (no billing account needed),
-- then download the result as CSV.
--
-- ---------------------------------------------------------------------------
-- APPROXIMATE BYTES SCANNED: ~18-20 GB
-- ---------------------------------------------------------------------------
-- Derivation (measured, not guessed): the annual-only companion query
-- processed 17.38 GB (BigQuery job console, 2026-10-29, 3.7 s). This query
-- touches the same columns plus one extra INT64 (filing_date) across the same
-- ~119M-row table, so add roughly 1 GB. Treat 18-20 GB as the planning figure.
--
-- Against the 1 TB/month sandbox allowance that is ~2%, so this can be run
-- ~50 times per month at no cost. Verify with the validator line in the
-- console before clicking Run; if it reports >100 GB, stop and investigate
-- rather than proceeding.
-- ---------------------------------------------------------------------------
--
-- SCOPE DECISION - both date types use the SAME patent universe:
--   country_code = 'US' AND kind_code LIKE 'B%'  (granted patents only).
-- Consequences to be aware of:
--   * 'grant'  = the year/quarter the patent was granted.
--   * 'filing' = the year/quarter the granted patent was FILED.
--   * Applications that were never granted are EXCLUDED from 'filing', so
--     filing counts here are "filings that eventually granted", not all
--     filings. This keeps the two series directly comparable (same patents,
--     two clocks); it is NOT a complete application-volume series.
--   * Filing dates run earlier than grant dates, so 'filing' reaches the
--     2000-2025 window with more coverage than 'grant' (which under-counts
--     recent years because grants lag filings by 1-3 years).
--   * Coverage caveat from the annual analysis still applies: the source has
--     no usable CPC classification for several sections before 2014, so
--     pre-2014 rows are present in the output but are NOT reliable. Keep them
--     labelled rather than silently trusting them.
--
-- Concordance (identical to sql/patent_counts.sql): a configured subgroup
-- '00' code matches every leaf in its CPC group; a specific subgroup matches
-- exactly that subgroup. A patent matching several domains counts once per
-- matched domain (multi-membership; overlaps are parent/child pairs such as
-- G06N10/70 within G06N10/00).
--
-- Date handling: grant_date and filing_date are INT64 of the form YYYYMMDD,
-- with 0 meaning absent. Rows where the date is 0 or NULL are skipped, and
-- only dates inside 20000101..20251231 are counted. Quarter is derived as
--   EXTRACT(QUARTER FROM PARSE_DATE('%Y%m%d', CAST(date AS STRING)))
-- as required, rather than integer arithmetic on MM.

WITH cfg AS (
  SELECT * FROM UNNEST([
    STRUCT('G06N20' AS cpc_group, '00' AS cpc_subgroup, 'artificial_intelligence' AS domain),
    STRUCT('G06N3', '00', 'artificial_intelligence'),
    STRUCT('G06F18', '00', 'artificial_intelligence'),
    STRUCT('G06N3', '08', 'generative_ai'),
    STRUCT('G06N3', '04', 'generative_ai'),
    STRUCT('G06N3', '092', 'ai_agents'),
    STRUCT('G05B13', '00', 'ai_agents'),
    STRUCT('G06N10', '00', 'quantum_computing'),
    STRUCT('G06N10', '20', 'quantum_computing'),
    STRUCT('G06N10', '40', 'quantum_computing'),
    STRUCT('G06N10', '70', 'quantum_error_correction'),
    STRUCT('H01M10', '0562', 'solid_state_batteries'),
    STRUCT('H01M2300', '0068', 'solid_state_batteries'),
    STRUCT('C25B1', '04', 'clean_hydrogen'),
    STRUCT('C25B15', '00', 'clean_hydrogen'),
    STRUCT('B01D53', '62', 'carbon_capture'),
    STRUCT('B01J20', '00', 'carbon_capture'),
    STRUCT('C12N15', '00', 'synthetic_biology'),
    STRUCT('A61B5', '16', 'brain_computer_interfaces'),
    STRUCT('G06F3', '01', 'brain_computer_interfaces'),
    STRUCT('H04L63', '00', 'cybersecurity'),
    STRUCT('G06F21', '00', 'cybersecurity'),
    STRUCT('H04L9', '32', 'blockchain'),
    STRUCT('G06Q20', '00', 'blockchain'),
    STRUCT('H04L67', '12', 'internet_of_things'),
    STRUCT('H04W4', '33', 'internet_of_things'),
    STRUCT('G06F9', '50', 'edge_computing'),
    STRUCT('H04L67', '10', 'edge_computing'),
    STRUCT('G05B17', '02', 'digital_twins'),
    STRUCT('G06F30', '00', 'digital_twins'),
    STRUCT('G05B19', '4185', 'smart_manufacturing'),
    STRUCT('B60W60', '00', 'autonomous_vehicles'),
    STRUCT('G01C21', '00', 'autonomous_vehicles'),
    STRUCT('B64G1', '00', 'space_technologies'),
    STRUCT('H01L21', '00', 'advanced_semiconductors'),
    STRUCT('H01L29', '00', 'advanced_semiconductors'),
    STRUCT('C12Q1', '00', 'biotechnology'),
    STRUCT('C12P1', '00', 'biotechnology')
  ])
),
us_granted AS (
  SELECT
    p.publication_number,
    p.grant_date,
    p.filing_date,
    c.code AS cpc_code
  FROM `patents-public-data.patents.publications` AS p,
       UNNEST(p.cpc) AS c
  WHERE p.country_code = 'US'
    AND p.kind_code LIKE 'B%'
    AND (
      (p.grant_date  IS NOT NULL AND p.grant_date  != 0
       AND p.grant_date  BETWEEN 20000101 AND 20251231)
      OR
      (p.filing_date IS NOT NULL AND p.filing_date != 0
       AND p.filing_date BETWEEN 20000101 AND 20251231)
    )
),
matched AS (
  SELECT
    g.publication_number,
    g.grant_date,
    g.filing_date,
    cfg.domain
  FROM us_granted AS g
  JOIN cfg
    ON cfg.cpc_group = SPLIT(REPLACE(g.cpc_code, ' ', ''), '/')[OFFSET(0)]
   AND (cfg.cpc_subgroup = '00'
        OR cfg.cpc_subgroup = SPLIT(REPLACE(g.cpc_code, ' ', ''), '/')[SAFE_OFFSET(1)])
),
dated AS (
  SELECT m.publication_number, m.domain, d.date_type, d.d AS date_value
  FROM matched AS m,
  UNNEST([
    STRUCT('grant' AS date_type, m.grant_date AS d),
    STRUCT('filing' AS date_type, m.filing_date AS d)
  ]) AS d
  WHERE d.d IS NOT NULL
    AND d.d != 0
    AND d.d BETWEEN 20000101 AND 20251231
)
SELECT
  domain,
  date_type,
  DIV(date_value, 10000) AS year,
  EXTRACT(QUARTER FROM PARSE_DATE('%Y%m%d', CAST(date_value AS STRING))) AS quarter,
  COUNT(DISTINCT publication_number) AS patents
FROM dated
GROUP BY domain, date_type, year, quarter
ORDER BY domain, date_type, year, quarter;
