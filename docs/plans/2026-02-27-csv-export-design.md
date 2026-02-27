# CSV Export — Design

**Date:** 2026-02-27
**Status:** Approved

## Summary

Add an "Export CSV" button to the Catalog and Purchases pages. Export is client-side (no new API routes), uses already-loaded filtered data, and exports ALL filtered rows (not just the current page).

## Catalog Export

- **Trigger:** "Export CSV" button in header, next to "Bulk Import"
- **Data source:** `filteredRows` (all, not paginated)
- **Format:** One row per SKU mapping (flat — same product repeats if it has multiple mappings)
- **Columns:** Master Product, Variant, Channel, Account, SKU ID, Warehouse(s)
- **Filename:** `catalog-export-YYYY-MM-DD.csv`

## Purchases Export

- **Trigger:** "Export CSV" button in header
- **Data source:** `filtered` (all, not paginated)
- **Format:** One row per purchase record
- **Columns:** Receipt Date, Master Product, Variant, Qty, HSN Code, GST Rate, Tax Paid, Rate/Unit (ex), GST/Unit, Unit Price (incl.), Total GST, Total Amount, Vendor, Invoice #, Warehouse
- **Filename:** `purchases-export-YYYY-MM-DD.csv`

## Implementation

- Shared `exportCsv(rows, filename)` utility in `src/lib/utils/csv-export.ts`
- Client-side only: build CSV string → `Blob` → `<a download>` click
