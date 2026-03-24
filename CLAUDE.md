# FK-Tool — Claude Context

> This file is read automatically at the start of every Claude Code session.
> **Start every session by reading `docs/project-brain/ACTIVE.md`** — it has current focus, last session summary, and what's next.
> For all remaining work, check `docs/project-brain/BUILD-TRACKER.md`.

---

## 🏗️ Product Standards (apply to EVERY feature)

These are non-negotiable standards. Every new feature or module must include all of the following:

1. **Getting Started Checklist** — if the feature requires initial configuration, add its step(s) to the dashboard onboarding checklist (`src/app/(dashboard)/dashboard/page.tsx` + checklist API)
2. **Info icons** — every non-obvious field, metric, or calculation gets an `<InfoTooltip content="..." />` (see `src/components/ui/info-tooltip.tsx`)
3. **Page subtitle** — one-line description under the page heading explaining what the page does and what upstream data it depends on
4. **Empty state** — when a page has no data, show a helpful message explaining what to do first (not just a blank table)
5. **Data-missing banners** — if the page depends on upstream data that doesn't exist yet, show a subtle info banner pointing the user to where they need to go first

Design doc: `docs/plans/2026-03-06-user-roles-onboarding-info-design.md`

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
- **PDF processing:** pdfjs-dist (text extraction) + pdf-lib (cropping/generation) — browser-side
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
| Purchases duplicate-check API | `src/app/api/purchases/check-duplicates/route.ts` |
| Purchases import dialog (with dedup UI) | `src/components/purchases/PurchasesImportDialog.tsx` |
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
| Labels page (2-tab: Sort + Crop Profiles) | `src/app/(dashboard)/labels/page.tsx` |
| Label crop selector component | `src/components/labels/LabelCropSelector.tsx` |
| Label upload zone component | `src/components/labels/LabelUploadZone.tsx` |
| Label preview table component | `src/components/labels/LabelPreviewTable.tsx` |
| Unmapped SKU panel component | `src/components/labels/UnmappedSkuPanel.tsx` |
| Label types | `src/lib/labels/types.ts` |
| Label PDF parser (pdf.js text extraction) | `src/lib/labels/pdf-parser.ts` |
| Label PDF cropper (pdf-lib crop + resize) | `src/lib/labels/pdf-cropper.ts` |
| Label SKU resolution API | `src/app/api/labels/resolve-skus/route.ts` |
| Label order ingestion API | `src/app/api/labels/ingest/route.ts` |
| PDF.js worker (local, not CDN) | `public/pdf.worker.min.mjs` |
| Vision & roadmap doc | `docs/superpowers/specs/2026-03-23-fktool-vision-and-roadmap.md` |

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
Dashboard → Master Catalog → Purchases → Invoices → Packaging → Labels → COGS → Import Data → Inventory & P&L → Settings
```

---

## ✅ COGS System — Complete

All 4 phases shipped. Full COGS system is implemented and deployed.

### Bugs fixed (previous session)
- **MasterSku field name gotcha:** `packaging/page.tsx` SKU Specs tab was using `sku.sku_code` / `sku.product_name` which don't exist on the type — actual field is `sku.name`. Always check the `MasterSku` type; only `id`, `name`, `sku_code` (wait — only `name` comes back from the API join).
- **Catalog API `total_cogs` remnant:** `master-skus/route.ts` still referenced the dropped `total_cogs` column in the warehouse aggregation query — removed it.

---

## ✅ Label Sorting — Complete (2026-03-24)

### What it does
Replaces Quick Labels tool. Staff uploads Flipkart label PDFs → system parses each page, matches platform SKU → master SKU via `sku_mappings`, groups labels by master product, crops to just the shipping label, outputs sorted PDFs (one per product) sized for label printers.

### Architecture
- **2-tab page:** Tab 1 "Sort Labels" (daily workflow), Tab 2 "Crop Profiles" (configuration)
- **Browser-side PDF processing:** pdf.js for text extraction, pdf-lib for cropping/embedding
- **User-guided cropping:** user draws rectangle on first page to define label area (no auto-detection)
- **Aspect-ratio locked:** crop box locks to selected label size ratio (e.g., 4x6 = 2:3)
- **Named crop profiles:** saved to localStorage, auto-applied on next upload
- **Order ingestion:** side effect of sorting — auto-creates `orders` + `dispatches` rows
- **Label sizes:** 4x6, 4x4, 3x5, 2x1 inches (extensible)

### Key gotchas
- **PDF.js worker must be local:** CDN URL (`cdnjs.cloudflare.com`) fails in Docker. Worker file is at `public/pdf.worker.min.mjs`, loaded as `/pdf.worker.min.mjs`. If pdfjs-dist is upgraded, re-copy the worker.
- **pdf.js dynamic import required:** `import('pdfjs-dist')` — static import crashes SSR due to missing `DOMMatrix`.
- **Coordinate system mismatch:** Canvas y=0 is top, pdf-lib y=0 is bottom. Crop box stores ratios (0-1) from canvas top-left. Conversion: `pdfY = pageHeight - (canvasY * pageHeight) - cropHeight`.
- **embedPages with boundingBox:** Use `outputDoc.embedPages([page], [{ left, bottom, right, top }])` for reliable cropping — NOT setCropBox/setMediaBox which loses context in multi-step flows.
- **Crop profiles in localStorage:** Key is `fk-label-crop-profiles`. Array of `{ name, labelSize, crop: { x, y, width, height } }`. Future: move to DB for multi-device support.
- **Unmapped SKUs not silent:** Shown in yellow UnmappedSkuPanel. Owner/manager can map inline. Staff sees "Contact manager."

### DB tables used
- `orders` — auto-created from label data (platform_order_id, master_sku_id, marketplace_account_id, sale_price, status='dispatched')
- `dispatches` — auto-created linked to orders (warehouse_id, dispatch_date, courier, awb_number)
- `sku_mappings` — resolves platform SKU → master SKU (case-insensitive lookup)
- `marketplace_accounts` + `organizations` — resolves GSTIN from label → org

### Still to do (next session)
- Edit profiles (re-open crop selector with saved crop pre-loaded)
- Invoice crop area (second crop per profile for A4 invoices — Amazon requires separate invoice printing)
- Custom label sizes (user-defined width x height)
- Move profiles to DB (currently localStorage only)

---

## ✅ Tenant Merge — Complete (2026-03-24)

Both user accounts (`shashwat@e4a.in` + `finance@e4a.in`) now share tenant "Nuvio" (`2d1f3411-2b1a-4674-a5ec-353bbd82ebb8`). The old "E4A Test" tenant was deleted (had no real data).

### Organizations (3 active)
| Org | Legal Name | GSTIN | Location |
|-----|-----------|-------|----------|
| E4A | E4A Partner Private Limited | 06AAICE3494R1ZV | GGN + BLR (two registrations) |
| ESS Collective | ESS Collective | 06AQVPM0300Q1ZH | Gurgaon |
| ESS Collectives | ESS Collectives | PLACEHOLDER | Bangalore |

### Marketplace Accounts (10)
| Account | Platform | Org | Location |
|---------|----------|-----|----------|
| NuvioCentral | Flipkart | E4A | Gurgaon |
| BodhNest | Flipkart | E4A | Bangalore |
| NuvioStore | Flipkart | ESS Collective | Gurgaon |
| NuvioShop | Flipkart | ESS Collectives | Bangalore |
| Gentle | D2C | E4A | Gurgaon |
| Livee | D2C | ESS Collectives | Bangalore |
| Nuvio | D2C | E4A | GGN + BLR |
| Devaara | D2C | E4A | GGN + BLR |
| Nuvio | Amazon | ESS Collectives | Bangalore |
| Devaara | Amazon | E4A | Gurgaon |

---

## ✅ Duplicate Detection — Complete (2026-03-23)

### Purchases CSV import dedup
- **New file:** `src/app/api/purchases/check-duplicates/route.ts`
- After CSV parse, dialog calls this endpoint with parsed rows
- Server resolves SKU/warehouse names → IDs, builds fingerprints, queries ALL purchases in DB (not just current page), flags DB matches AND within-file duplicate rows
- Returns `{ duplicateRowIndices: number[] }`
- Preview table shows duplicate rows in yellow with "Duplicate" badge; Import button shows "skip N duplicates"
- `import-csv/route.ts` accepts `skipRowIndices?: number[]`; `purchases-import-server.ts` skips those row indices
- **Duplicate key:** `master_sku_id + warehouse_id + purchase_date + quantity + unit_purchase_price + supplier`

### Catalog manual-add dedup
- `POST /api/catalog/master-skus` now checks for existing SKU with same `name + parent_id` before inserting
- Returns 409 with message like `"A product named 'X' already exists"` — surfaces as toast in UI
- CSV catalog import was already safe (used `maybeSingle()` lookups)

### Catalog warehouse aggregation fix
- **Root cause:** `aggregateSummaries()` in `master-skus/route.ts` only checked variant IDs when a parent had variants — purchases saved against the parent ID (legacy from old dropdown bug) were silently ignored
- **Fix:** Pass `[sku.id, ...variants.map(v => v.id)]` so parent-level purchases are included

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

The catalog page shows per-warehouse stock by aggregating across purchases. The aggregation now includes both the parent SKU ID and all variant IDs, so legacy purchases saved against the parent ID are also visible.

If warehouse still shows "—" it means purchases haven't been imported yet for that SKU.

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
