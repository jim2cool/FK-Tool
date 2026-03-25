# P&L per SKU — Design Spec

> Phase 2 of BUILD-TRACKER. Settlement import → order financials → P&L dashboard.
> Date: 2026-03-25

---

## Context

The seller has COGS data (purchases + freight + packaging + shrinkage) but no visibility into **platform fees, logistics costs, or actual profit per SKU**. Flipkart provides a P&L workbook (XLSX) per marketplace account per month with per-order fee breakdowns across ~20 fee types and settlement details.

By importing historical P&L data (6 months available, April 2025 onwards) and combining it with our COGS engine, we can show **true profit per SKU** — factoring in return rates, platform fees, and all costs. This is the single most important number for ecommerce decision-making.

**What prompted this:** COGS system is complete. Orders + dispatches are populated from label sorting. The `order_financials` and `sku_financial_profiles` tables exist but are empty.

**Intended outcome:** Import Flipkart P&L XLSX → compute per-SKU financial profiles (return rates, avg fees) from historical data → show true profit per SKU/channel/account with fee breakdowns and anomaly detection.

---

## 1. Data Source: Flipkart P&L Workbook

**Format:** XLSX with 4 sheets. We import from **"Orders P&L"** sheet only.

**Structure:**
- Row 0: Group headers (e.g., "Total Expenses (Breakup)")
- Row 1: Sub-headers (e.g., "Commission Fee", "Collection Fee")
- Row 2+: Data rows, one per order item

**Column discovery:** Parser reads row 0+1 headers and finds columns by name (not hardcoded index). This prevents breakage if Flipkart reorders columns. Required columns validated; missing optional columns default to 0.

**Key columns (89 total, we extract ~35):**

| Header (row 0 / row 1) | Our field |
|-------------------------|-----------|
| Order Date | `order_date` |
| Order ID | `platform_order_id` |
| Order Item ID | `order_item_id` |
| SKU Name | → resolve via `sku_mappings.platform_sku` (case-insensitive) |
| Fulfillment Type | `fulfillment_type` (NON_FBF / FBF) |
| Channel of Sale | `channel` (Flipkart / Shopsy) |
| Mode of Payment | `payment_mode` (prepaid / postpaid) |
| Order Status | → map to `OrderStatus` |
| Gross Units | `gross_units` |
| RTO (Logistics Return) | `rto_units` |
| RVP (Customer Return) | `rvp_units` |
| Cancelled Units | `cancelled_units` |
| Net Units | `net_units` |
| Final Selling Price | `final_selling_price` |
| Accounted Net Sales | `accounted_net_sales` |
| Sale Amount | `sale_amount` |
| Seller burn in customer's offer | `seller_offer_burn` |
| Total Expenses | `total_expenses` (used for validation — compare sum of fee cols) |
| Commission Fee | `commission_fee` |
| Collection Fee | `collection_fee` |
| Fixed Fee | `fixed_fee` |
| Pick and Pack Fee | `pick_pack_fee` |
| Forward Shipping Fee | `forward_shipping_fee` |
| Offer adjustments | `offer_adjustments` |
| Reverse Shipping Fee | `reverse_shipping_fee` |
| Taxes (GST) | `tax_gst` |
| Taxes (TCS) | `tax_tcs` |
| Taxes (TDS) | `tax_tds` |
| Rewards | `rewards` |
| SPF Payout | `spf_payout` |
| Bank Settlement [Projected] (col 47) | `projected_settlement` |
| Amount Settled | `amount_settled` |
| Amount Pending | `amount_pending` |

**Status mapping:**

| Flipkart Status | Our OrderStatus |
|-----------------|-----------------|
| DELIVERED | delivered |
| CANCELLED | cancelled |
| RETURNED | returned |
| RETURN_REQUESTED | returned |
| RETURN_CANCELLED | delivered |
| IN_TRANSIT | dispatched |

**All fee values are stored as-is** (negative for charges, positive for benefits/credits). This preserves Flipkart's raw data for audit purposes.

---

## 2. Schema Changes

### 2a. `orders` table — add columns + fix constraint

```sql
-- New columns
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_item_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_type TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_mode TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_selling_price NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gross_units INTEGER DEFAULT 1;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS net_units INTEGER DEFAULT 1;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rto_units INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rvp_units INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_units INTEGER DEFAULT 0;

-- Backfill existing orders (from label sorting) with synthetic order_item_id
UPDATE orders SET order_item_id = platform_order_id WHERE order_item_id IS NULL;

-- Drop old constraint, create new one
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_tenant_id_platform_order_id_key;
ALTER TABLE orders ADD CONSTRAINT orders_tenant_platform_item_key
  UNIQUE (tenant_id, platform_order_id, order_item_id);
```

**Label ingest update:** `src/app/api/labels/ingest/route.ts` must set `order_item_id = platform_order_id` (single-item orders from labels use order ID as item ID). For combo components, append component index: `{platform_order_id}_c{i}`.

### 2b. `order_financials` table — expand with granular fees

```sql
-- Revenue details
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS accounted_net_sales NUMERIC(10,2) DEFAULT 0;
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS sale_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS seller_offer_burn NUMERIC(10,2) DEFAULT 0;

-- Platform fees (stored as negative values from FK)
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS commission_fee NUMERIC(10,2) DEFAULT 0;
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS collection_fee NUMERIC(10,2) DEFAULT 0;
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS fixed_fee NUMERIC(10,2) DEFAULT 0;
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS offer_adjustments NUMERIC(10,2) DEFAULT 0;

-- Logistics (stored as negative values from FK)
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS pick_pack_fee NUMERIC(10,2) DEFAULT 0;
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS forward_shipping_fee NUMERIC(10,2) DEFAULT 0;
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS reverse_shipping_fee NUMERIC(10,2) DEFAULT 0;

-- Taxes (stored as negative values from FK)
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS tax_gst NUMERIC(10,2) DEFAULT 0;
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS tax_tcs NUMERIC(10,2) DEFAULT 0;
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS tax_tds NUMERIC(10,2) DEFAULT 0;

-- Benefits (positive values)
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS rewards NUMERIC(10,2) DEFAULT 0;
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS spf_payout NUMERIC(10,2) DEFAULT 0;

-- Settlement
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS amount_settled NUMERIC(10,2) DEFAULT 0;
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS amount_pending NUMERIC(10,2) DEFAULT 0;

-- Anomaly tracking
ALTER TABLE order_financials ADD COLUMN IF NOT EXISTS anomaly_flags JSONB DEFAULT '[]';

-- Prevent duplicate financials per order
ALTER TABLE order_financials ADD CONSTRAINT order_financials_tenant_order_key
  UNIQUE (tenant_id, order_id);

-- Index for P&L summary joins
CREATE INDEX IF NOT EXISTS idx_order_financials_order_id ON order_financials(order_id);
```

**Note:** `projected_settlement` already exists on `order_financials` — no ALTER needed for it.

**Backward compat:** Existing aggregate columns computed during import:
- `commission_amount` = ABS(commission_fee)
- `commission_rate` = ABS(commission_fee) / NULLIF(sale_price, 0)
- `logistics_cost` = ABS(forward_shipping_fee + reverse_shipping_fee + pick_pack_fee)
- `other_deductions` = ABS(collection_fee + fixed_fee + offer_adjustments)
- `actual_settlement` = amount_settled
- `settlement_variance` = amount_settled - projected_settlement

### 2c. `pnl_anomaly_rules` table — new

```sql
CREATE TABLE pnl_anomaly_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  rule_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, rule_key)
);

-- RLS
ALTER TABLE pnl_anomaly_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON pnl_anomaly_rules
  USING (tenant_id = auth.uid()::text::uuid);
```

**Default rules seeded on first import:**

| rule_key | name | description |
|----------|------|-------------|
| `reverse_shipping_on_cancel` | Reverse shipping on cancelled order | Flipkart charged reverse shipping for a cancelled order (not dispatched) |
| `reverse_shipping_on_rto` | Reverse shipping on RTO | Flipkart charged reverse shipping on a logistics return (should be Flipkart's cost) |
| `commission_on_return` | Commission on returned order | Commission charged but order was fully returned |
| `settlement_mismatch` | Settlement doesn't match projected | Actual settled amount differs from projected by more than ₹1 |

Rules are **user-visible and toggleable** — shown in a rules panel on the P&L page with enable/disable switches. Only enabled rules run during import.

### 2d. Deferred to v1.1

**`order_settlements` table** (per-transaction NEFT/payment details) — not needed for v1. The aggregate `amount_settled` and `amount_pending` columns are sufficient. Transaction-level settlement data can be added when we build bank reconciliation.

### 2e. Combo SKU handling

When a P&L row's SKU Name resolves to a `combo_product_id` (not `master_sku_id`) in `sku_mappings`, the order is created with `master_sku_id = NULL` and a new `combo_product_id` column on the `orders` table. P&L is calculated at the combo level. COGS for combos = sum of component COGS (already handled by COGS engine expanding combo components).

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS combo_product_id UUID REFERENCES combo_products(id);
```

---

## 3. Import Flow

### Architecture

Following the established purchases import pattern:

| Component | File | Role |
|-----------|------|------|
| **XLSX Parser** | `src/lib/importers/pnl-xlsx-parser.ts` | Client-safe. Reads "Orders P&L" sheet, discovers columns by header text, extracts typed rows. Uses `xlsx` (SheetJS). |
| **Server Importer** | `src/lib/importers/pnl-import-server.ts` | Server-only. Resolves SKU names → master_sku_ids via sku_mappings. Creates/updates orders + order_financials. Runs anomaly rules. Recomputes `sku_financial_profiles`. |
| **Dedup Checker** | `src/app/api/pnl/check-duplicates/route.ts` | POST. Checks DB for existing `order_item_id` values. Returns duplicate indices. |
| **Import API** | `src/app/api/pnl/import/route.ts` | POST. Accepts parsed rows + marketplace_account_id + skipRowIndices. Calls server importer. |
| **Import Dialog** | `src/components/pnl/PnlImportDialog.tsx` | UI state machine: account select → upload → preview → import → results |

### Import Dialog UX

1. **Step 1: Select Account** — dropdown of marketplace accounts (filtered to Flipkart platform)
2. **Step 2: Upload** — drag & drop .xlsx file
3. **Step 3: Preview** — table showing parsed rows with status badges:
   - Green checkmark: valid, will import
   - Yellow "Duplicate": already in DB, will skip
   - Orange "Unmapped SKU": SKU Name not found in sku_mappings
   - Red "Anomaly": billing anomaly detected (hover for rule name)
4. **Step 4: Results** — summary: X imported, Y skipped (duplicate), Z unmapped, W anomalies flagged

### 3-Step Upsert Logic

Label sorting creates orders with `platform_order_id` but no `order_item_id` (backfilled to match `platform_order_id`). The P&L import uses this lookup sequence:

1. **Exact match** on `(tenant_id, platform_order_id, order_item_id)` → **true duplicate, skip**
2. **Partial match** on `(tenant_id, platform_order_id)` where `order_item_id = platform_order_id` (label-sorted order) → **enrich existing order** with financial data, update status, set real `order_item_id`
3. **No match** → **insert new order** + new `order_financials` row

For step 2, the existing `order_financials` row (if any) is updated via the `UNIQUE(tenant_id, order_id)` constraint using upsert.

### Post-Import: Recompute Financial Profiles

After each import, recompute `sku_financial_profiles` for all affected SKUs:

```typescript
// For each master_sku_id with new data:
avg_commission_rate = AVG(ABS(commission_fee) / NULLIF(accounted_net_sales, 0))
avg_logistics_cost  = AVG(ABS(forward_shipping_fee + reverse_shipping_fee + pick_pack_fee))
avg_return_rate     = SUM(rto_units + rvp_units) / NULLIF(SUM(gross_units), 0)
avg_net_settlement_pct = AVG(amount_settled / NULLIF(accounted_net_sales, 0))
sample_size         = COUNT(orders)
last_computed_at    = now()
```

This populates the existing `sku_financial_profiles` table, enabling return-adjusted P&L.

---

## 4. P&L Calculation

### Two P&L Views

**1. Historical P&L (actual)** — from imported data, exact numbers:
```
Revenue            = SUM(accounted_net_sales) across delivered orders
COGS               = full_cogs_per_unit × SUM(net_units)
Platform Fees      = SUM(commission_fee + collection_fee + fixed_fee + offer_adjustments)
Logistics          = SUM(forward_shipping_fee + reverse_shipping_fee + pick_pack_fee)
Taxes              = SUM(tax_gst + tax_tcs + tax_tds)
Benefits           = SUM(rewards + spf_payout)
Seller Burns       = SUM(seller_offer_burn)

FK Net Earnings    = Revenue + Platform Fees + Logistics + Taxes + Benefits + Seller Burns
True Profit        = FK Net Earnings - COGS
Margin %           = True Profit / Revenue × 100
```

**2. Expected P&L per dispatched unit** — factors in return rate:
```
Expected Revenue/dispatch   = avg_selling_price × (1 - avg_return_rate)
Expected Fees/dispatch      = avg_platform_fees × (1 - avg_return_rate) + avg_reverse_shipping × avg_return_rate
Expected COGS/dispatch      = full_cogs_per_unit (always incurred)
Expected Profit/dispatch    = Expected Revenue - Expected COGS - Expected Fees
```

This answers: "If I dispatch 1 unit of SKU X today, what's my expected profit?" — the number that actually drives decisions.

### Batch COGS Calculation

The existing `calculateCogs()` makes 5-6 DB queries per SKU. For 50+ SKUs on the P&L page, this is 250+ round trips. Add `calculateCogsBatch(skuIds: string[])` to `src/lib/cogs/calculate.ts`:

- Fetch ALL purchases for all skuIds in one query
- Fetch ALL freight invoices for all relevant invoice numbers in one query
- Fetch ALL packaging configs in one query
- Compute per-SKU COGS in memory
- Return `Map<string, CogsBreakdown>`

### P&L Engine

**File:** `src/lib/pnl/calculate.ts`

**Input:** Date range, optional account filter, groupBy (product/channel/account)
**Output:** `PnlBreakdown[]` — one per aggregation unit

```typescript
interface PnlBreakdown {
  group_key: string
  group_name: string

  // Order counts
  gross_orders: number
  returned_orders: number
  cancelled_orders: number
  net_orders: number

  // Revenue
  revenue: number

  // COGS (from batch COGS engine)
  cogs_per_unit: number
  total_cogs: number

  // Flipkart fees (all negative except benefits)
  platform_fees: number
  logistics_fees: number
  taxes: number
  benefits: number
  seller_burns: number

  // Granular fee breakdown (for expanded view)
  fee_details: {
    commission_fee: number
    collection_fee: number
    fixed_fee: number
    pick_pack_fee: number
    forward_shipping_fee: number
    reverse_shipping_fee: number
    offer_adjustments: number
    tax_gst: number
    tax_tcs: number
    tax_tds: number
    rewards: number
    spf_payout: number
    seller_offer_burn: number
  }

  // Settlement
  projected_settlement: number
  amount_settled: number
  amount_pending: number

  // Computed — historical (actual)
  fk_net_earnings: number
  true_profit: number
  margin_pct: number

  // Computed — per dispatched unit (return-adjusted)
  return_rate: number
  expected_profit_per_dispatch: number

  // Anomalies
  anomaly_count: number
}
```

---

## 5. P&L Dashboard

### Page: `/dashboard/pnl`

**Nav position:** After COGS, before Import Data

### Layout

**Top bar:**
- Page title: "Profit & Loss"
- Subtitle: "True profit per SKU combining platform fees with your COGS data. Import P&L reports from Flipkart Seller Hub."
- "Import P&L Report" button (opens import dialog)
- "Anomaly Rules" button (gear icon, badge showing enabled rule count)
- Date range picker (month selector, default: current month)
- Account multi-select filter

**Summary cards row (6 cards):**
| Revenue | COGS | Platform Fees | Logistics | True Profit | Margin % |

**3 tabs:**

#### Tab 1: By Product
- Table columns: Product Name, Gross Orders, Return Rate, Net Orders, Revenue, COGS, Platform Fees, Logistics, True Profit, Margin %, Expected Profit/Dispatch
- Sortable by any column (default: Revenue desc)
- Expandable rows showing:
  - Left: Fee breakdown (all 13 fee types with amounts)
  - Right: COGS breakdown (purchase + dispatch + shrinkage, from COGS engine)
  - Bottom: Order status breakdown (delivered / returned / cancelled counts)
- Anomaly badge with count on rows that have flagged orders
- Color-coded margin: green (>20%), yellow (0-20%), red (<0% = losing money)
- InfoTooltip on "Expected Profit/Dispatch" explaining return-rate adjustment

#### Tab 2: By Channel
- Rows: Flipkart, Shopsy, Amazon, D2C
- Same columns as By Product
- Expandable to show per-account breakdown within each channel

#### Tab 3: By Account
- Rows: NuvioStore, NuvioCentral, BodhNest, NuvioShop, etc.
- Same columns as By Product
- Expandable to show top SKUs within each account

### Anomaly Rules Panel
- Accessible via "Anomaly Rules" button (gear icon)
- Dialog/sheet showing table of all rules: Name, Description, Enabled toggle
- Toggle immediately saves (PATCH API)
- Clear explanation at top: "These rules flag potential billing errors in imported P&L data. Disable rules that don't apply to your accounts."

### Empty State
- "No P&L data yet. Import your first Flipkart P&L report to see true profit per SKU."
- "Download from: Flipkart Seller Hub → Reports → Profit & Loss → Download XLSX"
- "Import P&L Report" button

### Data-Missing Banners
- If COGS data missing for some SKUs: "COGS data unavailable for X SKUs — profit shown without cost deduction. Add purchase data in Purchases page."
- If SKU mappings missing: "Y platform SKUs couldn't be matched to your catalog. Map them in Master Catalog → SKU Mappings."

---

## 6. API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/pnl/import` | Import parsed P&L data |
| POST | `/api/pnl/check-duplicates` | Check for duplicate order_item_ids |
| GET | `/api/pnl/summary` | P&L summary + table data |
| | `?groupBy=product\|channel\|account` | Aggregation level |
| | `?from=YYYY-MM-DD&to=YYYY-MM-DD` | Date range filter |
| | `?accountIds=id1,id2` | Account filter |
| GET | `/api/pnl/anomaly-rules` | List all anomaly rules for tenant |
| PATCH | `/api/pnl/anomaly-rules/[ruleId]` | Toggle rule enabled/disabled |

---

## 7. File Map

### New files

| File | Purpose |
|------|---------|
| `src/lib/importers/pnl-xlsx-parser.ts` | Client-safe XLSX parser for Flipkart P&L |
| `src/lib/importers/pnl-import-server.ts` | Server-side import + anomaly detection + profile recompute |
| `src/lib/pnl/calculate.ts` | P&L aggregation engine (historical + return-adjusted) |
| `src/lib/pnl/anomaly-rules.ts` | Default rule definitions + detection logic |
| `src/app/api/pnl/import/route.ts` | Import API |
| `src/app/api/pnl/check-duplicates/route.ts` | Dedup API |
| `src/app/api/pnl/summary/route.ts` | P&L summary/dashboard API |
| `src/app/api/pnl/anomaly-rules/route.ts` | Anomaly rules list |
| `src/app/api/pnl/anomaly-rules/[ruleId]/route.ts` | Single rule toggle |
| `src/app/(dashboard)/pnl/page.tsx` | P&L dashboard page |
| `src/components/pnl/PnlImportDialog.tsx` | Import dialog component |
| `src/components/pnl/PnlSummaryCards.tsx` | Summary cards row |
| `src/components/pnl/PnlProductTable.tsx` | By Product tab table |
| `src/components/pnl/PnlChannelTable.tsx` | By Channel tab table |
| `src/components/pnl/PnlAccountTable.tsx` | By Account tab table |
| `src/components/pnl/AnomalyRulesPanel.tsx` | Anomaly rules config UI |

### Existing files to modify

| File | Change |
|------|--------|
| `src/types/database.ts` | Add new interfaces, expand OrderFinancial, add OrderStatus values |
| `src/components/layout/AppSidebar.tsx` | Add P&L nav item |
| `src/app/(dashboard)/dashboard/page.tsx` | Add onboarding checklist step |
| `src/lib/cogs/calculate.ts` | Add `calculateCogsBatch()` function |
| `src/app/api/labels/ingest/route.ts` | Set `order_item_id` on created orders |

### Existing code to reuse

| What | File | How |
|------|------|-----|
| Tenant ID helper | `src/lib/db/tenant.ts` | `getTenantId()` for all queries |
| Supabase server client | `src/lib/supabase/server.ts` | DB access in API routes |
| InfoTooltip | `src/components/ui/info-tooltip.tsx` | Tooltips on fee column headers |
| Tabs pattern | `src/app/(dashboard)/invoices/page.tsx` | Multi-tab layout reference |
| Import dialog pattern | `src/components/purchases/PurchasesImportDialog.tsx` | State machine, preview, dedup |
| COGS engine | `src/lib/cogs/calculate.ts` | `calculateCogs()` / `calculateCogsBatch()` |
| Indian Rupee formatter | COGS page `fmt()` helper | Currency formatting |
| SKU mappings lookup | `src/app/api/catalog/sku-mappings/route.ts` | Resolve platform SKU → master SKU |

---

## 8. Verification Plan

### After import implementation:
1. Import the NuvioStore Feb 2026 P&L file
2. Verify row count: expect 672 rows parsed, ~614 unique orders
3. Check sample delivered order (OD436679551958795100): fixed_fee=-11, accounted_net_sales=142
4. Verify duplicates detected on re-import of same file
5. Check unmapped SKU handling — flagged in preview
6. Verify `sku_financial_profiles` populated after import (check avg_return_rate, avg_commission_rate)

### After dashboard implementation:
1. Load P&L page — summary cards show totals
2. By Product tab: check "USJONES SG FOLD" (highest revenue in sample — 310 gross, 167 returned, Revenue ₹11,830)
3. Verify its return rate shows ~54% (167/310)
4. Expand row — fee breakdown sums match total expenses
5. By Account tab — NuvioStore shows all data
6. Date filter — Feb 2026 shows data, March is empty
7. COGS integration — SKUs with purchase data show true profit; others show "COGS N/A"
8. Expected Profit/Dispatch column reflects return-adjusted numbers

### After anomaly detection:
1. View anomaly rules panel — 4 default rules, all enabled
2. Toggle one rule off — saves immediately
3. Import data — check if anomalies flagged correctly
4. Anomaly badge on SKU row — click shows details

---

## 9. Dependencies

**New dependency:** `xlsx` (SheetJS) for parsing .xlsx files client-side. Install via `npm install xlsx`.

No other new dependencies. All UI uses existing shadcn/ui primitives.

---

## 10. Historical Data Strategy

Import P&L files for all months since April 2025 across all 4 Flipkart accounts. This gives:
- **Stable return rates** per SKU (more data = more reliable avg_return_rate)
- **Seasonal patterns** in fees and margins
- **Financial profile baselines** for anomaly detection (know what "normal" looks like)

Import order: oldest month first → newest. Each import recomputes `sku_financial_profiles` with the expanded dataset. After all historical imports, the "Expected Profit/Dispatch" numbers will be highly reliable.
