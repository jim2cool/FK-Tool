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

### Generated / Computed columns — NEVER insert these
| Column | Table | Definition |
|--------|-------|------------|
| `total_cogs` | `purchases` | `GENERATED ALWAYS AS (unit_purchase_price + packaging_cost + other_cost)` |

Attempting to INSERT or UPDATE these columns will throw:
`"cannot insert a non-DEFAULT value into column total_cogs"`

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
quantity, unit_purchase_price, packaging_cost, other_cost,
total_cogs (GENERATED), supplier, purchase_date, received_date,
hsn_code, gst_rate_slab, tax_paid, invoice_number
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

---

## 📋 Purchases CSV Import — Known Quirks

1. **Labels row:** The downloadable template has a first row like `"Mandatory,Mandatory,Optional,..."`. Papa Parse with `header:true` would consume this as column keys breaking all lookups. `stripLabelsRow()` in `purchases-csv-parser.ts` strips it before parsing.

2. **Date formats:** The template produces `M/DD/YYYY` (e.g. `6/27/2025`) but Indian users may enter `DD/MM/YYYY`. The parser auto-detects: if `parts[1] > 12` → first part is month (M/DD/YYYY); otherwise assume `DD/MM/YYYY`.

3. **Warehouse column:** The **catalog** CSV template intentionally has no Warehouse column — warehouse data lives in purchases, not catalog mappings.

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
