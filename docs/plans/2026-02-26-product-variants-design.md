# Product Variants — Design Document

**Date:** 2026-02-26
**Status:** Approved
**Scope:** Add optional parent → variant hierarchy to the Master Catalog

---

## Problem

The current `master_skus` table is flat — every SKU is an atomic, unrelated product. Real products have variants (Size × Color, Pack Size, Weight, etc.). Without a hierarchy:

- No way to see total stock across all variants of the same product
- Reports can't aggregate at the parent-product level
- Users must manually maintain naming conventions to imply grouping

---

## Decision

**Option A — self-referential `master_skus`** (chosen for zero migration impact).

Add two nullable columns to the existing `master_skus` table. All existing foreign keys (`sku_mappings`, `purchases`, `dispatches`, `orders`, `returns`) are unchanged. Variants are opt-in — existing flat SKUs are unaffected.

---

## Database Schema

```sql
ALTER TABLE master_skus
  ADD COLUMN parent_id UUID REFERENCES master_skus(id) ON DELETE CASCADE,
  ADD COLUMN variant_attributes JSONB;

CREATE INDEX idx_master_skus_parent_id ON master_skus(parent_id)
  WHERE parent_id IS NOT NULL;
```

### Row semantics

| Row type | `parent_id` | `variant_attributes` | Holds mappings/stock? |
|---|---|---|---|
| Flat standalone SKU (existing) | NULL | NULL | Yes |
| Parent product | NULL | NULL | No (app-enforced) |
| Variant | `<parent_id>` | `{"size":"L","color":"White"}` | Yes |

**Constraints (app-enforced):**
- A row with `parent_id` set cannot itself be a `parent_id` target (no grandvariants)
- Platform mappings and purchases must reference a flat SKU or variant, never a parent
- `variant_attributes` is free-form JSONB — no fixed keys, any attribute names allowed

---

## API Changes

### `GET /api/catalog/master-skus`

Returns only top-level rows (`parent_id IS NULL`). Each row includes a `variants` array:

```json
{
  "id": "...",
  "name": "Premium Cotton T-Shirt",
  "parent_id": null,
  "variant_attributes": null,
  "variants": [
    {
      "id": "...",
      "name": "Premium Cotton T-Shirt - White - L",
      "parent_id": "<parent_id>",
      "variant_attributes": { "size": "L", "color": "White" },
      "sku_mappings": [...],
      "warehouse_summaries": [...]
    }
  ],
  "warehouse_summaries": [...]   // aggregated SUM across all variants
}
```

Flat standalone SKUs return `variants: []` and their own `sku_mappings` / `warehouse_summaries`.

### `POST /api/catalog/master-skus`

Gains optional fields: `parent_id`, `variant_attributes`.
- If `parent_id` provided: validates parent exists, has no `parent_id` itself, belongs to same tenant
- Returns the created row

### `PATCH /api/catalog/master-skus`

Gains `variant_attributes` as an updatable field.

### No changes

`sku_mappings`, `purchases`, `dispatches`, `orders`, `returns` — all continue referencing `master_sku_id` unchanged.

---

## Catalog UI

### Table layout (grouped / expandable)

**Parent product row:**
```
▶  Premium Cotton T-Shirt        3 variants     —     —     —    Delhi WH    150 units
```
- Chevron opens/closes the variant list
- Qty column shows sum across all variants
- Platform columns empty (mappings live on variants)
- Actions: Edit (name/desc), + Add Variant

**Expanded variant rows (indented):**
```
   └  ...White - L    Size·L  Color·White   FK123   B001   —   Delhi WH   50 units   [Edit] [Map]
   └  ...White - M    Size·M  Color·White   FK456   —      —   Delhi WH   60 units   [Edit] [Map]
   └  ...Red - L      Size·L  Color·Red     FK789   B002   —   Delhi WH   40 units   [Edit] [Map]
```
- Attribute badges rendered from `variant_attributes` keys
- Full platform mapping and warehouse qty per variant
- Actions: Edit (name/attributes), Map platform SKUs, Delete variant

**Flat standalone SKU row:** identical to current behaviour, no changes.

### "Add Master SKU" dialog

Gets a toggle: **"This product has variants"**
- Off (default): current flat SKU form — name + description
- On: parent product form — name + description only (no mapping, variants added separately)

### "Add Variant" dialog (new)

Triggered from expanded parent row's "+ Add Variant" button:
- Variant name (text input)
- Attribute key-value pairs (dynamic: + Add Attribute button, up to 5)
- Then opens the existing SkuMappingDialog for platform mappings

---

## CSV Import Changes

### New optional mapping fields in `CsvImportDialog`

The mapping table gains two new sections:

**1. Parent SKU Name field (optional)**
If mapped and a row has a value in this column → that row is imported as a variant:
- Parent is upserted by name
- `master_sku_name` column value becomes the variant name
- Variant is linked to the parent via `parent_id`

**2. Variant Attributes section (optional, shown only when Parent SKU Name is mapped)**
Up to 3 attribute mappings, each row = `(CSV column) → (attribute key name)`:

| CSV Column | Attribute Key |
|---|---|
| Size       | size          |
| Colour     | color         |

These are merged into `variant_attributes` JSONB on each row.

### Importer logic changes (`sku-mapping-importer.ts`)

```
if row has parent_sku_name:
  upsert parent by name (tenant-scoped)
  upsert variant with parent_id = parent.id, variant_attributes = merged attrs
  attach platform mappings to variant
else:
  existing flat SKU logic unchanged
```

### `CsvColumnMapping` interface additions

```typescript
parent_sku_name: string | null
variant_attr_columns: Array<{ csv_col: string; attr_key: string }>  // up to 3
```

---

## Out of Scope

- Merging existing flat SKUs into parent → variant groups (manual user action, future)
- Deleting a parent with variants (cascade delete variants — handled by `ON DELETE CASCADE`)
- Variant images or rich media
- More than 2 hierarchy levels (no grandvariants by design)
- Fuzzy SKU name matching during import (separate backlog item)
