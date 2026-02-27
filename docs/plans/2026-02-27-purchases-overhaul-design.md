# Purchases Page Overhaul — Design

**Date:** 2026-02-27
**Status:** Approved

---

## Overview

Overhaul the Purchases page to support the full CSV column set from the procurement template, add bulk CSV import, group records by month in accordions (paginated 50 globally), and lay the groundwork for the future COGS formula.

---

## Decisions

| Question | Decision |
|----------|----------|
| Rename to Procurements? | No — keep "Purchases" everywhere |
| Product selection | Linked to catalog dropdowns; new products auto-created in master_skus |
| New products in catalog | Appear immediately as "Unmapped" (existing behavior covers it) |
| Month grouping | Accordion per month, globally paginated 50 records |
| Calculated fields | Computed in UI, not stored (except total_cogs) |

---

## DB Migration

### Rename column
```sql
ALTER TABLE purchases RENAME COLUMN unit_cost TO unit_purchase_price;
```

`unit_purchase_price` is a *component* of COGS, not COGS itself. Naming it correctly now avoids confusion as the COGS formula grows.

### Add new columns
```sql
ALTER TABLE purchases ADD COLUMN hsn_code       TEXT;
ALTER TABLE purchases ADD COLUMN gst_rate_slab  TEXT    DEFAULT '18%';
ALTER TABLE purchases ADD COLUMN tax_paid       BOOLEAN DEFAULT FALSE;
ALTER TABLE purchases ADD COLUMN invoice_number TEXT;
```

### COGS formula (current)
```
total_cogs/unit = unit_purchase_price + packaging_cost + other_cost
total_cogs      = total_cogs/unit × quantity
```

Future additions (tracked, not implemented yet):
```
total_cogs/unit = unit_purchase_price
               + packaging_cost
               + reshipment_packaging_cost   ← future column
               + inward_cartage              ← future column
```

---

## Calculated Fields (UI only, not stored)

| Display column | Formula |
|----------------|---------|
| GST per unit | `unit_purchase_price × gst_rate% / 100` |
| Unit Purchase Price (incl. tax) | `unit_purchase_price + gst_per_unit` |
| Total GST Payable | `IF tax_paid = true → 0, ELSE gst_per_unit × quantity` |
| Total Amount | `unit_purchase_price_incl × quantity` |

---

## API Changes

### Existing `/api/purchases` route
- All `unit_cost` references → `unit_purchase_price`
- Accept new fields in POST/PATCH: `hsn_code`, `gst_rate_slab`, `tax_paid`, `invoice_number`
- Recalculate `total_cogs` = `(unit_purchase_price + packaging_cost + other_cost) × quantity`

### New `/api/purchases/import-csv` route (POST)
- Accepts `{ csv: string }`
- Server-side only (imports from `@/lib/supabase/server`)
- Returns `{ created, updated, skipped, errors[] }`

### New `/api/purchases/csv-template` route (GET)
- Returns CSV with Row 1 (mandatory/optional labels) + Row 2 (headers) + example row
- Comment rows at bottom: `# Existing products: Hair Curler, ...` for reference

---

## Page Layout

### Header
```
Purchases                          [Bulk Import]  [+ Add Purchase]
Track procurement and cost of goods
```

### Filter bar
- **Search** — product name or vendor (text input)
- **Warehouse** — dropdown
- **Date From / To** — date inputs
- **GST Rate** — dropdown (All / 0% / 5% / 12% / 18% / 28%)
- **Tax Paid** — dropdown (All / Paid / Unpaid)
- **[Clear filters]** — appears when any filter active

### Month accordions (paginated 50 globally)

Each accordion header:
```
▶ February 2026  —  8 records  ·  ₹2,34,500 total  ·  ₹42,210 GST
```
- Most recent month open by default, rest collapsed
- Accordion state is local (no persistence)

### Table (horizontally scrollable)

| Column | Notes |
|--------|-------|
| Date | receipt date |
| Master Product | parent name or flat SKU name |
| Variant | blank if none |
| Qty | right-aligned |
| HSN Code | muted if empty |
| GST Rate | badge |
| Tax Paid | ✓ / — |
| Rate/Unit (ex-tax) | ₹ right-aligned |
| GST/Unit | calculated |
| Unit Price (incl.) | calculated |
| Total GST | calculated, 0 if tax paid |
| Total Amount | calculated |
| Vendor | muted if empty |
| Invoice # | monospace, muted if empty |
| Warehouse | |
| Actions | edit / delete icons |

### Pagination footer
```
Showing 1–50 of 142 records    [← Prev]  [Next →]
─────────────────────────────────────────────────
Total units: 1,240  ·  Total GST: ₹84,210  ·  Total Amount: ₹5,67,800
```
(Totals reflect the current page / filter set, not all time)

---

## Single Add / Edit Dialog

### Product selection (two-step)
1. **Master Product** — searchable dropdown from `master_skus` (flat + parents)
2. **Variant** — appears only if selected product has variants; dropdown of its children
3. If typed name has no match: hint `"'Hair Curler' is a new product — it will be added to your catalog"`

### Fields
| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| Receipt Date | ✓ | today | |
| Master Product | ✓ | — | searchable dropdown |
| Variant | — | — | conditional on product |
| Quantity | ✓ | — | integer > 0 |
| HSN Code | — | — | text |
| GST Rate Slab | ✓ | 18% | dropdown: 0/5/12/18/28% |
| Tax Paid | ✓ | No | Yes/No toggle |
| Rate Per Unit (ex-tax) | ✓ | — | ₹ |
| Packaging Cost | — | 0 | ₹ |
| Other Cost | — | 0 | ₹ |
| Vendor Name | — | — | text |
| Invoice Number | — | — | text |
| Warehouse | ✓ | — | dropdown |

### Live preview (shown when rate entered)
```
GST/unit: ₹36  ·  Unit Price (incl.): ₹236  ·  Total GST: ₹360  ·  Total Amount: ₹2,360
```

---

## Bulk CSV Import

### Dialog flow (same pattern as catalog import)
`idle` → `preview` → `importing` → `results`

- **idle**: Download Template button + drag-and-drop zone
- **preview**: parsed rows table — valid rows green, invalid rows red with reason; "Import N rows →" button
- **importing**: frozen preview + "Importing…" disabled button
- **results**: created / updated / skipped counts + scrollable error list; "Import Another" + "View Purchases"

### Template
- Row 1: Mandatory / Optional / Calculated labels
- Row 2: Column headers (matching exactly: `Receipt Date, Master Product, Variant, Qty., HSN Code, GST Rate Slab, Tax Paid (Y/N), Rate Per Unit (without Taxes), Vendor Name, Invoice Number (Optional), Warehouse`)
- Row 3: Example data row
- Bottom reference block: `# Existing products: Video Making Kit, Touch Lamp, ...`

Note: Calculated columns (GST/unit, Unit Price incl., Total GST, Total Amount) are **excluded from the import template** — they are not needed for import and are shown in UI only.

### Import logic (server-side, `catalog-import-server` pattern)
1. Parse CSV, validate mandatory fields per row
2. Match `Master Product + Variant` → `master_skus` lookup (case-insensitive)
3. If not found → insert new `master_sku` (auto-add to catalog as Unmapped)
4. Map `GST Rate Slab` text → numeric (strip `%`)
5. Compute `total_cogs` = `(unit_purchase_price + 0 + 0) × qty` (packaging/other = 0 on import)
6. Insert `purchases` row
7. Return per-row results

---

## Files Changed

| File | Change |
|------|--------|
| `src/app/(dashboard)/purchases/page.tsx` | Full rewrite |
| `src/app/api/purchases/route.ts` | Rename unit_cost → unit_purchase_price, add new fields |
| `src/app/api/purchases/import-csv/route.ts` | New |
| `src/app/api/purchases/csv-template/route.ts` | New |
| `src/lib/importers/purchases-import-server.ts` | New (server-side importer) |
| `src/components/purchases/PurchasesImportDialog.tsx` | New |
| `src/types/database.ts` | Update Purchase interface |
