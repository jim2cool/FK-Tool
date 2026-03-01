# FK-Tool — Claude Context

> This file is read automatically at the start of every Claude Code session.
> Keep it updated as the project evolves.

---

## 🚀 Deployment

**Platform:** Self-hosted Docker on Hetzner VPS
**Server:** `root@46.225.117.86`
**SSH key:** `~/.ssh/id_ed25519`
**Project path on server:** `/opt/fk-tool`

### Deploy command (run from this machine):
```bash
ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=no root@46.225.117.86 "cd /opt/fk-tool && bash deploy.sh"
```

`deploy.sh` does: `git pull origin main` → `docker compose build --no-cache` → `docker compose up -d`

**Live site:** https://ecommerceforall.in

> ⚠️ User tests on the **live site**. Always push to `origin/main` AND run the deploy command above after every fix. Never assume Vercel/auto-deploy — this is manual Docker.

---

## 🏗️ Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript)
- **Database:** Supabase (PostgreSQL) — project `aorcopafrixqlbgckrpu`
- **Styling:** Tailwind CSS v4 + shadcn/ui (Radix UI)
- **CSV parsing:** Papa Parse (`papaparse`)
- **Auth:** Supabase Auth (email/password) + Next.js middleware proxy
- **Containerisation:** Docker + docker-compose, deployed to Hetzner

---

## 🗄️ Database — Critical Notes

### Multi-tenancy
Every table has a `tenant_id` column. Always filter by `tenant_id` in every query.
`getTenantId()` (from `@/lib/db/tenant`) reads it from `user_profiles` via the logged-in user.

### Generated / Computed columns — ALREADY DROPPED

> ✅ `total_cogs`, `packaging_cost`, `other_cost` were dropped from `purchases` in COGS Phase 1 (already migrated).
> **Do NOT reference these columns anywhere** — they no longer exist in the DB or codebase.

### master_skus — Parent/Variant structure
- Flat products: `parent_id IS NULL`
- Variant products: parent row has `parent_id IS NULL`, child rows have `parent_id = <parent.id>`
- The `/api/catalog/master-skus` endpoint returns a **nested** response: `{ ...parent, variants: [...] }`
- When you need a flat list of all SKUs (e.g. for dropdowns), use `flatMap`:
  ```ts
  skus.flatMap(sku => [sku, ...(sku.variants ?? [])])
  ```

### purchases table key columns
```
id, tenant_id, master_sku_id, warehouse_id,
quantity, unit_purchase_price,
supplier, purchase_date, received_date,
hsn_code, gst_rate_slab, tax_paid, invoice_number
```
> `packaging_cost`, `other_cost`, `total_cogs` were **dropped** in COGS Phase 1. Do not reference them.

### master_skus — COGS columns (added in COGS Phase 1)
```
shrinkage_rate  NUMERIC(5,4)  DEFAULT 0.02   -- per-SKU shrinkage (2% default)
delivery_rate   NUMERIC(5,4)  DEFAULT 1.0    -- historical delivered÷dispatched rate
```

---

## 📁 Key File Map

| Purpose | File |
|---------|------|
| Purchases page (UI) | `src/app/(dashboard)/purchases/page.tsx` |
| Purchases API | `src/app/api/purchases/route.ts` |
| Purchases CSV parser (client-safe) | `src/lib/importers/purchases-csv-parser.ts` |
| Purchases CSV importer (server) | `src/lib/importers/purchases-import-server.ts` |
| Catalog page (UI) | `src/app/(dashboard)/catalog/page.tsx` |
| Catalog master-SKUs API | `src/app/api/catalog/master-skus/route.ts` |
| Catalog CSV import API | `src/app/api/catalog/import-csv/route.ts` |
| Catalog CSV template | `src/app/api/catalog/csv-template/route.ts` |
| Tenant ID helper | `src/lib/db/tenant.ts` |
| Supabase server client | `src/lib/supabase/server.ts` |
| Supabase browser client | `src/lib/supabase/client.ts` |
| DB types | `src/types/database.ts` |
| App sidebar (nav) | `src/components/layout/AppSidebar.tsx` |
| COGS implementation plan | `docs/plans/2026-02-28-cogs-system.md` |
| Freight invoices API | `src/app/api/freight-invoices/route.ts` |
| Packaging materials API | `src/app/api/packaging/materials/route.ts` |
| Packaging SKU config API | `src/app/api/packaging/sku-config/route.ts` |
| Packaging purchases API | `src/app/api/packaging/purchases/route.ts` |
| Invoices page (Freight ✅ + Packaging Purchases ✅) | `src/app/(dashboard)/invoices/page.tsx` |
| Packaging page (Materials + SKU Specs ✅) | `src/app/(dashboard)/packaging/page.tsx` |
| COGS calculation engine ✅ | `src/lib/cogs/calculate.ts` |
| COGS list API ✅ | `src/app/api/cogs/route.ts` |
| COGS single-SKU API ✅ | `src/app/api/cogs/[skuId]/route.ts` |
| COGS page ✅ | `src/app/(dashboard)/cogs/page.tsx` |
| Popover UI component | `src/components/ui/popover.tsx` |

---

## 💰 COGS System — Architecture (In Progress)

See full plan: `docs/plans/2026-02-28-cogs-system.md`

**Formula (locked in):**
```
Purchase COGS/unit (WAC) = weighted avg Rate/Unit (ex-GST) across all lots
                         + allocated inward freight/unit
                           [freight × (sku_lot_value / total_lot_value) ÷ sku_qty]

Dispatch COGS/unit       = sum(material_cost × qty_per_dispatch) ÷ delivery_rate

Shrinkage/unit           = shrinkage_rate × Purchase COGS/unit  (default 2%)

Full COGS/unit           = Purchase COGS + Dispatch COGS + Shrinkage
```

**GST rule:** User is GST-registered. GST is EXCLUDED from COGS. "GST Not Charged" is tracked separately.

**Four phases:**
- Phase 1 ✅: Dropped `packaging_cost`/`other_cost`/`total_cogs` from purchases; added `shrinkage_rate`/`delivery_rate` to `master_skus`
- Phase 2 ✅: `freight_invoices` table + Invoices page (Freight tab + Packaging Purchases tab)
- Phase 3 ✅: `packaging_materials`, `sku_packaging_config`, `packaging_purchases` tables + Packaging page (Materials + SKU Specs tabs)
- Phase 4 ✅: COGS calculation engine + COGS list/single API + COGS page (complete)

**Tables created:**
```
freight_invoices        — inward freight per purchase invoice         ✅ created
packaging_materials     — catalog of packaging material types          ✅ created
sku_packaging_config    — which materials each SKU uses + qty          ✅ created
packaging_purchases     — bulk purchases of packaging materials        ✅ created
```

**New nav order (final target):**
```
Dashboard → Master Catalog → Purchases → Invoices → Packaging → COGS → Import Data → Inventory & P&L → Settings
```

---

## ✅ COGS System — Complete

All 4 phases shipped. Full COGS system is implemented. Remaining action:

- **Task 13:** `npx tsc --noEmit` → merge worktree to `main` → `git push origin main` → deploy to Hetzner → smoke test

### Bugs fixed this session
- **MasterSku field name gotcha:** `packaging/page.tsx` SKU Specs tab was using `sku.sku_code` / `sku.product_name` which don't exist on the type — actual field is `sku.name`. Always check the `MasterSku` type; only `id`, `name`, `sku_code` (wait — only `name` comes back from the API join).
- **Catalog API `total_cogs` remnant:** `master-skus/route.ts` still referenced the dropped `total_cogs` column in the warehouse aggregation query — removed it.

---

## 📋 Purchases CSV Import — Known Quirks

1. **Labels row:** The downloadable template has a first row like `"Mandatory,Mandatory,Optional,..."`. Papa Parse with `header:true` would consume this as column keys breaking all lookups. `stripLabelsRow()` in `purchases-csv-parser.ts` strips it before parsing.

2. **Date formats:** The template produces `M/DD/YYYY` (e.g. `6/27/2025`) but Indian users may enter `DD/MM/YYYY`. The parser auto-detects: if `parts[1] > 12` → first part is month (M/DD/YYYY); otherwise assume `DD/MM/YYYY`.

3. **Warehouse column:** The **catalog** CSV template intentionally has no Warehouse column — warehouse data lives in purchases, not catalog mappings.

4. **Variant dropdown bug (fixed):** `/api/catalog/master-skus` returns a **nested** response. The purchases page must flatMap variants:
   ```ts
   skus.flatMap(sku => [sku, ...(sku.variants ?? [])])
   ```
   Without this, the variant dropdown is empty → purchases save against parent ID → catalog never shows warehouse data.

---

## 🔄 Catalog Page — Warehouse Display

The catalog page shows per-warehouse stock and COGS by aggregating across purchases. For a product to show warehouse info:
1. Purchases must exist for that SKU in the `purchases` table
2. The `master_sku_id` on the purchase must match the exact variant (not parent) SKU id

If warehouse shows "—" it usually means purchases haven't been imported yet, or the wrong SKU ID was used (e.g. parent ID instead of variant ID).

---

## 🌐 Hetzner Object Storage (used for images)

```
HETZNER_S3_ENDPOINT=https://fsn1.your-objectstorage.com
HETZNER_S3_BUCKET=product-image
HETZNER_PUBLIC_BASE_URL=https://product-image.fsn1.your-objectstorage.com
```
Credentials are in `.env.production` on the server (do not commit them).

---

## 🔑 Auth Flow

- Supabase Auth (email + password)
- Next.js middleware (`src/middleware.ts`) redirects unauthenticated users to `/login`
- After login, `user_profiles` table maps `auth.users.id` → `tenant_id`

---

## ⚙️ Common Commands

```bash
# Local dev
npm run dev

# Type-check only
npx tsc --noEmit

# Deploy to live server
ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=no root@46.225.117.86 "cd /opt/fk-tool && bash deploy.sh"

# Tail live container logs
ssh -i ~/.ssh/id_ed25519 root@46.225.117.86 "docker compose -f /opt/fk-tool/docker-compose.yml logs -f fk-tool"
```
