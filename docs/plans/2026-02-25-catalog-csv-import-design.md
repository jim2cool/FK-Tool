# Catalog CSV Import — Smart Column Mapping Design

**Date:** 2026-02-25
**Scope:** Master Catalog bulk import via CSV, with smart auto-mapping and user-controlled column assignment
**Status:** Approved

---

## Problem

The existing CSV import requires exact column headers (`master_sku_name`, `flipkart_sku`, etc.). Real-world files come from Flipkart exports, Amazon reports, and internal spreadsheets — all with different headers. Any mismatch causes silent row-level failures with no user feedback.

---

## Goal

Zero silent failures. The user should never be able to import a CSV and get back "0 processed" without understanding why. Every import either succeeds with a clear result summary or the user is given the information needed to correct and retry.

---

## Design

### Flow

```
Upload CSV
    ↓
Parse in-browser (Papa Parse) → extract headers + first 5 rows
    ↓
Open Column Mapping Dialog
    ↓ (auto-detect + user adjusts)
Preview interpreted rows
    ↓
Confirm → POST (CSV text + mapping) to API
    ↓
Show results: created / updated / failed with row-level error list
```

### Step 1 — Upload

- Existing "Bulk Import CSV" button opens a file picker (CSV only)
- Client-side Papa Parse reads headers and first 5 rows — no server call yet
- Opens the Column Mapping Dialog immediately

### Step 2 — Column Mapping Dialog

A modal dialog with a **mapping table** and a **row preview**.

**Mapping table** — one row per target field:

| Target Field | Required | Your Column (dropdown) | Sample value |
|---|---|---|---|
| Master SKU Name | ✓ | `[auto-detected or pick]` | `Premium T-Shirt` |
| Flipkart SKU | — | `[auto-detected or skip]` | `FKTSHIRT001` |
| Amazon SKU | — | `[auto-detected or skip]` | — |
| D2C SKU | — | `[auto-detected or skip]` | — |
| Description | — | `[auto-detected or skip]` | `100% cotton` |

Each dropdown lists all CSV column headers + a `— skip this field —` option.

**Auto-detection** uses fuzzy matching against known synonyms:
- Master SKU Name: `sku name`, `product name`, `item name`, `title`, `master sku`, `name`
- Flipkart SKU: `flipkart`, `fk sku`, `fk listing`, `fk id`, `marketplace sku (flipkart)`
- Amazon SKU: `amazon`, `asin`, `amazon sku`, `amz`, `marketplace sku (amazon)`
- D2C SKU: `d2c`, `website sku`, `own site`, `direct`
- Description: `description`, `desc`, `details`, `product description`

A confidence badge (green ≥ 80%, yellow ≥ 50%, red < 50%) shown next to each auto-detected choice. User can override any mapping.

**Import is blocked** (Confirm button disabled) until Master SKU Name is mapped.

**Row preview** — below the mapping table, a small 5-row table shows data as it will be interpreted using the current mapping. Updates live as user changes dropdowns.

### Step 3 — Confirm + Import

User clicks "Import N rows". The dialog shows a spinner.

**API contract** — POST `/api/catalog/import-csv`:
```json
{
  "csv": "<raw CSV text>",
  "mapping": {
    "master_sku_name": "Product Name",
    "flipkart_sku": "FK Listing ID",
    "amazon_sku": null,
    "d2c_sku": null,
    "description": "Item Description"
  }
}
```

Server-side importer reads each row using `row[mapping.flipkart_sku]` instead of hardcoded `row['flipkart_sku']`. Null fields are skipped.

### Step 4 — Results

Dialog transitions to a results view:

- `✓ 47 rows imported (32 created, 15 updated)`
- If any row errors: collapsible "Show X errors" → table with row number, SKU name, error message
- Row errors do **not** block the whole import; successful rows are committed
- "Download error CSV" button exports only the failed rows for correction and re-import
- "Done" closes dialog and refreshes the catalog table

---

## Error Taxonomy

| Error | Handling |
|---|---|
| Missing required field (master_sku_name blank) | Row skipped, counted in errors |
| Duplicate platform SKU already mapped to different master SKU | Row-level error, logged |
| DB constraint violation | Row-level error, logged |
| Entire CSV unparseable | Pre-import error, dialog stays open |
| Zero rows after parsing | Warning before import: "Your file appears empty" |

---

## Components

| Component | Location | Purpose |
|---|---|---|
| `CsvImportDialog` | `src/components/catalog/CsvImportDialog.tsx` | Full dialog: upload trigger, mapping UI, results |
| `useColumnMapper` | inside `CsvImportDialog.tsx` | Auto-detect logic, mapping state |
| `importSkuMappingCsv` | `src/lib/importers/sku-mapping-importer.ts` | Updated to accept `mapping` param |
| `/api/catalog/import-csv` | `src/app/api/catalog/import-csv/route.ts` | Updated to accept `{ csv, mapping }` body |

The existing hidden `<input type="file">` in `catalog/page.tsx` is replaced by the dialog trigger.

---

## Out of Scope (Future)

- Marketplace account assignment per platform SKU (separate Accounts page)
- Location/warehouse assignment via CSV (tied to purchases, not catalog)
- XLSX support for this importer (catalog imports are typically CSV exports from platforms)
- Remembering previous column mappings across sessions (nice-to-have, phase 2)
