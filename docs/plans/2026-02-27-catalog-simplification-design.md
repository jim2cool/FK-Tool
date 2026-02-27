# Catalog Simplification — Design Document

**Date:** 2026-02-27
**Status:** Approved
**Branch:** feat/phase-4-imports

---

## 1. Goal

The catalog connects **Master Products to SKU IDs across platforms and accounts**. Nothing more.

Warehouse data flows in read-only from Procurement. The catalog does not own stock.

---

## 2. What Changes

| Area | Before | After |
|---|---|---|
| CSV format | Dynamic per-account columns + 4-step mapping dialog | 5 fixed columns, no mapping step |
| Import UX | idle → mapping → importing → results | drag/drop → preview → import |
| Column mapping | Fuzzy synonym matching, dropdowns per field | Deleted entirely |
| Variant model (UI) | parent row + expandable children | Flat rows, one row per SKU ID |
| Search | SKU name | SKU ID substring |
| Filters | Warehouse, Channel, Account | Master Product, Channel, Account, Warehouse |
| Pagination | None | 50 rows/page |
| Inline edit | Name only | Master Product name, Channel, Account, SKU ID |

---

## 3. CSV Format

### 3.1 Columns (fixed, strict order)

```
Master Product/SKU | Variant Name | Channel | Account | SKU ID
```

| Column | Required | Rules |
|---|---|---|
| Master Product/SKU | Yes | Internal product name. Upserted by exact name. |
| Variant Name | No | If filled → row is a variant. Same Master + different Variants = siblings under one parent. If blank → Master Product IS the sellable unit. |
| Channel | Yes | Validated against `marketplace_accounts.platform`. Case-insensitive. Extensible — new channels work automatically once added in Settings. |
| Account | Yes | Validated against `marketplace_accounts.account_name`. Must match exactly. |
| SKU ID | Yes | Platform-specific listing ID. |

### 3.2 Sample

```csv
Master Product/SKU,Variant Name,Channel,Account,SKU ID
9 in 1 Electric Brush,,flipkart,Buzznest Main,FK9823411
9 in 1 Electric Brush,,amazon,Buzznest AMZ,B0CXYZ123
Portable Vacuum Cleaner,White,flipkart,Buzznest Main,FK1122334
Portable Vacuum Cleaner,Black,flipkart,Buzznest Main,FK1122335
Romper,,flipkart,Buzznest Main,FK9988001
Romper,,amazon,Buzznest AMZ,B0ROMPER1
```

### 3.3 Validation Rules

- Blank Master Product/SKU → skip row, report error
- Blank Channel or Account → skip row, report error
- Blank SKU ID → skip row, report error
- Unknown (Channel + Account) pair → skip row, report error: *"'amazon / Unknown Acct' not found in Settings"*
- Comment rows starting with `#` → silently skipped
- Blank rows → silently skipped

Errors never block valid rows. Valid rows always import.

### 3.4 Upsert Semantics

**Upsert key:** `(platform + marketplace_account_id + platform_sku)`

- If that triple already exists → update `master_sku_id` (re-maps SKU to new master product)
- If not → create new `sku_mappings` row

**Master products:** upserted by name (flat) or by (parent name + variant name) combination. Never duplicated.

---

## 4. Import Dialog UX

Single-screen, no step progression.

```
┌─────────────────────────────────────────────────┐
│  Bulk Import SKU Mappings                    [×] │
├─────────────────────────────────────────────────┤
│  [↓ Download Template]                          │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │   Drag & drop your CSV here             │    │
│  │   or click to browse                    │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  (After upload — preview table)                 │
│  Row  Master Product    Variant  Channel  ...   │
│  ✓    9in1 Brush        —        FK       ...   │
│  ✗    Vacuum            White    shopify  ...   │
│       └ "shopify / Buzznest Main" not in Settings│
│                                                 │
│  14 rows · 13 valid · 1 error                   │
│                       [Cancel]  [Import 13 →]   │
│                                                 │
│  (After import — results replace preview)       │
│  ✓ 8 created  ↻ 4 updated  ✗ 1 skipped         │
│  Skipped: row 9 — unknown account               │
│                          [Close] [View Catalog] │
└─────────────────────────────────────────────────┘
```

Key behaviours:
- File parsed immediately on drop, no intermediate step
- Bad rows shown inline in red with specific reason
- Import button disabled only if file hasn't been uploaded yet
- "Import N →" count shows how many valid rows will be processed
- Post-import: results replace preview in-place, dialog stays open
- "Download Template" generates CSV with header + one `#` example row, columns reflect current configured accounts

---

## 5. Catalog Table

### 5.1 Columns

| Column | Source | Editable |
|---|---|---|
| Master Product/SKU | `master_skus.name` + variant subtext | Yes (pencil icon) |
| Channel | `sku_mappings.platform` | Yes |
| Account | `marketplace_accounts.account_name` | Yes |
| SKU ID | `sku_mappings.platform_sku` | Yes |
| Warehouse | Aggregated from `purchases` | No (read-only) |

One row per SKU ID. A master product with 3 platform listings = 3 rows.

For variants: Master Product/SKU cell shows parent name + variant name as subtext (same as current design).

### 5.2 Search

**Search by SKU ID only** — substring match across `sku_mappings.platform_sku`.

### 5.3 Filters

| Filter | Source | Behaviour |
|---|---|---|
| Master Product | Dropdown of distinct master product names | Exact match |
| Channel | Dropdown of configured platforms | Exact match |
| Account | Dropdown of configured accounts | Exact match |
| Warehouse | Dropdown of configured warehouses | Shows rows where that warehouse has stock in Procurement |

All filters are combinable. "Clear filters" button appears when any filter is active.

### 5.4 Pagination

50 rows per page. Prev / Next controls at table bottom. Total row count displayed ("Showing 1–50 of 234").

### 5.5 Banners

**Unmapped stock (red alert):**
```
⚠ N SKUs are in stock at a warehouse but not mapped to any channel — this inventory can't be sold.
[Show these SKUs ↓]
```
Triggered when `master_skus` rows have `warehouse_summaries.length > 0` but `sku_mappings.length === 0`.

### 5.6 Inline Editing

Pencil icon on every row → edit dialog with all 4 editable fields. Save calls PATCH. Cancel reverts.

### 5.7 Auto-populate from Procurement

The catalog GET endpoint returns ALL non-archived master products, even those with no sku_mappings. So any master product that enters via Procurement immediately appears in the catalog with Warehouse populated and Channels showing the "Unmapped" badge. The banner fires automatically.

---

## 6. Data Model

No new tables. Changes are in application logic only.

### 6.1 `master_skus` (unchanged schema)

```
id, tenant_id, name, parent_id (nullable), variant_attributes (jsonb),
is_archived, created_at
```

- Flat SKU: `parent_id = null`
- Variant: `parent_id = <parent uuid>`
- Parent product: `parent_id = null`, has children

### 6.2 `sku_mappings` (unchanged schema)

```
id, tenant_id, master_sku_id, platform, platform_sku, marketplace_account_id
```

Unique constraint: `(tenant_id, platform, platform_sku)` — one platform SKU maps to exactly one master product.

### 6.3 `marketplace_accounts` (unchanged)

Channel + Account validation source. Adding a new account in Settings automatically makes it available in CSV imports.

---

## 7. Files Affected

### Deleted / replaced
- `src/components/catalog/CsvImportDialog.tsx` — full rewrite (remove mapping step)
- `src/lib/importers/sku-mapping-importer.ts` — full rewrite (fixed columns, no CsvColumnMapping)
- `src/app/api/catalog/import-csv/route.ts` — simplify (no mapping param)
- `src/app/api/catalog/csv-template/route.ts` — simplify template generation

### Modified
- `src/app/(dashboard)/catalog/page.tsx` — search by SKU ID, 4 filters, pagination, inline edit all fields

### Kept unchanged
- `src/app/api/catalog/master-skus/route.ts` — GET/POST/PATCH/DELETE all stay
- `src/app/api/catalog/sku-mappings/route.ts`
- All other pages (Purchases, Imports, Settings, Dashboard)

---

## 8. Out of Scope

- Procurement page changes (separate phase)
- Real-time auto-refresh when procurement data changes (polling or websocket)
- Bulk delete / archive from catalog
- Export catalog to CSV
