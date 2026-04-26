# Daily P&L Estimator — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone `/daily-pnl` page where ops staff upload channel-specific export files per seller account and get estimated P&L per master product for any dispatch date range — replacing the manual Excel workflow.

**Architecture:** Own `dp_*` Supabase tables that reference the **existing** `marketplace_accounts` table (no new account management). The UI shows a channel/platform selector (Flipkart ✅ / Amazon 🔜 / D2C 🔜) followed by an account dropdown filtered to that channel. Files are parsed client-side using the `xlsx` npm package (already installed); parsers are channel-specific (only Flipkart implemented now). Parsed rows are POSTed as JSON to API routes. Computation runs server-side via in-memory aggregation.

**Tech Stack:** Next.js 16 App Router · TypeScript · Supabase PostgreSQL · Tailwind CSS + shadcn/ui (Select, Table, Tabs, Badge, Button, Input, Label, InfoTooltip) · xlsx npm package · react-dropzone · date-fns · sonner toasts

---

## File Map

### New files to create

| File | Purpose |
|------|---------|
| `src/lib/daily-pnl/types.ts` | All shared TypeScript types for this feature |
| `src/lib/daily-pnl/parsers.ts` | Client-side XLSX/CSV parsers — channel-specific (Flipkart implemented; others stubbed) |
| `src/app/api/daily-pnl/upload/route.ts` | POST — receive parsed rows, store by report type |
| `src/app/api/daily-pnl/results/route.ts` | GET — compute Return Costs + Order Detail + Consolidated P&L |
| `src/components/daily-pnl/ChannelAccountSelector.tsx` | Platform selector (Flipkart/Amazon/D2C) + filtered account dropdown using existing marketplace_accounts |
| `src/components/daily-pnl/UploadPanel.tsx` | 4 react-dropzone drop zones; shows "not yet supported" for non-Flipkart channels |
| `src/components/daily-pnl/ResultsTabs.tsx` | 3-tab output: Consolidated P&L / Order Detail / Return Costs |
| `src/app/(dashboard)/daily-pnl/page.tsx` | Main page wiring everything together |

> **No** `src/app/api/daily-pnl/accounts/route.ts` — accounts come from the existing `/api/marketplace-accounts` endpoint.

### Files to modify

| File | Change |
|------|--------|
| `src/components/layout/AppSidebar.tsx` | Add "Daily P&L" nav entry (TrendingUp icon) |

---

## Background: Data & Formulas

### 4 Input Reports (from the Excel spec)

| Report | Key columns | Storage behaviour |
|--------|-------------|-------------------|
| **A. Orders** | order_item_id, order_id, sku, quantity, dispatched_date, delivery_tracking_id, order_item_status | Append + dedup on `(marketplace_account_id, order_item_id)` |
| **B. Listing** | Seller SKU Id, MRP, Bank Settlement, Your Selling Price, Benchmark Price. **Row 1 is a description row — skip it** | Replace entire listing for account on each upload |
| **C. COGS** | SKU, Master Product, COGS. Maps platform SKU → Master Product name + cost/unit | Replace entire COGS for account on each upload |
| **D. P&L History** | Order Date, Order Item ID, SKU Name, Order Status, Gross Units, RTO (Logistics Return), RVP (Customer Return), Cancelled Units, Total Expenses (INR). **2-row header** — row 0 is main headers, row 1 is breakup sub-headers | Append + dedup on `(marketplace_account_id, order_item_id, order_date)` |

**SKU stripping rule:** Remove surrounding quotes and any `SKU:` prefix from all SKU values on ingest. Apply at both parse-time (client) and store-time (server).

### Formulas

**Return Costs** (computed from P&L History — all-time, not date-filtered):
```
dispatched   = gross_units - cancelled_units
delivered    = gross_units - cancelled_units - rto_units - rvp_units
delivery_rate = delivered / dispatched          (0 if dispatched = 0)
rvp_rate     = rvp_units / gross_units
total_rvp_fees = SUM(ABS(total_expenses)) WHERE rvp_units > 0
total_rto_fees = SUM(ABS(total_expenses)) WHERE rto_units > 0
avg_rvp_cost_per_unit = total_rvp_fees / rvp_units   (0 if rvp_units = 0)
est_return_cost_per_dispatched_unit = (total_rvp_fees + total_rto_fees) / dispatched
```

**Consolidated P&L** (from Orders filtered by dispatched_date range, joined with COGS + Listing):
```
avg_bank_settlement = SUM(bank_settlement × quantity) / SUM(quantity)   -- weighted avg
est_revenue_per_unit = delivery_rate × avg_bank_settlement
est_pnl_per_unit = est_revenue − (delivery_rate × cogs_per_unit) − est_return_cost_per_unit
total_est_pnl = quantity × est_pnl_per_unit
```

**Fallback for unknown products** (no P&L History match): use portfolio-weighted averages for delivery_rate and est_return_cost. Mark these rows `low_confidence = true`.

---

## Chunk 1: DB tables + Types

### Task 1: Create DB tables via Supabase MCP

- [ ] Run the following SQL via the Supabase MCP `execute_sql` tool (project `aorcopafrixqlbgckrpu`):

```sql
-- Daily P&L Estimator standalone tables (dp_ prefix)
-- References existing marketplace_accounts — no new accounts table needed.

CREATE TABLE dp_orders (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  marketplace_account_id UUID NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  order_item_id         TEXT NOT NULL,
  order_id              TEXT,
  sku                   TEXT,
  quantity              INTEGER DEFAULT 1,
  dispatched_date       DATE,
  delivery_tracking_id  TEXT,
  order_item_status     TEXT,
  UNIQUE(marketplace_account_id, order_item_id)
);

CREATE TABLE dp_listing (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  marketplace_account_id UUID NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  seller_sku_id         TEXT NOT NULL,
  mrp                   NUMERIC,
  bank_settlement       NUMERIC,
  selling_price         NUMERIC,
  benchmark_price       NUMERIC,
  UNIQUE(marketplace_account_id, seller_sku_id)
);

CREATE TABLE dp_cogs (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  marketplace_account_id UUID NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  sku                   TEXT NOT NULL,
  master_product        TEXT NOT NULL,
  cogs                  NUMERIC NOT NULL,
  UNIQUE(marketplace_account_id, sku)
);

CREATE TABLE dp_pnl_history (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  marketplace_account_id UUID NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  order_date            DATE,
  order_item_id         TEXT NOT NULL,
  sku_name              TEXT,
  order_status          TEXT,
  gross_units           NUMERIC DEFAULT 0,
  rto_units             NUMERIC DEFAULT 0,
  rvp_units             NUMERIC DEFAULT 0,
  cancelled_units       NUMERIC DEFAULT 0,
  total_expenses        NUMERIC DEFAULT 0,
  UNIQUE(marketplace_account_id, order_item_id, order_date)
);

CREATE TABLE dp_upload_log (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  marketplace_account_id UUID NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  report_type           TEXT NOT NULL,
  uploaded_at           TIMESTAMPTZ DEFAULT NOW(),
  row_count             INTEGER
);
```

- [ ] Verify all 6 tables appear in the Supabase Table Editor.

### Task 2: Shared TypeScript types

**Create:** `src/lib/daily-pnl/types.ts`

- [ ] Create the file:

```typescript
import type { Platform } from '@/types'

export type ReportType = 'orders' | 'listing' | 'cogs' | 'pnl_history'

// Re-export for convenience — matches marketplace_accounts row shape
export type MarketplaceAccount = {
  id: string
  account_name: string
  platform: Platform
  tenant_id: string
}

export type { Platform }

// --- Parsed row shapes (what client-side parsers return) ---

export type ParsedOrder = {
  order_item_id: string
  order_id: string
  sku: string
  quantity: number
  dispatched_date: string | null  // "YYYY-MM-DD" or null
  delivery_tracking_id: string
  order_item_status: string
  _row: number
  error?: string
}

export type ParsedListing = {
  seller_sku_id: string
  mrp: number | null
  bank_settlement: number | null
  selling_price: number | null
  benchmark_price: number | null
  _row: number
  error?: string
}

export type ParsedCogs = {
  sku: string
  master_product: string
  cogs: number
  _row: number
  error?: string
}

export type ParsedPnlHistory = {
  order_date: string | null       // "YYYY-MM-DD"
  order_item_id: string
  sku_name: string
  order_status: string
  gross_units: number
  rto_units: number
  rvp_units: number
  cancelled_units: number
  total_expenses: number
  _row: number
  error?: string
}

// --- API response shapes ---

export type ReturnCostsRow = {
  master_product: string
  gross_units: number
  cancelled_units: number
  rto_units: number
  rvp_units: number
  delivered_units: number
  delivery_rate: number
  rvp_rate: number
  total_rvp_fees: number
  total_rto_fees: number
  avg_rvp_cost_per_unit: number
  est_return_cost_per_dispatched_unit: number
}

export type OrderDetailRow = {
  order_item_id: string
  order_id: string
  sku: string
  dispatched_date: string
  order_item_status: string
  quantity: number
  mrp: number | null
  bank_settlement: number | null
  selling_price: number | null
  benchmark_price: number | null
  master_product: string | null
  cogs_per_unit: number | null
}

export type ConsolidatedRow = {
  master_product: string
  quantity: number
  avg_bank_settlement: number | null
  avg_selling_price: number | null
  cogs_per_unit: number | null
  delivery_rate: number | null
  est_return_cost_per_unit: number | null
  est_revenue_per_unit: number | null
  est_pnl_per_unit: number | null
  total_est_pnl: number | null
  low_confidence: boolean   // true = no P&L History match; used portfolio averages
}

export type ResultsResponse = {
  return_costs: ReturnCostsRow[]
  order_detail: OrderDetailRow[]
  consolidated: ConsolidatedRow[]
  portfolio_delivery_rate: number | null
  portfolio_return_cost: number | null
  unmapped_skus: string[]           // SKUs in Orders with no COGS entry
  missing_listing_skus: string[]    // SKUs in Orders with no Listing entry
}
```

- [ ] Commit: `git add src/lib/daily-pnl/types.ts && git commit -m "feat(daily-pnl): shared TypeScript types"`

> **No accounts API to write** — the existing `/api/marketplace-accounts` (GET returns all accounts for the tenant, including `platform` field) is used as-is.

---

## Chunk 2: Parsers + Upload API + Results API

### Task 4: Client-side parsers

**Create:** `src/lib/daily-pnl/parsers.ts`

Uses the `xlsx` npm package (already in `package.json`) to read both `.csv` and `.xlsx` files as raw 2D arrays, then maps column indices by name.

**P&L History has a 2-row header:**
- Row 0: main headers (e.g. `Order Date`, `Gross Units`, `Returned & Cancelled Units (Breakup)`, `Total Expenses (INR)`)
- Row 1: sub-headers for breakup columns (`RTO (Logistics Return)`, `RVP (Customer Return)`, `Cancelled Units`)
- Row 2+: data

**Listing has a description row:**
- Row 0: column headers
- Row 1: human-readable description (skip)
- Row 2+: data

- [ ] Create the file:

```typescript
import * as XLSX from 'xlsx'
import type { ParsedOrder, ParsedListing, ParsedCogs, ParsedPnlHistory } from './types'

// Convert Excel serial date or string to "YYYY-MM-DD"
function toDate(v: unknown): string | null {
  if (!v && v !== 0) return null
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(v).trim()
  if (!s) return null
  // "YYYY-MM-DD HH:MM:SS" → strip time
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  // DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  return null
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function stripSku(v: unknown): string {
  // Flipkart Orders export wraps SKUs as """SKU:value""" — strip all leading/trailing quotes then the prefix
  return String(v ?? '').replace(/^["']+|["']+$/g, '').replace(/^SKU:/i, '').trim()
}

// Read a file (CSV or XLSX) as a 2D array of raw cell values.
// sheetName: preferred sheet to read; falls back to first sheet if not found.
function fileToRows(file: File, sheetName?: string): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target!.result, { type: 'array', cellDates: false })
        const wsName = sheetName && wb.SheetNames.includes(sheetName)
          ? sheetName
          : wb.SheetNames[0]
        const ws = wb.Sheets[wsName]
        resolve(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true }))
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// Find a column index by searching for a substring in a header row (case-insensitive)
function findCol(headerRow: unknown[], ...needles: string[]): number {
  for (const needle of needles) {
    const idx = headerRow.findIndex(
      h => typeof h === 'string' && h.toLowerCase().includes(needle.toLowerCase())
    )
    if (idx >= 0) return idx
  }
  return -1
}

// ──────────────────────────────────────────────
// A. Orders
// ──────────────────────────────────────────────
export async function parseOrdersFile(file: File): Promise<ParsedOrder[]> {
  // Flipkart order export has two sheets: "Help" and "Orders" — read the correct one
  const rows = await fileToRows(file, 'Orders')
  if (rows.length < 2) return []

  const header = rows[0]
  const colId       = findCol(header, 'order_item_id', 'order item id')
  const colOrderId  = findCol(header, 'order_id', 'order id')
  const colSku      = findCol(header, 'sku')
  const colQty      = findCol(header, 'quantity')
  const colDisp     = findCol(header, 'dispatched_date', 'dispatched date', 'dispatched on')
  const colTracking = findCol(header, 'delivery_tracking_id', 'delivery tracking')
  const colStatus   = findCol(header, 'order_item_status', 'order item status')

  if (colId < 0 || colSku < 0 || colStatus < 0) {
    return [{ order_item_id: '', order_id: '', sku: '', quantity: 1,
      dispatched_date: null, delivery_tracking_id: '', order_item_status: '', _row: 0,
      error: 'Missing required columns: order_item_id, sku, order_item_status' }]
  }

  return rows.slice(1).flatMap((row, i): ParsedOrder[] => {
    const order_item_id = String(row[colId] ?? '').trim()
    if (!order_item_id) return []
    return [{
      order_item_id,
      order_id: String(row[colOrderId >= 0 ? colOrderId : 0] ?? '').trim(),
      sku: stripSku(row[colSku]),
      quantity: colQty >= 0 ? Math.max(1, toNum(row[colQty])) : 1,
      dispatched_date: colDisp >= 0 ? toDate(row[colDisp]) : null,
      delivery_tracking_id: colTracking >= 0 ? String(row[colTracking] ?? '').trim() : '',
      order_item_status: String(row[colStatus] ?? '').trim(),
      _row: i + 2,
    }]
  })
}

// ──────────────────────────────────────────────
// B. Listing  (Row 0 = headers, Row 1 = descriptions, Row 2+ = data)
// ──────────────────────────────────────────────
export async function parseListingFile(file: File): Promise<ParsedListing[]> {
  const rows = await fileToRows(file)
  if (rows.length < 3) return []

  const header    = rows[0]
  const colSku    = findCol(header, 'seller sku id', 'seller_sku_id')
  const colMrp    = findCol(header, 'mrp')
  const colBank   = findCol(header, 'bank settlement')
  const colSell   = findCol(header, 'your selling price', 'selling price')
  const colBench  = findCol(header, 'benchmark price')

  if (colSku < 0) {
    return [{ seller_sku_id: '', mrp: null, bank_settlement: null,
      selling_price: null, benchmark_price: null, _row: 0,
      error: 'Column "Seller SKU Id" not found' }]
  }

  return rows.slice(2).flatMap((row, i): ParsedListing[] => {
    const seller_sku_id = stripSku(row[colSku])
    if (!seller_sku_id) return []
    return [{
      seller_sku_id,
      mrp:             colMrp   >= 0 ? (toNum(row[colMrp])   || null) : null,
      bank_settlement: colBank  >= 0 ? (toNum(row[colBank])  || null) : null,
      selling_price:   colSell  >= 0 ? (toNum(row[colSell])  || null) : null,
      benchmark_price: colBench >= 0 ? (toNum(row[colBench]) || null) : null,
      _row: i + 3,
    }]
  })
}

// ──────────────────────────────────────────────
// C. COGS  (columns: Account?, SKU, Master Product, COGS)
// ──────────────────────────────────────────────
export async function parseCogsFile(file: File): Promise<ParsedCogs[]> {
  const rows = await fileToRows(file)
  if (rows.length < 2) return []

  const header   = rows[0]
  const colSku   = findCol(header, 'sku')
  const colMstr  = findCol(header, 'master product', 'master')
  const colCogs  = findCol(header, 'cogs')

  if (colSku < 0 || colMstr < 0 || colCogs < 0) {
    return [{ sku: '', master_product: '', cogs: 0, _row: 0,
      error: 'Required columns missing: SKU, Master Product, COGS' }]
  }

  return rows.slice(1).flatMap((row, i): ParsedCogs[] => {
    const sku            = stripSku(row[colSku])
    const master_product = String(row[colMstr] ?? '').trim()
    if (!sku || !master_product) return []
    return [{ sku, master_product, cogs: toNum(row[colCogs]), _row: i + 2 }]
  })
}

// ──────────────────────────────────────────────
// D. P&L History  (2-row header: row 0 = main, row 1 = breakup sub-headers, row 2+ = data)
// ──────────────────────────────────────────────
export async function parsePnlHistoryFile(file: File): Promise<ParsedPnlHistory[]> {
  // Flipkart P&L report has multiple sheets — "Orders P&L" is the order-level detail
  const rows = await fileToRows(file, 'Orders P&L')
  if (rows.length < 3) return []

  const mainHdr = rows[0]
  const subHdr  = rows[1]

  const colDate    = findCol(mainHdr, 'order date')
  const colId      = findCol(mainHdr, 'order item id')
  const colSku     = findCol(mainHdr, 'sku name')
  const colStatus  = findCol(mainHdr, 'order status')
  const colGross   = findCol(mainHdr, 'gross units')
  const colExpense = findCol(mainHdr, 'total expenses')

  // RTO/RVP/Cancelled appear in the sub-header row (breakup columns)
  const colRto      = findCol(subHdr, 'rto', 'logistics return')
  const colRvp      = findCol(subHdr, 'rvp', 'customer return')
  const colCancelled = findCol(subHdr, 'cancelled units', 'cancelled')

  if (colDate < 0 || colId < 0 || colGross < 0) {
    return [{ order_date: null, order_item_id: '', sku_name: '', order_status: '',
      gross_units: 0, rto_units: 0, rvp_units: 0, cancelled_units: 0,
      total_expenses: 0, _row: 0,
      error: 'P&L History: missing required columns (Order Date, Order Item ID, Gross Units)' }]
  }

  return rows.slice(2).flatMap((row, i): ParsedPnlHistory[] => {
    const order_item_id = String(row[colId] ?? '').trim()
    if (!order_item_id) return []
    return [{
      order_date:      toDate(row[colDate]),
      order_item_id,
      sku_name:        colSku    >= 0 ? stripSku(row[colSku])                  : '',
      order_status:    colStatus >= 0 ? String(row[colStatus] ?? '').trim()    : '',
      gross_units:     toNum(row[colGross]),
      rto_units:       colRto       >= 0 ? toNum(row[colRto])       : 0,
      rvp_units:       colRvp       >= 0 ? toNum(row[colRvp])       : 0,
      cancelled_units: colCancelled >= 0 ? toNum(row[colCancelled]) : 0,
      total_expenses:  colExpense   >= 0 ? toNum(row[colExpense])   : 0,
      _row: i + 3,
    }]
  })
}
```

- [ ] Commit: `git add src/lib/daily-pnl/parsers.ts && git commit -m "feat(daily-pnl): client-side XLSX/CSV parsers for all 4 report types"`

### Task 5: Upload API

**Create:** `src/app/api/daily-pnl/upload/route.ts`

Receives `{ account_id, report_type, rows }` as JSON. Validates the account belongs to the tenant, stores rows by report type (replace for listing/cogs, upsert for orders/pnl_history), and logs the upload.

- [ ] Create the file:

```typescript
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'
import type { ReportType, ParsedOrder, ParsedListing, ParsedCogs, ParsedPnlHistory } from '@/lib/daily-pnl/types'

function stripSku(v: string | undefined | null): string {
  return (v ?? '').replace(/^["']+|["']+$/g, '').replace(/^SKU:/i, '').trim()
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()

    const body = await request.json() as {
      marketplace_account_id: string
      report_type: ReportType
      rows: unknown[]
    }
    const { marketplace_account_id, report_type, rows } = body

    if (!marketplace_account_id || !report_type || !Array.isArray(rows)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Verify account belongs to this tenant
    const { data: account } = await supabase
      .from('marketplace_accounts')
      .select('id')
      .eq('id', marketplace_account_id)
      .eq('tenant_id', tenantId)
      .single()
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    let inserted = 0

    if (report_type === 'orders') {
      const valid = (rows as ParsedOrder[]).filter(r => !r.error && r.order_item_id)
      if (valid.length > 0) {
        const { error } = await supabase
          .from('dp_orders')
          .upsert(
            valid.map(r => ({
              marketplace_account_id,
              order_item_id:        r.order_item_id,
              order_id:             r.order_id,
              sku:                  stripSku(r.sku),
              quantity:             r.quantity,
              dispatched_date:      r.dispatched_date,
              delivery_tracking_id: r.delivery_tracking_id,
              order_item_status:    r.order_item_status,
            })),
            { onConflict: 'marketplace_account_id,order_item_id' }
          )
        if (error) throw error
        inserted = valid.length
      }
    }

    else if (report_type === 'listing') {
      // Replace: delete current listing, then insert fresh
      await supabase.from('dp_listing').delete().eq('marketplace_account_id', marketplace_account_id)
      const valid = (rows as ParsedListing[]).filter(r => !r.error && r.seller_sku_id)
      if (valid.length > 0) {
        const { error } = await supabase.from('dp_listing').insert(
          valid.map(r => ({
            marketplace_account_id,
            seller_sku_id:   stripSku(r.seller_sku_id),
            mrp:             r.mrp,
            bank_settlement: r.bank_settlement,
            selling_price:   r.selling_price,
            benchmark_price: r.benchmark_price,
          }))
        )
        if (error) throw error
        inserted = valid.length
      }
    }

    else if (report_type === 'cogs') {
      // Replace: delete current COGS, then insert fresh
      await supabase.from('dp_cogs').delete().eq('marketplace_account_id', marketplace_account_id)
      const valid = (rows as ParsedCogs[]).filter(r => !r.error && r.sku)
      if (valid.length > 0) {
        const { error } = await supabase.from('dp_cogs').insert(
          valid.map(r => ({
            marketplace_account_id,
            sku:            stripSku(r.sku),
            master_product: r.master_product,
            cogs:           r.cogs,
          }))
        )
        if (error) throw error
        inserted = valid.length
      }
    }

    else if (report_type === 'pnl_history') {
      // Append + dedup on (account_id, order_item_id, order_date)
      const valid = (rows as ParsedPnlHistory[]).filter(r => !r.error && r.order_item_id)
      if (valid.length > 0) {
        const { error } = await supabase
          .from('dp_pnl_history')
          .upsert(
            valid.map(r => ({
              marketplace_account_id,
              order_date:      r.order_date,
              order_item_id:   r.order_item_id,
              sku_name:        stripSku(r.sku_name),
              order_status:    r.order_status,
              gross_units:     r.gross_units,
              rto_units:       r.rto_units,
              rvp_units:       r.rvp_units,
              cancelled_units: r.cancelled_units,
              total_expenses:  r.total_expenses,
            })),
            { onConflict: 'marketplace_account_id,order_item_id,order_date' }
          )
        if (error) throw error
        inserted = valid.length
      }
    }

    // Log the upload
    await supabase.from('dp_upload_log').insert({ marketplace_account_id, report_type, row_count: inserted })

    return NextResponse.json({ inserted })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] Commit: `git add src/app/api/daily-pnl/upload/route.ts && git commit -m "feat(daily-pnl): upload API — all 4 report types with replace/upsert logic"`

### Task 6: Results API

**Create:** `src/app/api/daily-pnl/results/route.ts`

Fetches all 4 `dp_*` tables for the account, runs the aggregation and P&L formulas in-memory, returns a single `ResultsResponse` JSON object.

- [ ] Create the file:

```typescript
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextRequest, NextResponse } from 'next/server'
import type { ReturnCostsRow, OrderDetailRow, ConsolidatedRow, ResultsResponse } from '@/lib/daily-pnl/types'

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const params              = request.nextUrl.searchParams
    const marketplace_account_id = params.get('marketplace_account_id')
    const from                = params.get('from')
    const to                  = params.get('to')

    if (!marketplace_account_id || !from || !to) {
      return NextResponse.json({ error: 'marketplace_account_id, from, to required' }, { status: 400 })
    }

    // Verify the account belongs to this tenant
    const { data: acct } = await supabase
      .from('marketplace_accounts').select('id')
      .eq('id', marketplace_account_id).eq('tenant_id', tenantId).single()
    if (!acct) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    // ── 1. Load lookup tables ──────────────────────────────────────────────
    const [{ data: cogsRows }, { data: listingRows }, { data: historyRows }, { data: orderRows }] =
      await Promise.all([
        supabase.from('dp_cogs').select('sku, master_product, cogs').eq('marketplace_account_id', marketplace_account_id),
        supabase.from('dp_listing').select('seller_sku_id, mrp, bank_settlement, selling_price, benchmark_price').eq('marketplace_account_id', marketplace_account_id),
        supabase.from('dp_pnl_history').select('sku_name, gross_units, rto_units, rvp_units, cancelled_units, total_expenses').eq('marketplace_account_id', marketplace_account_id),
        supabase.from('dp_orders').select('order_item_id, order_id, sku, quantity, dispatched_date, order_item_status')
          .eq('marketplace_account_id', marketplace_account_id)
          .not('dispatched_date', 'is', null)
          .gte('dispatched_date', from)
          .lte('dispatched_date', to),
      ])

    // Build lookup maps (lowercase SKU keys for case-insensitive matching)
    const cogsMap = new Map<string, { master_product: string; cogs: number }>()
    for (const r of cogsRows ?? []) cogsMap.set(r.sku.toLowerCase(), { master_product: r.master_product, cogs: r.cogs })

    const listingMap = new Map<string, { mrp: number | null; bank_settlement: number | null; selling_price: number | null; benchmark_price: number | null }>()
    for (const r of listingRows ?? []) listingMap.set(r.seller_sku_id.toLowerCase(), { mrp: r.mrp, bank_settlement: r.bank_settlement, selling_price: r.selling_price, benchmark_price: r.benchmark_price })

    // ── 2. Return Costs (from P&L History, all-time) ───────────────────────
    type HistAgg = { gross: number; cancelled: number; rto: number; rvp: number; rvp_fees: number; rto_fees: number }
    const histAgg = new Map<string, HistAgg>()

    for (const r of historyRows ?? []) {
      const cogs   = cogsMap.get((r.sku_name ?? '').toLowerCase())
      const master = cogs?.master_product ?? '__unmapped__'
      const cur    = histAgg.get(master) ?? { gross: 0, cancelled: 0, rto: 0, rvp: 0, rvp_fees: 0, rto_fees: 0 }
      cur.gross     += r.gross_units     ?? 0
      cur.cancelled += r.cancelled_units ?? 0
      cur.rto       += r.rto_units       ?? 0
      cur.rvp       += r.rvp_units       ?? 0
      if ((r.rvp_units ?? 0) > 0) cur.rvp_fees += Math.abs(r.total_expenses ?? 0)
      if ((r.rto_units ?? 0) > 0) cur.rto_fees += Math.abs(r.total_expenses ?? 0)
      histAgg.set(master, cur)
    }

    const returnCosts: ReturnCostsRow[] = []
    for (const [master, agg] of histAgg) {
      if (master === '__unmapped__') continue
      const dispatched   = agg.gross - agg.cancelled
      const delivered    = dispatched - agg.rto - agg.rvp
      const delivery_rate = dispatched > 0 ? delivered / dispatched : 0
      returnCosts.push({
        master_product: master,
        gross_units:    agg.gross,
        cancelled_units: agg.cancelled,
        rto_units:      agg.rto,
        rvp_units:      agg.rvp,
        delivered_units: delivered,
        delivery_rate,
        rvp_rate:       agg.gross > 0 ? agg.rvp / agg.gross : 0,
        total_rvp_fees: agg.rvp_fees,
        total_rto_fees: agg.rto_fees,
        avg_rvp_cost_per_unit: agg.rvp > 0 ? agg.rvp_fees / agg.rvp : 0,
        est_return_cost_per_dispatched_unit: dispatched > 0 ? (agg.rvp_fees + agg.rto_fees) / dispatched : 0,
      })
    }

    // Portfolio fallbacks (weighted across all masters with known delivery rates)
    const totalDisp      = returnCosts.reduce((s, r) => s + (r.gross_units - r.cancelled_units), 0)
    const totalDel       = returnCosts.reduce((s, r) => s + r.delivered_units, 0)
    const totalRetCost   = returnCosts.reduce((s, r) => s + r.total_rvp_fees + r.total_rto_fees, 0)
    const portfolio_delivery_rate = totalDisp > 0 ? totalDel / totalDisp : null
    const portfolio_return_cost   = totalDisp > 0 ? totalRetCost / totalDisp : null

    const rcByMaster = new Map(returnCosts.map(r => [r.master_product, r]))

    // ── 3. Order Detail (date-filtered orders joined with COGS + Listing) ──
    const orderDetail: OrderDetailRow[] = (orderRows ?? []).map(r => {
      const skuLow  = (r.sku ?? '').toLowerCase()
      const cogs    = cogsMap.get(skuLow)
      const listing = listingMap.get(skuLow)
      return {
        order_item_id:    r.order_item_id,
        order_id:         r.order_id,
        sku:              r.sku,
        dispatched_date:  r.dispatched_date,
        order_item_status: r.order_item_status,
        quantity:         r.quantity ?? 1,
        mrp:              listing?.mrp             ?? null,
        bank_settlement:  listing?.bank_settlement ?? null,
        selling_price:    listing?.selling_price   ?? null,
        benchmark_price:  listing?.benchmark_price ?? null,
        master_product:   cogs?.master_product     ?? null,
        cogs_per_unit:    cogs?.cogs               ?? null,
      }
    })

    // ── 4. Consolidated P&L (aggregated from Order Detail) ────────────────
    type ConsAgg = { quantity: number; wt_bank: number; wt_sell: number; cogs: number | null; master: string }
    const consMap = new Map<string, ConsAgg>()
    for (const row of orderDetail) {
      const key = row.master_product ?? `__sku_${row.sku}`
      const cur = consMap.get(key) ?? { quantity: 0, wt_bank: 0, wt_sell: 0, cogs: row.cogs_per_unit, master: row.master_product ?? row.sku }
      const qty = row.quantity
      cur.quantity += qty
      cur.wt_bank  += (row.bank_settlement ?? 0) * qty
      cur.wt_sell  += (row.selling_price   ?? 0) * qty
      consMap.set(key, cur)
    }

    const consolidated: ConsolidatedRow[] = []
    for (const agg of consMap.values()) {
      const rc              = rcByMaster.get(agg.master)
      const low_confidence  = !rc
      const delivery_rate   = rc?.delivery_rate ?? portfolio_delivery_rate
      const est_return_cost = rc?.est_return_cost_per_dispatched_unit ?? portfolio_return_cost
      const avg_bank        = agg.quantity > 0 ? agg.wt_bank / agg.quantity : null
      const avg_sell        = agg.quantity > 0 ? agg.wt_sell / agg.quantity : null
      let est_revenue: number | null = null
      let est_pnl:     number | null = null
      let total_pnl:   number | null = null
      if (delivery_rate != null && avg_bank != null) est_revenue = delivery_rate * avg_bank
      if (est_revenue != null && agg.cogs != null && delivery_rate != null && est_return_cost != null) {
        est_pnl   = est_revenue - delivery_rate * agg.cogs - est_return_cost
        total_pnl = agg.quantity * est_pnl
      }
      consolidated.push({
        master_product:           agg.master,
        quantity:                 agg.quantity,
        avg_bank_settlement:      avg_bank,
        avg_selling_price:        avg_sell,
        cogs_per_unit:            agg.cogs,
        delivery_rate,
        est_return_cost_per_unit: est_return_cost,
        est_revenue_per_unit:     est_revenue,
        est_pnl_per_unit:         est_pnl,
        total_est_pnl:            total_pnl,
        low_confidence,
      })
    }
    consolidated.sort((a, b) => (b.total_est_pnl ?? 0) - (a.total_est_pnl ?? 0))

    // ── 5. Validation flags ────────────────────────────────────────────────
    const orderedSkus      = [...new Set((orderRows ?? []).map(r => (r.sku ?? '').toLowerCase()))]
    const unmapped_skus    = orderedSkus.filter(s => !cogsMap.has(s)).map(s => s)
    const missing_listing  = orderedSkus.filter(s => !listingMap.has(s)).map(s => s)

    const response: ResultsResponse = {
      return_costs:           returnCosts.sort((a, b) => b.gross_units - a.gross_units),
      order_detail:           orderDetail,
      consolidated,
      portfolio_delivery_rate,
      portfolio_return_cost,
      unmapped_skus,
      missing_listing_skus: missing_listing,
    }

    return NextResponse.json(response)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] Commit: `git add src/app/api/daily-pnl/results/route.ts && git commit -m "feat(daily-pnl): results computation API — return costs + order detail + consolidated P&L"`

---

## Chunk 3: UI components + main page

### Task 7: ChannelAccountSelector component

**Create:** `src/components/daily-pnl/ChannelAccountSelector.tsx`

Shows a platform selector (Flipkart / Amazon / D2C) first, then an account dropdown filtered to that platform using existing `marketplace_accounts`. No account creation — accounts are managed in Settings.

- [ ] Create the file:

```tsx
'use client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { MarketplaceAccount, Platform } from '@/lib/daily-pnl/types'

const PLATFORMS: { value: Platform; label: string; supported: boolean }[] = [
  { value: 'flipkart', label: 'Flipkart', supported: true },
  { value: 'amazon',   label: 'Amazon',   supported: false },
  { value: 'd2c',      label: 'D2C',      supported: false },
]

interface Props {
  accounts: MarketplaceAccount[]
  platform: Platform
  selectedId: string | null
  onPlatformChange: (p: Platform) => void
  onSelect: (id: string) => void
}

export function ChannelAccountSelector({ accounts, platform, selectedId, onPlatformChange, onSelect }: Props) {
  const filtered = accounts.filter(a => a.platform === platform)

  return (
    <div className="flex gap-3 items-center flex-wrap">
      {/* Platform selector */}
      <div className="flex gap-1">
        {PLATFORMS.map(p => (
          <button
            key={p.value}
            onClick={() => onPlatformChange(p.value)}
            disabled={!p.supported}
            className={[
              'px-3 py-1.5 rounded-md text-sm font-medium border transition-colors',
              platform === p.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border text-muted-foreground hover:border-primary/50',
              !p.supported && 'opacity-40 cursor-not-allowed',
            ].join(' ')}
          >
            {p.label}
            {!p.supported && <span className="ml-1 text-xs opacity-70">🔜</span>}
          </button>
        ))}
      </div>

      {/* Account dropdown — filtered by platform */}
      {platform === 'flipkart' ? (
        filtered.length > 0 ? (
          <Select value={selectedId ?? ''} onValueChange={onSelect}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              {filtered.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">
            No Flipkart accounts found. Add one in <a href="/settings" className="underline">Settings</a>.
          </p>
        )
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          {PLATFORMS.find(p => p.value === platform)?.label} support coming soon
        </Badge>
      )}
    </div>
  )
}
```

### Task 8: UploadPanel component

**Create:** `src/components/daily-pnl/UploadPanel.tsx`

4 drop zones (react-dropzone). Each parses the file client-side, POSTs to `/api/daily-pnl/upload`, shows status + row count. If platform is not Flipkart, shows "not yet supported" instead of drop zones.

- [ ] Create the file:

```tsx
'use client'
import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { CheckCircle2, Upload, Loader2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ReportType, Platform } from '@/lib/daily-pnl/types'
import { parseOrdersFile, parseListingFile, parseCogsFile, parsePnlHistoryFile } from '@/lib/daily-pnl/parsers'

type UploadState = {
  status: 'idle' | 'parsing' | 'uploading' | 'done' | 'error'
  lastUploaded?: Date
  rowCount?: number
  error?: string
}

type ReportConfig = { type: ReportType; label: string; description: string }

const REPORTS: ReportConfig[] = [
  { type: 'orders',      label: 'A. Orders',      description: 'Flipkart order export (order_item_id, sku, dispatched_date, status)' },
  { type: 'listing',     label: 'B. Listing',     description: 'Seller listing export (MRP, Bank Settlement, Selling Price)' },
  { type: 'cogs',        label: 'C. COGS',        description: 'SKU → Master Product mapping + COGS/unit' },
  { type: 'pnl_history', label: 'D. P&L History', description: 'Flipkart P&L report — 60–90 days of settled order data' },
]

function parseFile(type: ReportType, file: File) {
  if (type === 'orders')      return parseOrdersFile(file)
  if (type === 'listing')     return parseListingFile(file)
  if (type === 'cogs')        return parseCogsFile(file)
  if (type === 'pnl_history') return parsePnlHistoryFile(file)
  throw new Error(`Unknown report type: ${type}`)
}

function DropZone({
  config, marketplaceAccountId, state, onChange, onUploaded,
}: {
  config: ReportConfig; marketplaceAccountId: string; state: UploadState
  onChange: (s: UploadState) => void; onUploaded: () => void
}) {
  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    onChange({ status: 'parsing' })
    try {
      const rows = await parseFile(config.type, file)
      // Check for a top-level parse error (returned as a single error row with _row=0)
      const fatal = rows.find(r => '_row' in (r as object) && (r as { _row: number })._row === 0 && 'error' in (r as object))
      if (fatal && 'error' in (fatal as object)) {
        const msg = (fatal as { error: string }).error
        onChange({ status: 'error', error: msg })
        toast.error(`${config.label}: ${msg}`)
        return
      }
      onChange({ status: 'uploading' })
      const res = await fetch('/api/daily-pnl/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketplace_account_id: marketplaceAccountId, report_type: config.type, rows }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const { inserted } = await res.json() as { inserted: number }
      onChange({ status: 'done', lastUploaded: new Date(), rowCount: inserted })
      toast.success(`${config.label}: ${inserted} rows uploaded`)
      onUploaded()
    } catch (e: unknown) {
      const msg = (e as Error).message
      onChange({ status: 'error', error: msg })
      toast.error(`${config.label}: ${msg}`)
    }
  }, [marketplaceAccountId, config, onChange, onUploaded])

  const isLoading = state.status === 'parsing' || state.status === 'uploading'
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, multiple: false, disabled: isLoading,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
  })

  return (
    <div
      {...getRootProps()}
      className={cn(
        'border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors select-none',
        isDragActive                ? 'border-primary bg-primary/5'     : 'border-border hover:border-primary/50',
        state.status === 'done'    && 'border-green-400 bg-green-50/50',
        state.status === 'error'   && 'border-red-400 bg-red-50/50',
        isLoading                  && 'opacity-60 cursor-not-allowed',
      )}
    >
      <input {...getInputProps()} />
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {isLoading                       && <Loader2     className="h-5 w-5 animate-spin text-muted-foreground" />}
          {state.status === 'done'         && <CheckCircle2 className="h-5 w-5 text-green-600" />}
          {state.status === 'error'        && <AlertCircle  className="h-5 w-5 text-red-500" />}
          {state.status === 'idle'         && <Upload       className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{config.label}</p>
          <p className="text-xs text-muted-foreground">{config.description}</p>
          {state.status === 'done'     && <p className="text-xs text-green-600 mt-1">{state.rowCount} rows · {state.lastUploaded?.toLocaleTimeString()}</p>}
          {state.status === 'error'    && <p className="text-xs text-red-500 mt-1 truncate">{state.error}</p>}
          {state.status === 'parsing'  && <p className="text-xs text-muted-foreground mt-1">Parsing file…</p>}
          {state.status === 'uploading'&& <p className="text-xs text-muted-foreground mt-1">Uploading…</p>}
        </div>
      </div>
    </div>
  )
}

export function UploadPanel({
  marketplaceAccountId, platform, onAnyUploaded,
}: {
  marketplaceAccountId: string
  platform: Platform
  onAnyUploaded: () => void
}) {
  const [states, setStates] = useState<Record<ReportType, UploadState>>({
    orders: { status: 'idle' }, listing: { status: 'idle' },
    cogs: { status: 'idle' }, pnl_history: { status: 'idle' },
  })

  if (platform !== 'flipkart') {
    return (
      <div className="border rounded-lg p-6 text-center text-muted-foreground text-sm">
        Upload support for {platform.toUpperCase()} is coming soon. Only Flipkart is supported today.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {REPORTS.map(cfg => (
        <DropZone
          key={cfg.type}
          config={cfg}
          marketplaceAccountId={marketplaceAccountId}
          state={states[cfg.type]}
          onChange={s => setStates(prev => ({ ...prev, [cfg.type]: s }))}
          onUploaded={onAnyUploaded}
        />
      ))}
    </div>
  )
}
```

### Task 9: ResultsTabs component

**Create:** `src/components/daily-pnl/ResultsTabs.tsx`

3 tabs with sortable tables. Consolidated tab leads with 3 headline KPI cards. Negative P&L rows are red. Delivery rate < 30% gets a "high risk" badge. "low confidence" badge on products using portfolio fallbacks. Each tab has an Export CSV button.

- [ ] Create the file:

```tsx
'use client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Download, AlertTriangle } from 'lucide-react'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import type { ResultsResponse } from '@/lib/daily-pnl/types'

function inr(n: number | null | undefined, dec = 0) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: dec }).format(n)
}

function pct(n: number | null | undefined) {
  if (n == null) return '—'
  return (n * 100).toFixed(1) + '%'
}

function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))].join('\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: filename })
  a.click()
}

export function ResultsTabs({ data, from, to }: { data: ResultsResponse; from: string; to: string }) {
  const totalPnl   = data.consolidated.reduce((s, r) => s + (r.total_est_pnl ?? 0), 0)
  const totalUnits = data.consolidated.reduce((s, r) => s + r.quantity, 0)
  const wtMargin   = data.consolidated.reduce((s, r) =>
    r.avg_bank_settlement ? s + ((r.est_pnl_per_unit ?? 0) / r.avg_bank_settlement) * r.quantity : s, 0)
  const avgMarginPct = totalUnits > 0 ? (wtMargin / totalUnits) * 100 : 0

  return (
    <div className="space-y-4">
      {/* Validation warnings */}
      {data.unmapped_skus.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {data.unmapped_skus.length} SKU(s) in Orders not found in COGS — Master Product will show as unmapped.
        </div>
      )}
      {data.missing_listing_skus.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {data.missing_listing_skus.length} SKU(s) in Orders not found in Listing — prices will show as —.
        </div>
      )}

      {/* Headline KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Total Est. P&L</p>
          <p className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-green-700' : 'text-red-600'}`}>{inr(totalPnl)}</p>
          <p className="text-xs text-muted-foreground">{from} → {to}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Units Dispatched</p>
          <p className="text-2xl font-bold">{totalUnits.toLocaleString('en-IN')}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Avg Margin %</p>
          <p className={`text-2xl font-bold ${avgMarginPct >= 0 ? 'text-green-700' : 'text-red-600'}`}>{avgMarginPct.toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground">of bank settlement</p>
        </div>
      </div>

      <Tabs defaultValue="consolidated">
        <TabsList>
          <TabsTrigger value="consolidated">Consolidated P&L</TabsTrigger>
          <TabsTrigger value="order_detail">Order Detail ({data.order_detail.length})</TabsTrigger>
          <TabsTrigger value="return_costs">Return Costs</TabsTrigger>
        </TabsList>

        {/* ── Consolidated P&L ── */}
        <TabsContent value="consolidated">
          <div className="flex justify-end mb-2">
            <Button size="sm" variant="outline" onClick={() => downloadCsv(data.consolidated as unknown as Record<string, unknown>[], `consolidated-${from}-${to}.csv`)}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </div>
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Master Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">
                    Avg Settlement <InfoTooltip content="Weighted average Bank Settlement across all dispatched SKUs of this master product." />
                  </TableHead>
                  <TableHead className="text-right">
                    COGS/Unit <InfoTooltip content="Cost of Goods Sold per unit from your COGS mapping file." />
                  </TableHead>
                  <TableHead className="text-right">
                    Delivery Rate <InfoTooltip content="% of dispatched units actually delivered. Derived from 60–90 days of P&L History. Products with no history use the portfolio average." />
                  </TableHead>
                  <TableHead className="text-right">
                    Est. Rev/Unit <InfoTooltip content="Delivery Rate × Avg Bank Settlement. Only delivered units generate revenue." />
                  </TableHead>
                  <TableHead className="text-right">
                    Est. P&L/Unit <InfoTooltip content="Est. Revenue/Unit − (Delivery Rate × COGS/Unit) − Est. Return Cost/Unit" />
                  </TableHead>
                  <TableHead className="text-right">Total Est. P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.consolidated.map((row, i) => (
                  <TableRow key={i} className={(row.total_est_pnl ?? 0) < 0 ? 'bg-red-50' : ''}>
                    <TableCell className="font-medium">
                      {row.master_product}
                      {row.low_confidence && <Badge variant="outline" className="ml-2 text-xs text-amber-600 border-amber-300">low confidence</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{row.quantity}</TableCell>
                    <TableCell className="text-right">{inr(row.avg_bank_settlement)}</TableCell>
                    <TableCell className="text-right">{inr(row.cogs_per_unit)}</TableCell>
                    <TableCell className="text-right">
                      {pct(row.delivery_rate)}
                      {row.delivery_rate != null && row.delivery_rate < 0.3 && <Badge className="ml-1 bg-red-100 text-red-700 border-0 text-xs">high risk</Badge>}
                    </TableCell>
                    <TableCell className="text-right">{inr(row.est_revenue_per_unit)}</TableCell>
                    <TableCell className={`text-right font-medium ${(row.est_pnl_per_unit ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{inr(row.est_pnl_per_unit)}</TableCell>
                    <TableCell className={`text-right font-bold ${(row.total_est_pnl ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>{inr(row.total_est_pnl)}</TableCell>
                  </TableRow>
                ))}
                {data.consolidated.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No dispatched orders found in this date range</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Order Detail ── */}
        <TabsContent value="order_detail">
          <div className="flex justify-end mb-2">
            <Button size="sm" variant="outline" onClick={() => downloadCsv(data.order_detail as unknown as Record<string, unknown>[], `order-detail-${from}-${to}.csv`)}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </div>
          <div className="border rounded-lg overflow-auto max-h-[520px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order Item ID</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Master Product</TableHead>
                  <TableHead>Dispatched</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Bank Settlement</TableHead>
                  <TableHead className="text-right">COGS/Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.order_detail.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{row.order_item_id}</TableCell>
                    <TableCell className="text-xs max-w-[160px] truncate">{row.sku}</TableCell>
                    <TableCell>{row.master_product ?? <span className="text-amber-600 text-xs">unmapped</span>}</TableCell>
                    <TableCell className="text-xs">{row.dispatched_date}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{row.order_item_status}</Badge></TableCell>
                    <TableCell className="text-right">{row.quantity}</TableCell>
                    <TableCell className="text-right">{inr(row.bank_settlement)}</TableCell>
                    <TableCell className="text-right">{inr(row.cogs_per_unit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Return Costs ── */}
        <TabsContent value="return_costs">
          <div className="flex justify-end mb-2">
            <Button size="sm" variant="outline" onClick={() => downloadCsv(data.return_costs as unknown as Record<string, unknown>[], `return-costs.csv`)}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </div>
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Master Product</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                  <TableHead className="text-right">RTO</TableHead>
                  <TableHead className="text-right">RVP</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">
                    Delivery Rate <InfoTooltip content="Delivered ÷ Dispatched (Gross − Cancelled)" />
                  </TableHead>
                  <TableHead className="text-right">
                    Avg RVP Cost/Unit <InfoTooltip content="Total RVP fees ÷ RVP units" />
                  </TableHead>
                  <TableHead className="text-right">
                    Est. Return Cost/Unit <InfoTooltip content="(Total RVP fees + Total RTO fees) ÷ Dispatched units" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.return_costs.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.master_product}</TableCell>
                    <TableCell className="text-right">{row.gross_units}</TableCell>
                    <TableCell className="text-right">{row.cancelled_units}</TableCell>
                    <TableCell className="text-right">{row.rto_units}</TableCell>
                    <TableCell className="text-right">{row.rvp_units}</TableCell>
                    <TableCell className="text-right">{row.delivered_units}</TableCell>
                    <TableCell className={`text-right ${row.delivery_rate < 0.3 ? 'text-red-600 font-medium' : ''}`}>{pct(row.delivery_rate)}</TableCell>
                    <TableCell className="text-right">{inr(row.avg_rvp_cost_per_unit)}</TableCell>
                    <TableCell className="text-right">{inr(row.est_return_cost_per_dispatched_unit)}</TableCell>
                  </TableRow>
                ))}
                {data.return_costs.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Upload P&L History to see return cost analysis</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

### Task 10: Main page

**Create:** `src/app/(dashboard)/daily-pnl/page.tsx`

Wires ChannelAccountSelector + date range + UploadPanel + ResultsTabs together. Fetches accounts from the existing `/api/marketplace-accounts` endpoint. Defaults to Flipkart; auto-selects the first Flipkart account.

- [ ] Create the file:

```tsx
'use client'
import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RefreshCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ChannelAccountSelector } from '@/components/daily-pnl/ChannelAccountSelector'
import { UploadPanel } from '@/components/daily-pnl/UploadPanel'
import { ResultsTabs } from '@/components/daily-pnl/ResultsTabs'
import type { MarketplaceAccount, Platform, ResultsResponse } from '@/lib/daily-pnl/types'

function yesterday() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export default function DailyPnlPage() {
  const [accounts, setAccounts]     = useState<MarketplaceAccount[]>([])
  const [platform, setPlatform]     = useState<Platform>('flipkart')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [from, setFrom]             = useState(yesterday)
  const [to, setTo]                 = useState(yesterday)
  const [results, setResults]       = useState<ResultsResponse | null>(null)
  const [loading, setLoading]       = useState(false)

  useEffect(() => {
    // Use the existing marketplace-accounts endpoint — same one used in Settings
    fetch('/api/marketplace-accounts')
      .then(r => r.json())
      .then((data: MarketplaceAccount[]) => {
        setAccounts(data ?? [])
        // Auto-select first Flipkart account
        const first = (data ?? []).find(a => a.platform === 'flipkart')
        if (first) setSelectedId(first.id)
      })
      .catch(() => toast.error('Failed to load accounts'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When platform changes, reset selected account to first account on that platform
  function handlePlatformChange(p: Platform) {
    setPlatform(p)
    setSelectedId(null)
    setResults(null)
    const first = accounts.find(a => a.platform === p)
    if (first) setSelectedId(first.id)
  }

  const compute = useCallback(async () => {
    if (!selectedId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/daily-pnl/results?marketplace_account_id=${selectedId}&from=${from}&to=${to}`
      )
      if (!res.ok) throw new Error((await res.json()).error)
      setResults(await res.json())
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [selectedId, from, to])

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold">Daily P&L Estimator</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload channel exports for a seller account and get estimated P&L per master product for any dispatch date range.
          Uses 60–90 days of P&L History to estimate delivery rates and return costs.
        </p>
      </div>

      {/* Channel + Account + Date range */}
      <div className="flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Channel & Account</Label>
          <ChannelAccountSelector
            accounts={accounts}
            platform={platform}
            selectedId={selectedId}
            onPlatformChange={handlePlatformChange}
            onSelect={id => { setSelectedId(id); setResults(null) }}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={from} onChange={e => { setFrom(e.target.value); setResults(null) }} className="w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={to} onChange={e => { setTo(e.target.value); setResults(null) }} className="w-36" />
        </div>
        <Button onClick={compute} disabled={!selectedId || platform !== 'flipkart' || loading}>
          {loading
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Computing…</>
            : <><RefreshCw className="h-4 w-4 mr-2" />Compute</>}
        </Button>
      </div>

      {/* Upload panel */}
      {selectedId && (
        <div className="space-y-2">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Upload Reports</h2>
          <UploadPanel
            marketplaceAccountId={selectedId}
            platform={platform}
            onAnyUploaded={() => setResults(null)}
          />
        </div>
      )}

      {/* Empty state */}
      {!selectedId && (
        <div className="border rounded-lg p-12 text-center text-muted-foreground">
          <p className="text-lg font-medium">Select a channel and account to get started</p>
          <p className="text-sm mt-1">
            Accounts are managed in <a href="/settings" className="underline">Settings</a>.
            Each account corresponds to one seller profile (e.g. NuvioShop, NuvioCentral).
          </p>
        </div>
      )}
      {selectedId && !results && !loading && (
        <div className="border rounded-lg p-12 text-center text-muted-foreground">
          <p className="text-lg font-medium">Upload your reports, then click Compute</p>
          <p className="text-sm mt-1">
            COGS and Listing replace previous uploads. Orders and P&L History are appended with deduplication.
          </p>
        </div>
      )}

      {/* Results */}
      {results && <ResultsTabs data={results} from={from} to={to} />}
    </div>
  )
}
```

### Task 11: Sidebar nav item

**Modify:** `src/components/layout/AppSidebar.tsx`

> **Note:** `TrendingUp` is already used for the "Profit & Loss" entry. Use `Calculator` for Daily P&L to avoid icon collision.

- [ ] Read the current lucide import line in `AppSidebar.tsx` and add `Calculator` to it (do not duplicate `TrendingUp`).
- [ ] Add this entry to `navItems` after the Labels entry and before the separator:

```typescript
{ type: 'link', href: '/daily-pnl', label: 'Daily P&L', icon: Calculator },
```

- [ ] Commit all UI files:

```bash
git add src/components/daily-pnl/ src/app/(dashboard)/daily-pnl/ src/components/layout/AppSidebar.tsx
git commit -m "feat(daily-pnl): main page, channel+account selector, upload panel, results tabs, sidebar nav"
```

---

## Chunk 4: Type-check, Deploy, Smoke test

### Task 12: Type-check

- [ ] Run: `npx tsc --noEmit`
- [ ] Fix any TypeScript errors before deploying.

### Task 13: Deploy to live site

- [ ] Push: `git push origin main`
- [ ] SSH deploy:
  ```bash
  ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=no root@46.225.117.86 "cd /opt/fk-tool && bash deploy.sh"
  ```

### Task 14: Smoke test on live site

Test using the sample data files on the Desktop (`C:\Users\shash\Desktop\FLipkart\`):

- [ ] Open https://ecommerceforall.in/daily-pnl
- [ ] Verify "Daily P&L" appears in the sidebar with the Calculator icon
- [ ] Verify Flipkart is selected by default and existing accounts (e.g. NuvioShop, NuvioCentral) appear in the dropdown
- [ ] Switch to Amazon — verify "coming soon" banner appears (no drop zones)
- [ ] Switch back to Flipkart, select "NuvioShop"
- [ ] Upload the Orders file — verify "A. Orders: N rows · HH:MM:SS" appears
- [ ] Upload Listing, COGS, P&L History similarly
- [ ] Set date range to 2026-04-23 → 2026-04-24 (matches sample Orders data)
- [ ] Click Compute — verify Compute button is disabled when Amazon is selected
- [ ] Verify Consolidated P&L tab: products appear, Total Est. P&L shows, KPI cards populate
- [ ] Verify: "low confidence" badge on products not in P&L History
- [ ] Verify: negative P&L rows are highlighted red
- [ ] Verify: products with delivery_rate < 30% show "high risk" badge
- [ ] Verify Order Detail tab: rows appear with correct SKU → Master Product mapping
- [ ] Verify Return Costs tab: populated from P&L History
- [ ] Verify Export CSV works on each tab
- [ ] Re-upload Orders — verify row count updates (upsert, not duplicate)
- [ ] Switch date range to a day with no orders — verify empty state message in tables
