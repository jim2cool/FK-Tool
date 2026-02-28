# COGS System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete COGS-per-delivered-unit system covering goods purchase cost, inward freight allocation, dispatch packaging cost, and shrinkage — displayed as a full breakdown on a new COGS page with per-SKU overrides.

**Architecture:** Four phases — (1) clean up the purchases table, (2) freight invoice mini-system, (3) packaging mini-system, (4) COGS calculation engine + page. All COGS values are computed dynamically (not stored) using Weighted Average Cost across all purchase lots. Freight is allocated across SKUs in the same invoice by value. Dispatch packaging cost is divided by per-SKU delivery rate.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (PostgreSQL), Tailwind v4, shadcn/Radix UI. Supabase project: `aorcopafrixqlbgckrpu`. No test framework configured — verify by loading page and checking numbers manually.

**COGS Formula (locked in):**
```
Purchase COGS/unit (WAC) = weighted avg of Rate/Unit(ex) across all lots
                         + allocated inward freight/unit
                           [freight × (sku_lot_value / total_lot_value) ÷ sku_qty]

Dispatch COGS/unit       = sum(material_cost × qty_per_dispatch) ÷ delivery_rate

Shrinkage/unit           = shrinkage_rate × Purchase COGS/unit  [default 2%]

Full COGS/unit           = Purchase COGS + Dispatch COGS + Shrinkage
```

**GST rule:** User is GST-registered. GST excluded from COGS. "GST Not Charged" tracked separately for future tax liability section.

---

## Phase 1 — Clean Up Purchases Table

### Task 1: DB migration — remove packaging_cost, other_cost, total_cogs; add shrinkage_rate + delivery_rate

**Files:**
- DB migration via Supabase MCP

`total_cogs` is `GENERATED ALWAYS AS (unit_purchase_price + packaging_cost + other_cost)` — must drop it BEFORE dropping its source columns.

**Step 1: Run migration**

```sql
-- Drop generated column first (depends on the other two)
ALTER TABLE purchases DROP COLUMN IF EXISTS total_cogs;

-- Drop vendor cost fields (vendors don't charge packaging/other)
ALTER TABLE purchases DROP COLUMN IF EXISTS packaging_cost;
ALTER TABLE purchases DROP COLUMN IF EXISTS other_cost;

-- Add shrinkage + delivery rate to master_skus
ALTER TABLE master_skus
  ADD COLUMN IF NOT EXISTS shrinkage_rate NUMERIC(5,4) NOT NULL DEFAULT 0.02,
  ADD COLUMN IF NOT EXISTS delivery_rate  NUMERIC(5,4) NOT NULL DEFAULT 1.0;
```

**Step 2: Verify in Supabase — confirm columns gone from purchases, new columns on master_skus**

---

### Task 2: Update TypeScript types

**Files:**
- Modify: `src/types/database.ts`

Remove `packaging_cost`, `other_cost`, `total_cogs` from `Purchase` interface.
Add `shrinkage_rate` and `delivery_rate` to `MasterSku` interface:

```typescript
// In Purchase interface — REMOVE these three lines:
// packaging_cost: number
// other_cost: number
// total_cogs: number | null

// In MasterSku interface — ADD:
shrinkage_rate: number   // default 0.02
delivery_rate: number    // default 1.0
```

**Step 3: Type-check**
```bash
npx tsc --noEmit
```
Expected: 0 errors (or only errors from pages that reference the removed fields — fix those next).

---

### Task 3: Remove packaging_cost / other_cost from purchases page + API

**Files:**
- Modify: `src/app/(dashboard)/purchases/page.tsx`
- Modify: `src/app/api/purchases/route.ts`

**In `page.tsx`:**
- Remove `packaging_cost` and `other_cost` from `emptyForm`
- Remove their `<Input>` fields from the Add/Edit dialog (the "Packaging + Other" section)
- Remove them from `handleSave` payload
- Remove the `Purchase` interface's `packaging_cost`, `other_cost`, `total_cogs` fields (local interface at top of file)

**In `route.ts` (POST + PATCH handlers):**
- Remove `packaging_cost` and `other_cost` from the insert/update objects

**Step 4: Type-check again**
```bash
npx tsc --noEmit
```
Expected: 0 errors.

**Step 5: Commit**
```bash
git add src/types/database.ts src/app/(dashboard)/purchases/page.tsx src/app/api/purchases/route.ts
git commit -m "chore(purchases): remove packaging_cost/other_cost/total_cogs — COGS now computed dynamically"
```

---

## Phase 2 — Freight Invoice Mini-System

### Task 4: DB migration — freight_invoices table

**Files:**
- DB migration via Supabase MCP

```sql
CREATE TABLE freight_invoices (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  freight_invoice_number  TEXT,                        -- self-generated ref for kaccha bills
  purchase_invoice_number TEXT NOT NULL,               -- links to purchases.invoice_number
  total_amount            NUMERIC(12,2) NOT NULL,
  tax_paid                BOOLEAN NOT NULL DEFAULT FALSE,
  gst_rate_slab           TEXT NOT NULL DEFAULT '18%',
  vendor                  TEXT,                        -- courier company name
  freight_date            DATE NOT NULL,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE freight_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON freight_invoices
  USING (tenant_id = (
    SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
  ));
```

**Step 1: Verify table created in Supabase**

---

### Task 5: Add FreightInvoice type + API route

**Files:**
- Modify: `src/types/database.ts`
- Create: `src/app/api/freight-invoices/route.ts`

**In `database.ts` — add:**
```typescript
export interface FreightInvoice {
  id: string
  tenant_id: string
  freight_invoice_number: string | null
  purchase_invoice_number: string
  total_amount: number
  tax_paid: boolean
  gst_rate_slab: string
  vendor: string | null
  freight_date: string
  notes: string | null
  created_at: string
}
```

**`src/app/api/freight-invoices/route.ts`:**
```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'

export async function GET() {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const { data, error } = await supabase
    .from('freight_invoices')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('freight_date', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const body = await req.json()
  const { data, error } = await supabase
    .from('freight_invoices')
    .insert({ ...body, tenant_id: tenantId })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const { id, ...updates } = await req.json()
  const { data, error } = await supabase
    .from('freight_invoices')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: Request) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const { id } = await req.json()
  const { error } = await supabase
    .from('freight_invoices')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

**Step 2: Type-check**
```bash
npx tsc --noEmit
```

**Step 3: Commit**
```bash
git add src/types/database.ts src/app/api/freight-invoices/route.ts
git commit -m "feat(freight): add freight_invoices table + CRUD API"
```

---

### Task 6: Invoices page — Freight tab UI

**Files:**
- Create: `src/app/(dashboard)/invoices/page.tsx`
- Modify: `src/components/layout/AppSidebar.tsx`

**In `AppSidebar.tsx`** — add nav item after Purchases:
```typescript
import { Receipt } from 'lucide-react'  // add to imports
// In navItems array, after purchases:
{ href: '/invoices', label: 'Invoices', icon: Receipt },
```

**`src/app/(dashboard)/invoices/page.tsx`** — Freight invoices tab (full page):

The page has two tabs: "Freight" (built now) and "Packaging Materials" (built in Phase 3).

Freight tab features:
- Table: Date | Freight Invoice # | Purchase Invoice # | Vendor | Amount | GST Rate | Tax Paid | GST Amount | Actions
- "Add Freight Invoice" button opens a dialog
- Add/Edit dialog fields:
  - `purchase_invoice_number` — text input with note: "Match exactly to the Invoice # on your purchase records"
  - `freight_invoice_number` — text input, placeholder: "e.g. KB-20260128-001 (self-generate for kaccha bills)"
  - `vendor` — text (courier company)
  - `freight_date` — date
  - `total_amount` — number
  - `tax_paid` — select (Y/N), default N
  - `gst_rate_slab` — select (0%, 5%, 12%, 18%, 28%), default 18%
  - `notes` — textarea optional
- Computed display: GST amount = `tax_paid ? total_amount * rate / (100 + rate) : total_amount * rate / 100`
  - If Tax Paid: GST is embedded in total (reverse calc)
  - If Kaccha: show as notional GST not charged
- Footer total: sum of all freight amounts + total GST not charged

**Step 4: Type-check + manual verify**
```bash
npx tsc --noEmit
```
Load `/invoices` — confirm freight tab shows, add a test freight invoice, verify it saves and appears.

**Step 5: Commit**
```bash
git add src/app/(dashboard)/invoices/page.tsx src/components/layout/AppSidebar.tsx
git commit -m "feat(invoices): add Invoices page with Freight tab — track inward freight invoices"
```

---

## Phase 3 — Packaging Mini-System

### Task 7: DB migration — packaging tables

**Files:**
- DB migration via Supabase MCP

```sql
-- Catalog of packaging material types
CREATE TABLE packaging_materials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,           -- e.g. "Polybag M", "Secondary Box S"
  unit        TEXT NOT NULL DEFAULT 'piece',
  unit_cost   NUMERIC(10,4) NOT NULL,  -- current cost per unit
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Which packaging materials does each SKU use per dispatch
CREATE TABLE sku_packaging_config (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  master_sku_id          UUID NOT NULL REFERENCES master_skus(id) ON DELETE CASCADE,
  packaging_material_id  UUID NOT NULL REFERENCES packaging_materials(id) ON DELETE CASCADE,
  qty_per_dispatch       NUMERIC(10,4) NOT NULL DEFAULT 1,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, master_sku_id, packaging_material_id)
);

-- Bulk purchases of packaging materials
CREATE TABLE packaging_purchases (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  packaging_material_id  UUID NOT NULL REFERENCES packaging_materials(id) ON DELETE CASCADE,
  invoice_number         TEXT,
  quantity               NUMERIC(12,4) NOT NULL,
  unit_cost              NUMERIC(10,4) NOT NULL,
  tax_paid               BOOLEAN NOT NULL DEFAULT FALSE,
  gst_rate_slab          TEXT NOT NULL DEFAULT '12%',
  vendor                 TEXT,
  purchase_date          DATE NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for all three
ALTER TABLE packaging_materials  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sku_packaging_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE packaging_purchases  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON packaging_materials
  USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "tenant_isolation" ON sku_packaging_config
  USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "tenant_isolation" ON packaging_purchases
  USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
```

**Step 1: Verify all three tables created in Supabase**

---

### Task 8: Packaging types + API routes

**Files:**
- Modify: `src/types/database.ts`
- Create: `src/app/api/packaging/materials/route.ts`
- Create: `src/app/api/packaging/sku-config/route.ts`
- Create: `src/app/api/packaging/purchases/route.ts`

**Add to `database.ts`:**
```typescript
export interface PackagingMaterial {
  id: string
  tenant_id: string
  name: string
  unit: string
  unit_cost: number
  created_at: string
  updated_at: string
}

export interface SkuPackagingConfig {
  id: string
  tenant_id: string
  master_sku_id: string
  packaging_material_id: string
  qty_per_dispatch: number
  created_at: string
}

export interface PackagingPurchase {
  id: string
  tenant_id: string
  packaging_material_id: string
  invoice_number: string | null
  quantity: number
  unit_cost: number
  tax_paid: boolean
  gst_rate_slab: string
  vendor: string | null
  purchase_date: string
  created_at: string
}
```

Each API route follows the same CRUD pattern as `freight-invoices/route.ts` above.

`materials/route.ts` — GET all, POST new, PATCH by id, DELETE by id.
`sku-config/route.ts` — GET all (with `?sku_id=` filter supported), POST, DELETE.
`purchases/route.ts` — GET all, POST, PATCH, DELETE.

**Step 2: Type-check**
```bash
npx tsc --noEmit
```

**Step 3: Commit**
```bash
git add src/types/database.ts src/app/api/packaging/
git commit -m "feat(packaging): add packaging tables + CRUD APIs for materials, sku-config, purchases"
```

---

### Task 9: Packaging UI — Materials catalog + SKU specs (Settings page)

**Files:**
- Create: `src/app/(dashboard)/packaging/page.tsx`
- Modify: `src/components/layout/AppSidebar.tsx`

Add to sidebar after Invoices:
```typescript
import { Box } from 'lucide-react'
{ href: '/packaging', label: 'Packaging', icon: Box },
```

**`/packaging` page — two tabs:**

**Tab 1: Materials**
- Table: Name | Unit | Cost/Unit | Actions (edit, delete)
- "Add Material" dialog: name, unit (piece/meter/roll), unit_cost
- Editing unit_cost updates the material's current cost (affects future COGS calc)

**Tab 2: SKU Specs**
- For each parent SKU (or variant): show which packaging materials it uses
- "Configure" button opens dialog: pick materials from catalog + qty_per_dispatch each
- Also shows delivery_rate field (editable per SKU — this feeds dispatch COGS calc)
  - Note below field: "Historical delivery rate (delivered ÷ dispatched). E.g. 0.85 = 85% delivered"

**Tab 3 (on Invoices page): Packaging Material Purchases**
- Add "Packaging" tab to the existing `/invoices` page
- Table: Date | Invoice # | Material | Qty | Unit Cost | Total | Vendor | Tax Paid | Actions
- "Add Purchase" dialog: material (dropdown), qty, unit_cost, invoice_number, vendor, date, tax_paid, gst_rate_slab
- Note: When a packaging purchase is saved, automatically update the material's `unit_cost` with the new purchase price (WAC would be ideal, but for MVP just use latest purchase price)

**Step 4: Type-check + manual verify**
Load `/packaging` — add a material (e.g. "Polybag M", ₹3/piece), configure it against a SKU, verify saved.

**Step 5: Commit**
```bash
git add src/app/(dashboard)/packaging/page.tsx src/components/layout/AppSidebar.tsx
git commit -m "feat(packaging): add Packaging page — materials catalog + SKU specs + delivery rate"
```

---

## Phase 4 — COGS Calculation Engine + Page

### Task 10: COGS calculation library (server-side)

**Files:**
- Create: `src/lib/cogs/calculate.ts`

This is the core engine. It takes a `master_sku_id` and computes full COGS breakdown.

```typescript
// src/lib/cogs/calculate.ts

import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'

export interface CogsBreakdown {
  sku_id: string
  sku_name: string

  // Purchase COGS (WAC)
  wac_base_per_unit: number          // weighted avg Rate/Unit(ex)
  wac_freight_per_unit: number       // allocated freight per unit
  purchase_cogs_per_unit: number     // wac_base + wac_freight

  // Dispatch COGS
  packaging_cost_per_dispatch: number  // sum(material_cost × qty)
  delivery_rate: number                // e.g. 0.85
  dispatch_cogs_per_unit: number       // packaging_cost / delivery_rate

  // Shrinkage
  shrinkage_rate: number               // e.g. 0.02
  shrinkage_per_unit: number           // shrinkage_rate × purchase_cogs

  // Total
  full_cogs_per_unit: number           // purchase + dispatch + shrinkage

  // Supporting data
  total_units_purchased: number
  lot_count: number
  latest_purchase_date: string | null
}

export async function calculateCogs(skuId: string): Promise<CogsBreakdown | null> {
  const supabase = await createClient()
  const tenantId = await getTenantId()

  // 1. Fetch all purchases for this SKU
  const { data: purchases } = await supabase
    .from('purchases')
    .select('id, quantity, unit_purchase_price, invoice_number, purchase_date')
    .eq('tenant_id', tenantId)
    .eq('master_sku_id', skuId)
    .order('purchase_date', { ascending: true })

  if (!purchases || purchases.length === 0) return null

  // 2. WAC base: weighted average of unit_purchase_price
  const totalQty = purchases.reduce((s, p) => s + p.quantity, 0)
  const totalValue = purchases.reduce((s, p) => s + p.quantity * p.unit_purchase_price, 0)
  const wacBase = totalQty > 0 ? totalValue / totalQty : 0

  // 3. Freight allocation: for each purchase row, find freight invoices matching invoice_number
  //    Allocate: freight × (row_value / lot_total_value)
  const invoiceNumbers = [...new Set(purchases.map(p => p.invoice_number).filter(Boolean))]
  let totalAllocatedFreight = 0

  for (const invNum of invoiceNumbers) {
    const lotRows = purchases.filter(p => p.invoice_number === invNum)
    const lotTotalValue = lotRows.reduce((s, p) => s + p.quantity * p.unit_purchase_price, 0)
    const skuLotValue = lotRows.reduce((s, p) => s + p.quantity * p.unit_purchase_price, 0)
    const skuLotQty = lotRows.reduce((s, p) => s + p.quantity, 0)

    const { data: freightRows } = await supabase
      .from('freight_invoices')
      .select('total_amount')
      .eq('tenant_id', tenantId)
      .eq('purchase_invoice_number', invNum)

    const totalFreightForLot = (freightRows ?? []).reduce((s, f) => s + f.total_amount, 0)
    if (lotTotalValue > 0 && skuLotQty > 0) {
      totalAllocatedFreight += totalFreightForLot * (skuLotValue / lotTotalValue) / skuLotQty * skuLotQty
      // per-unit: totalFreightForLot * (skuLotValue / lotTotalValue) / skuLotQty
    }
  }

  // Simplify: weighted freight per unit across all lots
  const wacFreight = totalQty > 0 ? totalAllocatedFreight / totalQty : 0
  const purchaseCogs = wacBase + wacFreight

  // 4. SKU config: shrinkage_rate + delivery_rate
  const { data: skuRow } = await supabase
    .from('master_skus')
    .select('id, name, shrinkage_rate, delivery_rate')
    .eq('id', skuId)
    .eq('tenant_id', tenantId)
    .single()

  const shrinkageRate = skuRow?.shrinkage_rate ?? 0.02
  const deliveryRate = skuRow?.delivery_rate ?? 1.0

  // 5. Dispatch packaging cost
  const { data: packagingConfig } = await supabase
    .from('sku_packaging_config')
    .select('qty_per_dispatch, packaging_materials(unit_cost)')
    .eq('tenant_id', tenantId)
    .eq('master_sku_id', skuId)

  const packagingCostPerDispatch = (packagingConfig ?? []).reduce((s, c) => {
    const mat = c.packaging_materials as { unit_cost: number } | null
    return s + (mat?.unit_cost ?? 0) * c.qty_per_dispatch
  }, 0)

  const dispatchCogs = deliveryRate > 0 ? packagingCostPerDispatch / deliveryRate : 0

  // 6. Shrinkage
  const shrinkagePerUnit = shrinkageRate * purchaseCogs

  // 7. Final
  const fullCogs = purchaseCogs + dispatchCogs + shrinkagePerUnit

  const lotSet = new Set(purchases.map(p => p.invoice_number).filter(Boolean))

  return {
    sku_id: skuId,
    sku_name: skuRow?.name ?? '',
    wac_base_per_unit: Math.round(wacBase * 100) / 100,
    wac_freight_per_unit: Math.round(wacFreight * 100) / 100,
    purchase_cogs_per_unit: Math.round(purchaseCogs * 100) / 100,
    packaging_cost_per_dispatch: Math.round(packagingCostPerDispatch * 100) / 100,
    delivery_rate: deliveryRate,
    dispatch_cogs_per_unit: Math.round(dispatchCogs * 100) / 100,
    shrinkage_rate: shrinkageRate,
    shrinkage_per_unit: Math.round(shrinkagePerUnit * 100) / 100,
    full_cogs_per_unit: Math.round(fullCogs * 100) / 100,
    total_units_purchased: totalQty,
    lot_count: lotSet.size,
    latest_purchase_date: purchases.at(-1)?.purchase_date ?? null,
  }
}
```

**Step 1: Type-check**
```bash
npx tsc --noEmit
```

**Step 2: Commit**
```bash
git add src/lib/cogs/calculate.ts
git commit -m "feat(cogs): add COGS calculation engine — WAC + freight allocation + dispatch + shrinkage"
```

---

### Task 11: COGS API route

**Files:**
- Create: `src/app/api/cogs/route.ts`
- Create: `src/app/api/cogs/[skuId]/route.ts`

**`src/app/api/cogs/route.ts`** — GET all SKUs with COGS:
```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { calculateCogs } from '@/lib/cogs/calculate'

export async function GET() {
  const supabase = await createClient()
  const tenantId = await getTenantId()

  // Get all SKUs that have at least one purchase
  const { data: skuIds } = await supabase
    .from('purchases')
    .select('master_sku_id')
    .eq('tenant_id', tenantId)

  const uniqueIds = [...new Set((skuIds ?? []).map(r => r.master_sku_id))]
  const results = await Promise.all(uniqueIds.map(id => calculateCogs(id)))
  return NextResponse.json(results.filter(Boolean))
}
```

**`src/app/api/cogs/[skuId]/route.ts`** — GET single SKU COGS + PATCH shrinkage/delivery_rate:
```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { calculateCogs } from '@/lib/cogs/calculate'

export async function GET(_: Request, { params }: { params: { skuId: string } }) {
  const result = await calculateCogs(params.skuId)
  if (!result) return NextResponse.json({ error: 'No purchases found' }, { status: 404 })
  return NextResponse.json(result)
}

// Update shrinkage_rate or delivery_rate overrides for a SKU
export async function PATCH(req: Request, { params }: { params: { skuId: string } }) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const { shrinkage_rate, delivery_rate } = await req.json()
  const updates: Record<string, number> = {}
  if (shrinkage_rate !== undefined) updates.shrinkage_rate = shrinkage_rate
  if (delivery_rate !== undefined) updates.delivery_rate = delivery_rate
  const { error } = await supabase
    .from('master_skus')
    .update(updates)
    .eq('id', params.skuId)
    .eq('tenant_id', tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(await calculateCogs(params.skuId))
}
```

**Step 3: Type-check**
```bash
npx tsc --noEmit
```

**Step 4: Commit**
```bash
git add src/app/api/cogs/
git commit -m "feat(cogs): add COGS API — list all SKUs + single SKU breakdown + shrinkage/rate override"
```

---

### Task 12: COGS page UI

**Files:**
- Create: `src/app/(dashboard)/cogs/page.tsx`
- Modify: `src/components/layout/AppSidebar.tsx`

Add to sidebar after Packaging:
```typescript
import { Calculator } from 'lucide-react'
{ href: '/cogs', label: 'COGS', icon: Calculator },
```

**COGS page design:**

- Header: "COGS — Cost of Goods Sold" + subtitle "Weighted average cost per delivered unit across all purchases"
- Table: one row per SKU that has purchases
- Columns: SKU Name | Lots | Units | Base (WAC) | Freight/unit | Purchase COGS | Packaging/dispatch | Delivery Rate | Dispatch COGS | Shrinkage % | Shrinkage/unit | **Full COGS/unit**
- Each row has an expand toggle (▶) that opens an inline breakdown panel showing:

```
┌─ Hair Curler ────────────────────────────────────────────┐
│  PURCHASE COGS                                           │
│  Avg Rate/Unit (ex-GST)          ₹495.00  (WAC, 2 lots) │
│  Allocated inward freight/unit   ₹12.50                  │
│  ─────────────────────────────────────────────           │
│  Purchase COGS/unit              ₹507.50                 │
│                                                          │
│  DISPATCH COGS                                           │
│  Polybag M (1×)                  ₹3.00                   │
│  Secondary Box S (1×)            ₹18.00                  │
│  Total packaging/dispatch        ₹21.00                  │
│  Delivery rate              [0.85 ✎]  (85% delivered)    │
│  Dispatch COGS/unit              ₹24.71  (21 ÷ 0.85)     │
│                                                          │
│  SHRINKAGE                                               │
│  Rate                       [2% ✎]                       │
│  Shrinkage/unit                  ₹10.15  (2% × ₹507.50)  │
│  ─────────────────────────────────────────────           │
│  FULL COGS/UNIT                  ₹542.36                 │
└──────────────────────────────────────────────────────────┘
```

- The `[✎]` fields are inline-editable — clicking opens a small popover/input to update the value. On save, calls `PATCH /api/cogs/[skuId]`.
- Footer summary: total SKUs with COGS | avg full COGS across all SKUs

**Step 5: Type-check + manual verify**
```bash
npx tsc --noEmit
```
Load `/cogs` — verify a SKU row appears, expand it, check numbers match manual calculation.

**Step 6: Commit**
```bash
git add src/app/(dashboard)/cogs/page.tsx src/components/layout/AppSidebar.tsx
git commit -m "feat(cogs): add COGS page — full breakdown per SKU with inline shrinkage + delivery rate overrides"
```

---

## Phase 5 — Push & Deploy

### Task 13: Final type-check, push, deploy

**Step 1: Full type-check**
```bash
npx tsc --noEmit
```
Expected: 0 errors.

**Step 2: Push**
```bash
git push origin main
```

**Step 3: Deploy**
```bash
ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=no root@46.225.117.86 "cd /opt/fk-tool && bash deploy.sh"
```

**Step 4: Smoke test on live site**
1. `/purchases` — confirm packaging_cost / other_cost fields gone from Add dialog
2. `/invoices` — add a freight invoice, verify it saves
3. `/packaging` — add a material, configure it on a SKU
4. `/cogs` — verify the SKU appears with correct numbers

---

## New Nav Order (final)

```
Dashboard
Master Catalog
Purchases
Invoices          ← new (Freight tab + Packaging Purchases tab)
Packaging         ← new (Materials catalog + SKU specs)
COGS              ← new (full breakdown per SKU)
Import Data
Inventory & P&L
Settings
```

---

## Data Flow Summary

```
purchases.unit_purchase_price  ──┐
purchases.quantity              ──┼──► WAC base per unit
purchases.invoice_number        ──┘

freight_invoices.total_amount  ──┐
freight_invoices                  ──┼──► allocated freight per unit (by value)
  .purchase_invoice_number      ──┘

packaging_materials.unit_cost  ──┐
sku_packaging_config            ──┼──► packaging cost per dispatch
  .qty_per_dispatch              ──┘
master_skus.delivery_rate      ──────► dispatch COGS/unit = packaging ÷ rate

master_skus.shrinkage_rate     ──────► shrinkage/unit = rate × purchase_cogs

                                        ┌──────────────────────────┐
                                        │  FULL COGS/UNIT          │
                                        │  = purchase + dispatch   │
                                        │  + shrinkage             │
                                        └──────────────────────────┘
```
