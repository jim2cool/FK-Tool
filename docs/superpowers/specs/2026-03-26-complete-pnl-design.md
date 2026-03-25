# Complete P&L — From Contribution Margin to Operating Profit

> Upgrades the P&L system from contribution margin to a full P&L with monthly overheads, 3-report import pipeline, recovery metrics, and RTO/RVP/Cancel analysis.
> Date: 2026-03-26
> Depends on: P&L per SKU + Rich Dashboard (both implemented 2026-03-25)

---

## Context

The current P&L page shows **Contribution Margin** (revenue minus variable costs). But a seller can't answer "Am I actually profitable this month?" because:
1. Fixed costs (salary, rent, software) aren't tracked
2. Order lifecycle data (delivery dates, return timelines) isn't imported
3. Return types (RTO vs RVP vs Cancel) aren't broken down
4. Cash recovery speed per SKU isn't visible

This spec completes the P&L by:
- Supporting 3 Flipkart report imports (Orders, Returns, P&L) at different frequencies
- Adding monthly overhead tracking with itemized categories
- Computing full P&L down to Operating Profit
- Adding recovery metrics (rounds to recover, cash cycle days) per SKU
- Breaking down returns by type with actionable analysis

**Data available:**
- Historical: NuvioCentral Orders + Returns (Jul-Dec 2025, 5,814 orders + 2,229 returns)
- Current: NuvioStore P&L (Jan-Feb 2026, 2,121 orders with financials)
- Going forward: Daily Orders + Returns uploads, monthly P&L uploads

---

## 1. Navigation Structure

The existing P&L page expands into **4 dedicated pages** in the sidebar:

| Page | Route | Purpose |
|------|-------|---------|
| **Dashboard** | `/dashboard` | Intelligence hub — action items at top, key charts (waterfall, trends), unified insights from all data. The "open this every morning" page. |
| **P&L** | `/pnl` | Financial detail — contribution margin per SKU with verdicts, fee breakdown, overheads, operating profit, recovery metrics. |
| **Returns & Quality** | `/returns` | Return deep dive — RTO/RVP breakdown, return reasons, cost of each return, trends, quality alerts. |
| **Cash Flow** | `/cashflow` | Money movement — settlement timeline, pending payments, tax credits locked, inventory capital, reorder signals. |

**Dashboard layout:**
1. Action items ("What to do today") — top 5 imperative actions from all insights
2. Summary cards row (Revenue, Contribution Margin, Operating Profit, Cash Locked, Return Rate)
3. Key charts: Waterfall + P&L trend (MoM) + Return rate trend
4. All insights below, sorted by impact

**Shared controls:** Month picker and Account filter appear on all 4 pages. Import Data button on all pages.

**Sidebar nav order:**
```
Dashboard → Master Catalog → Purchases → Invoices → Packaging → Labels → COGS
→ P&L → Returns & Quality → Cash Flow → Import Data → Settings
```

---

## 2. Four Report Importers

### Import Dialog Upgrade

The "Import P&L Report" button becomes **"Import Data"**. The import dialog adds a report type selector as Step 1:

1. **Select report type:** Orders Report / Returns Report / P&L Report / Settlement Report
2. **Select marketplace account** (Flipkart accounts only)
3. **Upload .xlsx** file
4. **Preview + import**

Each report type has its own parser and import logic.

### 1a. Orders Report Parser

**Source:** Flipkart Seller Hub → Orders → Download XLSX
**Frequency:** Daily
**Key columns (from the actual NuvioCentral export):**

| Column | Our field |
|--------|-----------|
| `order_id` | `platform_order_id` |
| `order_item_id` | `order_item_id` (strip `OI:` prefix, store numeric part) |
| `order_date` | `order_date` |
| `order_item_status` | `status` (map to OrderStatus) |
| `sku` | resolve via `sku_mappings` (strip `SKU:` prefix + quotes) |
| `quantity` | `quantity` |
| `fulfilment_type` | `fulfillment_type` |
| `dispatched_date` | `dispatch_date` (new column on orders) |
| `order_delivery_date` | `delivery_date` (new column) |
| `order_cancellation_date` | `cancellation_date` (new column) |
| `cancellation_reason` | `cancellation_reason` (new column) |
| `order_return_approval_date` | `return_request_date` (new column) |

**Status mapping:**

| Flipkart Status | Our OrderStatus |
|-----------------|-----------------|
| DELIVERED | delivered |
| RETURNED | returned |
| CANCELLED | cancelled |
| REJECTED | cancelled |
| RETURN_REQUESTED | returned |
| READY_TO_SHIP | dispatched |
| APPROVED | pending |
| APPROVAL_HOLD | pending |

**Upsert behavior:** Match on `(tenant_id, platform_order_id, order_item_id)`. If order exists (from P&L import), enrich with lifecycle dates. If new, insert.

**Order Item ID normalization:** The Orders report uses `OI:334916166497586101` format. Strip the `OI:` prefix to get the numeric ID. The P&L report already uses plain numeric `334916166497586101`. The Returns report also uses numeric. All stored as the normalized numeric string.

### 1b. Returns Report Parser

**Source:** Flipkart Seller Hub → Returns → Download XLSX
**Frequency:** Daily
**Key columns:**

| Column | Our field |
|--------|-----------|
| `Order ID` | match to `orders.platform_order_id` |
| `Order Item ID` | match to `orders.order_item_id` (numeric format, matches directly) |
| `Return Type` | `return_type`: `courier_return` → RTO, `customer_return` → RVP |
| `Return Requested Date` | `return_request_date` (on orders, update if not set) |
| `Completed Date` | `return_complete_date` (new column on orders) |
| `Return Status` | `return_status` (new column: delivered/in_transit/lost/start) |
| `Return Reason` | `return_reason` (new column) |
| `Return Sub-reason` | `return_sub_reason` (new column) |

**Upsert behavior:** Find matching order by `(platform_order_id)` OR `(order_item_id)`. Update return fields. If no matching order exists, create one with status=returned.

**No dual-write to `returns` table in v1.** The existing `returns` table has a CHECK constraint with values `customer`/`logistics`/`cancellation` that don't match the new `rto`/`rvp` terminology. Keep return detail columns on `orders` only. The `returns` table can be aligned later when we build the Returns & Grading module (Phase 3).

### 1c. P&L Report Parser (existing — no changes)

Already implemented. Imports from "Orders P&L" sheet with fee breakdown.

### 1d. Settlement Report Parser (NEW — 4th report type)

**Source:** Flipkart Seller Hub → Payments → Settlement Report → Download XLSX
**Frequency:** Monthly
**Format:** Multi-sheet XLSX. We import from "Orders" sheet (multi-row headers like P&L).

**Key columns (76 total, from actual NuvioCentral export):**

| Column | Our field |
|--------|-----------|
| NEFT ID (col 0) | `neft_id` (on new `order_settlements` table) |
| Payment Date (col 2) | `settlement_date` (NEW column on orders) |
| Bank Settlement Value (col 3) | `bank_settlement_value` |
| Order ID (col 7) | match to `orders.platform_order_id` |
| Order Item ID (col 8) | match to `orders.order_item_id` (numeric) |
| Sale Amount (col 9) | cross-check with existing |
| Marketplace Fee (col 13) | cross-check with existing |
| Order Date (col 55) | cross-check |
| Dispatch Date (col 56) | `dispatch_date` enrichment |
| Seller SKU (col 58) | SKU reference |
| Return Type (col 62) | `return_type` enrichment |

**What this gives us that nothing else does:**
- **Actual bank deposit date** per order (the `Payment Date` column)
- **NEFT ID** for bank reconciliation
- **Order-to-payment days** = Payment Date - Order Date (avg 18.9 days from real data)

**Upsert behavior:** Match on `(platform_order_id, order_item_id)`. Update `settlement_date` and `neft_id` directly on `orders` table. No separate `order_settlements` table in v1 — keep it flat. Bank reconciliation features can add a dedicated table later.

**Real data stats (Nov 2025 NuvioCentral):**
- 1,785 rows, 12 unique NEFT payments
- Avg order-to-payment: 18.9 days (median 17, range 10-63)
- 3 files available: Oct, Nov, Dec 2025

---

## 3. Schema Changes

### 2a. `orders` table — new lifecycle columns

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispatch_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_request_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_complete_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_type TEXT;       -- 'rto' | 'rvp'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_status TEXT;     -- 'delivered' | 'in_transit' | 'lost'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS return_sub_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_date DATE;  -- actual bank deposit date (from Settlement Report)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS neft_id TEXT;           -- bank transaction reference
```

### 2b. `monthly_overheads` table — new

```sql
CREATE TABLE monthly_overheads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  month TEXT NOT NULL,             -- 'YYYY-MM' format
  category TEXT NOT NULL,          -- 'salary' | 'rent' | 'software' | 'marketing' | 'other'
  name TEXT NOT NULL,              -- e.g., 'Team CTC', 'Warehouse GGN'
  amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE monthly_overheads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON monthly_overheads
  FOR ALL USING (tenant_id IN (
    SELECT user_profiles.tenant_id FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE INDEX idx_monthly_overheads_month ON monthly_overheads(tenant_id, month);
```

### 2c. TypeScript types

Add to `database.ts`:
```typescript
export type OverheadCategory = 'salary' | 'rent' | 'software' | 'marketing' | 'other'

export interface MonthlyOverhead {
  id: string
  tenant_id: string
  month: string
  category: OverheadCategory
  name: string
  amount: number
  created_at: string
  updated_at: string
}
```

Expand `Order` interface with new lifecycle columns.

---

## 3. Monthly Overheads UI

### Where: P&L page, accessible via "Monthly Overheads" button in header

**Dialog/Sheet** with:
- Month selector (defaults to currently selected month on P&L page)
- "Copy from previous month" button (copies all line items from prior month)
- Table: Category dropdown | Name (text) | Amount (number) | Delete button
- "Add Item" button at bottom
- Total row showing sum
- Save button

**Categories** (dropdown options): Salary, Rent, Software, Marketing, Other

**Persistence:** CRUD API at `/api/pnl/overheads`. Each line item is a row in `monthly_overheads`.

---

## 4. Complete P&L Calculation

### Updated Overview tab waterfall

```
Revenue                          ₹84,689
- Platform Fees                  ₹8,529
- Seller Offers                  ₹0
- Logistics                     ₹11,998
- COGS                          ₹30,844
- GST (recoverable)             ₹X
- TCS+TDS (withheld)            ₹Y
+ Benefits                      ₹Z
= Contribution Margin           ₹30,063    (35.5%)
- Monthly Overheads              ₹1,73,000
= Operating Profit              -₹1,42,937  (LOSS)
```

Waterfall adds 2 bars at the end: **Overheads** (red) → **Operating Profit** (green/red).

### Summary cards update

Replace "Contribution Margin" card with two:
- **Contribution Margin** — variable profit
- **Operating Profit** — after fixed costs (the real answer)

Or show 7 cards if space allows. On mobile, the most important ones are: Revenue, Operating Profit, Margin.

### Break-even indicator

Below summary cards, a progress bar:
```
Break-even: ₹30,063 / ₹1,73,000 (17.4%)
[████░░░░░░░░░░░░░░░░░░░░] You need ₹1,42,937 more contribution margin.
```

This tells the seller exactly where they stand mid-month.

---

## 5. Recovery Metrics (Products Tab)

### New columns in Products table

| Column | Formula | Meaning |
|--------|---------|---------|
| **All-in Cost** | COGS + avg(abs(fees + logistics)) per unit + return_cost_per_unit | Total cost to sell 1 unit including return probability |
| **Net Settlement/unit** | avg(amount_settled) per delivered unit | What actually hits bank per unit |
| **Recovery Rounds** | All-in Cost / Net Settlement per unit | How many sales to get your money back |
| **Order-to-Payment** | avg(settlement_date - order_date) per SKU | Days until money hits bank (from Settlement Report, avg 18.9 days) |
| **Cash Cycle** | order_to_payment_days + (return_rate × avg_return_days) | Total days your cash is locked per sale |
| **RTO Rate** | courier_returns / gross_orders | Delivery failure rate |
| **RVP Rate** | customer_returns / gross_orders | Customer return rate |
| **Cancel Rate** | cancellations / gross_orders | Pre-dispatch cancellation rate |

### Expanded row: Return Analysis section

Below the existing fee + COGS breakdown, add a "Returns" section:

```
Returns Analysis
  RTO (Logistics Returns): 11 (21%)     Avg return time: 12 days
  RVP (Customer Returns):  3 (5.7%)     Avg return time: 18 days
  Cancellations:           7 (13.2%)

  Top RTO Reasons: Undeliverable address (5), Customer unavailable (4), Refused (2)
  Top RVP Reasons: Not as described (2), Quality issue (1)
```

### Data source

Recovery metrics are computed from:
- `order_financials` for settlement data (already imported from P&L report)
- `orders` lifecycle dates (from Orders report import)
- Return type + dates (from Returns report import)

If Orders/Returns report not yet imported for a SKU, show "—" for lifecycle metrics.

---

## 6. Insights Tab — New Categories

### Category 4: Cash Traps (purple badge)
- **Trigger:** Recovery Rounds > 2 AND total revenue > ₹1,000
- **Title:** "₹X locked up in {SKU Name}"
- **Description:** "This SKU needs {rounds} selling cycles to recover your investment. Cash is locked for ~{days} days per sale."
- **Actions:** "Raise selling price" | "Negotiate lower COGS" | "Reduce returns"

### Category 5: Break-Even Alert (red badge, one per month)
- **Trigger:** Total contribution margin < total monthly overheads
- **Title:** "₹X short of break-even this month"
- **Description:** "Your contribution margin (₹X) doesn't cover monthly overheads (₹Y). You need Z more orders at current margins, or ₹W more revenue."
- **Actions:** "Review overhead costs" | "Focus on high-margin SKUs" | "Increase order volume"

### Category 6: Return Pattern Alerts (orange badge)
- **Trigger:** RTO rate > 30% OR RVP rate > 15% for a SKU
- **Title:** "{SKU} has high {RTO/RVP} rate"
- **Description:** Separate messaging for RTO vs RVP since they have different causes.
  - RTO: "X% of orders couldn't be delivered. Check serviceability and address validation."
  - RVP: "X% of customers returned this product. Top reason: {reason}. Check listing accuracy."
- **Actions:** RTO-specific or RVP-specific suggestions

---

## 7. API Endpoints

### New
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/pnl/import-orders` | Import Flipkart Orders report |
| POST | `/api/pnl/import-returns` | Import Flipkart Returns report |
| POST | `/api/pnl/import-settlement` | Import Flipkart Settlement report |
| | | |
| GET | `/api/pnl/overheads` | Get monthly overheads for a month |
| POST | `/api/pnl/overheads` | Create/update overhead line items |
| DELETE | `/api/pnl/overheads/[id]` | Delete overhead line item |
| POST | `/api/pnl/overheads/copy` | Copy overheads from one month to another |

### Modified
| Method | Path | Change |
|--------|------|--------|
| GET | `/api/pnl/dashboard` | Include overheads total, operating profit, break-even data, recovery metrics |
| GET | `/api/pnl/summary` | Include RTO/RVP/Cancel rates per SKU, lifecycle metrics |

---

## 8. New Files

| File | Purpose |
|------|---------|
| `src/lib/importers/orders-report-parser.ts` | Parse Flipkart Orders XLSX |
| `src/lib/importers/orders-report-server.ts` | Import Orders report to DB |
| `src/lib/importers/returns-report-parser.ts` | Parse Flipkart Returns XLSX |
| `src/lib/importers/returns-report-server.ts` | Import Returns report to DB |
| `src/lib/importers/settlement-report-parser.ts` | Parse Flipkart Settlement XLSX |
| `src/lib/importers/settlement-report-server.ts` | Import Settlement report to DB |
| `src/lib/pnl/recovery.ts` | Recovery metrics computation (rounds, cash cycle) |
| `src/app/api/pnl/import-orders/route.ts` | Orders import API |
| `src/app/api/pnl/import-returns/route.ts` | Returns import API |
| `src/app/api/pnl/import-settlement/route.ts` | Settlement import API |
| `src/app/api/pnl/overheads/route.ts` | Overheads CRUD |
| `src/app/api/pnl/overheads/[id]/route.ts` | Delete overhead |
| `src/app/api/pnl/overheads/copy/route.ts` | Copy overheads between months |
| `src/components/pnl/OverheadsDialog.tsx` | Monthly overheads entry UI |
| `src/components/pnl/BreakEvenBar.tsx` | Break-even progress bar |
| `src/components/pnl/ReturnAnalysis.tsx` | RTO/RVP breakdown in expanded row |

### Modified files
| File | Change |
|------|--------|
| `src/types/database.ts` | Add MonthlyOverhead, expand Order with lifecycle columns |
| `src/app/(dashboard)/pnl/page.tsx` | Add Overheads button, break-even bar, operating profit card |
| `src/components/pnl/PnlImportDialog.tsx` | Add report type selector step |
| `src/components/pnl/PnlProductTable.tsx` | Add recovery + return columns |
| `src/components/pnl/PnlOverviewTab.tsx` | Extended waterfall (overheads + operating profit bars) |
| `src/components/pnl/WaterfallChart.tsx` | Support 2 additional bars |
| `src/lib/pnl/waterfall.ts` | Add overheads + operating profit to waterfall computation |
| `src/lib/pnl/insights.ts` | Add cash trap + break-even + return pattern categories |
| `src/app/api/pnl/dashboard/route.ts` | Include overheads, operating profit, recovery metrics |
| `src/app/api/pnl/summary/route.ts` | Include return breakdown per SKU |

---

## 9. Order Item ID Normalization

All 3 report types use different Order Item ID formats:
- **Orders report:** `OI:334916166497586101` → strip `OI:` → `334916166497586101`
- **Returns report:** `334916166497586101` (already numeric)
- **P&L report:** `334916166497586101` (already numeric)

All stored in `orders.order_item_id` as plain numeric string. During import, normalize by stripping `OI:` prefix if present.

Join priority: Match on `(platform_order_id, order_item_id)` first. Fall back to `(platform_order_id)` only if item ID doesn't match (handles edge cases).

---

## 10. Verification

### After Orders + Returns import:
1. Import NuvioCentral Jul-Dec 2025 Orders data (5,814 rows)
2. Import NuvioCentral Jul-Dec 2025 Returns data (2,229 rows)
3. Verify lifecycle dates populated: `SELECT COUNT(*) FROM orders WHERE delivery_date IS NOT NULL`
4. Verify return types: `SELECT return_type, COUNT(*) FROM orders WHERE return_type IS NOT NULL GROUP BY 1`
5. Verify RTO/RVP split matches source (73% RTO, 27% RVP)

### After overheads:
6. Enter monthly overhead for Feb 2026
7. Overview waterfall shows Overheads bar + Operating Profit
8. Break-even bar shows progress
9. Copy overheads to Jan → verify data appears

### After recovery metrics:
10. Products tab shows Recovery Rounds, Cash Cycle columns
11. Expanded row shows Return Analysis with RTO/RVP breakdown
12. Insights tab shows cash trap cards for SKUs with high recovery rounds
13. Break-even alert appears if contribution margin < overheads

### After Settlement import:
14. Import NuvioCentral Oct-Dec 2025 Settlement data (3 files)
15. Verify `settlement_date` populated on orders
16. Cash Flow tab shows real payment timeline (grouped by settlement_date, not order_date)
17. Order-to-Payment metric shows ~18.9 day average

---

## 11. Important Design Decisions

### GST/TCS/TDS Treatment — Formal vs Informal Purchases

GST treatment depends on whether purchases have proper GST invoices:

**Formal purchases** (`has_gst_invoice = true`):
- GST paid is **input credit** — recoverable. NOT a cost in P&L.
- GST charged by Flipkart on fees is also input credit.

**Informal/cash purchases** (`has_gst_invoice = false`):
- GST paid (if any) is an **actual cost** — not recoverable. IS a cost in P&L.
- No input credit available.

**TCS (1%):** Withheld by Flipkart, adjustable against tax liability. Not a cost — cash flow item.
**TDS (1%):** Withheld by Flipkart, adjustable against income tax. Not a cost — cash flow item.

**Schema change:**
```sql
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS has_gst_invoice BOOLEAN DEFAULT true;
```

**P&L calculation:**
```
Revenue
- Platform Fees (ex-GST, since GST on fees = input credit)
- Seller Offers
- Logistics (ex-GST)
- COGS (formal: ex-GST. Informal: inclusive of GST since no credit)
+ Benefits
= Contribution Margin

- Monthly Overheads
= Operating Profit
```

**Separate "Tax & Cash Flow" section on Cash Flow tab:**
```
Tax Credits Available (not yet filed):
  GST Input Credit (formal purchases + FK fees)     ₹X
  TCS Balance (adjustable)                           ₹Y
  TDS Balance (adjustable)                           ₹Z
  Total capital locked in tax                        ₹X+Y+Z

Non-recoverable tax (informal purchases):           ₹W
```

This tells the seller: "You have ₹X+Y+Z temporarily locked up in tax credits. File your GST return to unlock ₹X. ₹W is a real cost because those purchases had no GST invoice."

**Purchases UI change:** Add a toggle/checkbox "Has GST invoice?" in the purchases import and manual add flows. Default: true (most purchases are formal).

### Per-Account Overhead Allocation

Monthly overheads are tracked at the tenant level (all accounts combined). Operating Profit is only meaningful in aggregate. When viewing By Account or By Channel, show **Contribution Margin** (no overhead allocation). The aggregate view shows Operating Profit.

### Unique Constraint for Upsert

The `orders` table already has `UNIQUE(tenant_id, platform_order_id, order_item_id)` (added in P&L v1 migration). All 4 importers upsert against this constraint.

---

## 12. Returns Intelligence

Returns are the #1 profit killer for Indian ecommerce sellers. Most sellers look at "return rate" as a single number. We break it into actionable intelligence.

### 12.1 Cost of a Single Return (per SKU)

Computed automatically from existing data:

```
Cost of 1 RTO (logistics return):
  Forward Shipping Fee (paid, wasted)
  + Reverse Shipping Fee (paid)
  + Packaging cost (wasted)
  + Capital lock-up cost (COGS × avg RTO return days / 365 × cost of capital)
  = Total RTO Cost

Cost of 1 RVP (customer return):
  Forward Shipping Fee (paid, wasted)
  + Reverse Shipping Fee (paid)
  + Packaging cost (wasted)
  + Product shrinkage (shrinkage_rate × COGS — damaged/opened/unsellable)
  + Capital lock-up cost
  = Total RVP Cost

Cost of 1 Cancellation:
  = ₹0 direct cost (not dispatched)
  BUT: opportunity cost (slot wasted, could have sold to someone else)
```

**Monthly "Return Tax"** = (RTO count × RTO cost) + (RVP count × RVP cost) — shown on Overview tab.

### 12.2 Return Reason Mining

The Returns Report has `Return Reason` + `Return Sub-reason`. We categorize and surface:

| Reason Category | What it means | What to do |
|----------------|---------------|------------|
| "Product not as described" | **Listing problem** | Fix images, description, specifications |
| "Quality not as expected" | **Supplier problem** | Change supplier or QC process |
| "Wrong product delivered" | **Warehouse picking error** | Fix picking process, better labeling |
| "Better price available" | **Pricing problem** | Competitive pricing analysis |
| "No longer needed" | **Impulse buy** | Unavoidable — factor into return rate |
| "Damaged in transit" | **Packaging problem** | Better packaging for this SKU |

**Per-SKU return reason breakdown** in expanded row:
```
Top Return Reasons for "Fighter Plane":
  1. "Product not as described" — 23 returns (41%)  → Fix listing
  2. "Quality not as expected" — 15 returns (27%)   → Check supplier batch
  3. "No longer needed" — 12 returns (21%)           → Normal
```

**Insight card:** "41% of Fighter Plane returns say 'not as described'. Your listing may be inaccurate — check product images and specs."

### 12.3 RTO vs RVP Deep Dive

**RTO Analysis (courier returns — delivery failures):**
- RTO by payment mode: COD vs Prepaid — if COD RTO >> Prepaid RTO, customer isn't committed
- RTO trend over time — is it getting worse?
- Insight: "67% of RTOs are COD orders. Consider increasing prepaid incentives or restricting COD for low-value items."

**RVP Analysis (customer returns — product rejections):**
- RVP by reason — what's driving customer dissatisfaction?
- RVP rate change vs last month — early warning
- Insight: "RVP rate on 'Blawless Trimmer' jumped from 12% to 23% this month. Check if recent batch has quality issues."

### 12.4 Return Timeline & Capital Impact

From Orders + Returns report dates:

| Metric | How computed | Why it matters |
|--------|-------------|----------------|
| Avg days: order → delivery | `delivery_date - order_date` | How fast customer gets it |
| Avg days: delivery → return request | `return_request_date - delivery_date` | How fast customer decides to return |
| Avg days: return request → return received | `return_complete_date - return_request_date` | How long return is in transit |
| Total return cycle | `return_complete_date - order_date` | Total days capital is locked for a returned order |
| Capital locked in returns | Count of open returns × COGS per unit | Money tied up in return pipeline right now |

**Cash Flow tab addition:** Card showing "₹X locked in Y returns currently in transit"

### 12.5 Return Trends (with multi-month data)

With 6+ months of data, compute monthly trends:
- RTO rate trending up/down per SKU
- RVP rate trending up/down per SKU
- Seasonal patterns: "Returns spike in December (gifting season returns in January)"
- New SKU early warning: "New SKU 'XYZ' launched 2 weeks ago — return rate already at 45%. Investigate before scaling."

**Insight card:** "Fighter Plane RTO rate went from 18% (Oct) → 24% (Nov) → 31% (Dec). Worsening trend. Investigate delivery coverage."

### 12.6 Return Insights (auto-generated)

These feed into the Insights tab and Action Dashboard:

| Insight | Trigger | Suggested Action |
|---------|---------|-----------------|
| "Listing mismatch" | >30% of returns cite "not as described" | "Update product images and description" |
| "Quality alert" | >20% cite "quality not as expected" AND recent spike | "Check recent supplier batch" |
| "Packaging problem" | >15% cite "damaged in transit" | "Upgrade packaging for this SKU" |
| "COD problem" | RTO rate on COD >50% for a SKU | "Restrict COD or add prepaid discount" |
| "Worsening returns" | Return rate increased >10pp month-over-month | "Investigate — something changed" |
| "Return cost exceeds margin" | Cost of returns per unit > contribution margin per unit | "This SKU loses money on every return. Stop or fix." |

---

### 12.7 Orders Report Intelligence

**Dispatch Performance:**
- Avg dispatch time (order_date → dispatched_date) per SKU
- Dispatch SLA breach rate (`dispatch_sla_breached` column)
- Insight: "You breached dispatch SLA on 15% of orders last week. Late dispatch → late delivery → higher RTO."

**Delivery Performance:**
- Avg delivery time (dispatched_date → delivery_date) per SKU
- Delivery SLA breach rate
- Insight: "Avg delivery takes 5.2 days for Fighter Plane vs 3.1 days for Trimmer. Longer delivery = higher RTO risk."

**Cancellation Analysis:**
- Seller cancellations vs customer cancellations (from `cancellation_reason`)
- Revenue lost to cancellations = cancelled_qty × selling_price
- Insight: "You cancelled 42 orders yourself last month (stock-outs). That's ₹18,400 in lost revenue. Check reorder points."

**SKU Velocity:**
- Orders per day per SKU — which products sell fastest?
- Reorder signal: "At current velocity, you'll run out of Fighter Plane stock in 8 days. Reorder now."

### 12.8 P&L Report Intelligence

**Fee Efficiency per SKU:**
- Fee-to-revenue ratio = total platform fees / revenue per SKU
- Insight: "Fighter Plane has 10% fee ratio. Foldable Sunglass has 7%. Sunglass is more fee-efficient."

**Channel Comparison:**
- Same SKU on Flipkart vs Shopsy — which channel gives better margins?
- Insight: "Your Wand Massager earns 12% margin on Flipkart but 18% on Shopsy (lower fees)."

**Offer Burn ROI:**
- Seller offer burn vs incremental volume: are discounts driving extra sales?
- Insight: "You spent ₹2,400 on offers last month. Revenue from offer orders: ₹8,200. ROI: 3.4x — worth it."

### 12.9 Settlement Report Intelligence

**Payment Pattern Analysis:**
- Avg settlement frequency (how often does Flipkart pay?)
- Settlement delay detection: orders settled later than usual
- Insight: "Flipkart usually settles in 12 batches/month. Last month only 10. Check for delayed payments."

**Negative Settlements (Clawbacks):**
- Flag orders with negative `bank_settlement_value` — Flipkart took money back
- Insight: "Flipkart clawed back ₹3,200 across 5 orders. Reasons: return adjustments. Verify these are legitimate."

**Payment Mode Efficiency:**
- COD vs Prepaid settlement speed
- Insight: "Prepaid orders settle in avg 14 days. COD in avg 21 days. Push prepaid to improve cash flow."

### 12.10 Cross-Report Intelligence (Combining All Data)

**Complete Order Lifecycle:**
```
Order placed (Orders Report)
  → Dispatched (Orders Report: dispatched_date)  [X days]
  → Delivered (Orders Report: delivery_date)      [Y days]
  → Settled (Settlement Report: settlement_date)  [Z days]
  Total cash cycle: X + Y + Z days
```

**Lost Revenue Calculator:**
```
Revenue you DIDN'T earn this month:
  Cancelled orders (your fault — stock-outs):     ₹X  (fixable!)
  Cancelled orders (customer fault):              ₹Y  (not fixable)
  Returned orders (RTO — delivery failure):       ₹Z  (partially fixable)
  Returned orders (RVP — product issue):          ₹W  (fixable!)
  Total missed revenue:                           ₹X+Y+Z+W
  Fixable portion:                                ₹X+Z+W
```

**Profitability Trajectory:**
- With multi-month data: "Your contribution margin improved from 28% → 32% → 35.5% over 3 months. At this rate, you'll cover overheads by Month 8."
- Or: "Your margins are declining. 35% → 31% → 28%. Main driver: rising return rates."

**Reorder Intelligence:**
- Current stock (purchases - dispatches) × days of stock at current velocity
- "Fighter Plane: 45 units left, selling 8/day = 5.6 days of stock. Reorder NOW."
- "Nail Gun Kit: 200 units left, selling 0.3/day = 666 days of stock. DEAD STOCK — stop buying."

---

## 13. Decision-Ready Features (Making Noobs Decide Like Pros)

### 12a. Plain English Verdicts per SKU

Add a "Verdict" column to the Products table — auto-computed, not manual:

| Verdict | Criteria | Color |
|---------|----------|-------|
| **Star Performer — increase stock** | margin >20%, return rate <30%, recovery rounds <2 | Green |
| **Healthy** | margin 10-20%, return rate <40% | Light green |
| **Watch — thin margins** | margin 0-10% | Yellow |
| **Reduce — returns eating profit** | return rate >40% regardless of margin | Orange |
| **Stop — losing money** | negative contribution margin | Red |
| **Cash Trap — locks too much capital** | margin >0% but recovery rounds >3 | Purple |

Show as a colored badge in the first column, next to the product name. Tooltip explains why.

### 12b. Inventory Capital Tracking

**Formula:**
```
Stock on hand = purchased_qty - dispatched_qty (from existing purchases + dispatches tables)
Inventory Capital = stock_on_hand × COGS per unit
```

**Where it shows:**
- Cash Flow tab: summary card "₹X locked in unsold inventory across Y SKUs"
- Products table: "Stock Value" column showing capital tied up per SKU
- Insights: "₹X of your capital is sitting in slow-moving inventory" for SKUs with >60 days stock

### 12c. Action Dashboard — "What to Do Today"

A **prominent section above the tabs** (below summary cards, above tab bar). Not charts — plain English action items generated from insights:

```
📋 Actions for You (3 items)

🔴 Stop selling "Nail Gun Kit" — lost ₹256 last month, 100% returns.
   [Archive this SKU]

💰 ₹12,400 in GST input credit available — file your return to unlock it.

⚠️ 3 orders (₹4,200) pending settlement for 20+ days — follow up with Flipkart.
   [View pending orders]
```

**Generation logic:** Same insights engine, but filtered to top 3-5 most impactful items and presented as imperative sentences with action buttons. Each action links to the relevant section (archive SKU → catalog, view pending → Cash Flow tab, etc.).

**Priority order:**
1. Stop-selling alerts (direct losses)
2. Cash recovery actions (pending settlements, GST filing)
3. Inventory warnings (overstocked, dead stock)
4. Optimization opportunities (price adjustments, return rate improvements)

---

## 13. Implementation Phasing

**Sub-phase A (do first — unlocks historical data + return analysis):**
- Schema migration (new columns on orders)
- Orders Report importer + Returns Report importer
- Recovery metrics computation
- Products tab: recovery columns + Return Analysis expanded row
- Import dialog: report type selector

**Sub-phase B (second — unlocks real cash flow):**
- Settlement Report importer
- Cash Flow tab update to use settlement_date
- Order-to-Payment and Cash Cycle metrics

**Sub-phase C (third — completes the P&L):**
- Monthly overheads table + CRUD + UI
- Operating Profit calculation + waterfall extension
- Break-even bar
- `has_gst_invoice` flag on purchases + GST/tax capital tracking on Cash Flow tab

**Sub-phase D (fourth — decision engine):**
- Plain English verdicts per SKU (auto-computed badge)
- Inventory capital tracking (stock value per SKU + total locked)
- Action Dashboard ("What to do today" — top 5 imperative actions above tabs)
- New insight categories (cash traps, break-even, return patterns, inventory warnings)
