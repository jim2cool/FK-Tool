# P&L Rich Dashboard — Design Spec

> Enriches the existing P&L page with charts, cash flow tracking, and actionable insights.
> Date: 2026-03-25
> Depends on: P&L per SKU (implemented same day)

---

## Context

The P&L page currently shows summary cards and a sortable product table with fee breakdowns. While the data is correct, sellers need more than numbers — they need to understand where money goes (waterfall chart), track cash flow (pending settlements), see what changed month-over-month, and get actionable recommendations (stop selling money-losers, catch billing anomalies, flag high-return SKUs). This spec enriches the existing page without rebuilding it.

---

## 1. Page Structure

Replace the current 3-tab layout (By Product / By Channel / By Account) with **4 tabs**:

| Tab | Purpose |
|-----|---------|
| **Overview** | Summary cards with MoM deltas + waterfall chart + top/bottom SKUs |
| **Products** | Enhanced product table with groupBy dropdown (Product/Channel/Account) |
| **Cash Flow** | Settlement status by order date — pending vs settled + pending orders list |
| **Insights** | Actionable recommendation cards prioritized by money impact |

**Shared controls** (above tabs, same as now): Month picker, Account filter, Import P&L button, Anomaly Rules button.

---

## 2. Tab 1: Overview

### Summary Cards Row (above tabs — always visible, enhanced with MoM deltas)

Same 6 cards: Revenue | COGS | Platform Fees | Logistics | True Profit | Margin %
Cards stay **above the tab bar** (page-level, not inside Overview tab) so they're visible on every tab.

**New:** Each card shows a small delta badge vs the previous month:
- Green up arrow + "↑ 12%" if improved
- Red down arrow + "↓ 8%" if worsened
- Gray "—" if no prior month data

The Overview API computes both current and prior period aggregates.

### Revenue Waterfall Chart
- **Library:** Recharts (`npm install recharts`)
- **Type:** Custom waterfall using Recharts `BarChart` with invisible base segments
- **Sign convention:** All bars rendered as positive height. The chart handles direction — "decreasing" bars start from the previous bar's top and go down. The API returns absolute values with a `direction` field.
- **Bars (left to right):**
  1. **Revenue** (green) — starting value
  2. **Platform Fees** (red, decreasing) — commission + collection + fixed + offer adjustments
  3. **Seller Offers** (red, decreasing) — seller_offer_burn (seller-funded discounts/ads)
  4. **Logistics** (red, decreasing) — forward + reverse shipping + pick & pack
  5. **COGS** (red, decreasing) — total COGS for delivered units
  6. **GST** (amber, decreasing) — labeled "GST (recoverable)" since seller can claim input credit
  7. **TCS + TDS** (red, decreasing) — labeled "TCS+TDS (withheld)" — actual cash cost
  8. **Benefits** (green, increasing) — rewards + SPF payout
  9. **True Profit** (green if positive, red if negative) — final bar
- **Tooltip:** hover any bar to see exact amount and % of revenue
- **Responsive:** stacks vertically on mobile

### Top/Bottom SKUs Row (3 mini cards)
| Top 3 Profitable | Top 3 Loss-Making | Highest Return Rates |
|---|---|---|
| SKU name, profit, margin % | SKU name, loss, main cost driver | SKU name, return rate %, cost of returns |

Each item clickable → switches to Products tab filtered to that SKU.

---

## 3. Tab 2: Products

### Changes from current

**GroupBy toggle:** Replace the 3 sub-tabs (By Product / By Channel / By Account) with a single dropdown: `Group by: [Product ▼]` with options: Product, Channel, Account.

**Data prefetching:** Keep the current behavior of prefetching all 3 groupings on page load. The dropdown just selects which dataset to display — no re-fetch needed. This keeps tab switching instant.

**Remove:** `PnlChannelTable.tsx` and `PnlAccountTable.tsx` — the single `PnlProductTable.tsx` handles all groupings (columns are the same, just the row grouping differs).

**Keep everything else:** Sortable columns, expandable rows with fee + COGS breakdown, color-coded margins, anomaly badges, InfoTooltips.

---

## 4. Tab 3: Cash Flow

**Important note:** The Flipkart P&L XLSX does not include settlement dates (only `amount_settled` and `amount_pending` totals per order). The timeline chart groups by **order date**, not bank deposit date. This is clearly labeled.

### Summary Cards (3)
| Total Settled | Total Pending | Settlement Rate |
|---|---|---|
| Sum of `amount_settled` (green) | Sum of `amount_pending` (orange) | `settled / (settled + pending) × 100` as % |

### Settlement Status by Order Date (chart)
- **Type:** Recharts `BarChart` with daily aggregation
- **X-axis:** order dates within selected month
- **Y-axis:** amount (₹)
- **Two stacked series:** Settled (green) + Pending (orange)
- **Label:** "Settlement status grouped by order date. Actual bank deposit dates not tracked."
- **Data source:** aggregate `amount_settled` and `amount_pending` by `order_date`

### Pending Orders Table
- Filter: orders where `amount_pending > 0`
- Columns: Order Date | Order ID | SKU Name | Revenue | Projected | Pending | Days Since Order
- SKU name: join `orders → master_skus.name` (or `combo_products.name`). If unmapped, show "Unmapped: {platform_order_id}"
- Sorted by: Days Since Order descending (oldest pending first)
- Highlight rows where `days_since_order > 14` in yellow
- **Limit 100 rows** with "Show all" link for performance at scale

---

## 5. Tab 4: Insights

### Insight Card Design

**Each card has:**
- Category badge (color-coded: red / orange / yellow)
- Title + one-line explanation
- Key metrics (2-3 numbers)
- Suggested action(s)
- "Dismiss" button

**Dismissed insights** stored in DB: `dismissed_insights` table (tenant_id, insight_key, dismissed_by, dismissed_at). Not localStorage — learned from crop profiles migration.

```sql
CREATE TABLE dismissed_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  insight_key TEXT NOT NULL,
  dismissed_by UUID,
  dismissed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, insight_key)
);
ALTER TABLE dismissed_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON dismissed_insights
  FOR ALL USING (tenant_id IN (
    SELECT user_profiles.tenant_id FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));
```

### Configurable Thresholds

Insight thresholds stored in `pnl_insight_config` (or reuse `pnl_anomaly_rules` with extended rule_keys). Defaults:

| Threshold | Default | Why |
|-----------|---------|-----|
| Money loser margin | `< 0%` (actual loss) | 5% is too aggressive for Indian ecom where 8-15% margins are common |
| High return rate | `> 40%` | Reasonable for non-fashion. Fashion sellers should raise this. |

Configurable via the existing Anomaly Rules panel. Add a `threshold_value` column to `pnl_anomaly_rules`:

```sql
ALTER TABLE pnl_anomaly_rules ADD COLUMN IF NOT EXISTS threshold_value NUMERIC;
```

Insight rules use `threshold_value` for their trigger (e.g., `margin_pct < threshold_value`). Anomaly rules (existing 4) ignore it. Seed insight rules with defaults on first load.

### Category 1: Money Losers (red badge)
- **Trigger:** SKU where `true_profit < 0` (or below configured threshold)
- **Title:** "SKU X is losing ₹Y per unit"
- **Primary cost driver logic:**
  - If `return_rate > 0.4` → "High returns (X%) are the main cost"
  - Else if `abs(platform_fees + logistics) > total_cogs` → "Platform fees (₹X) exceed COGS (₹Y)"
  - Else → "COGS too high (₹X/unit vs ₹Y selling price)"
- **Actions:** "Raise price by ₹Z to break even" | "Consider discontinuing" | "Reduce COGS"

### Category 2: Return Rate Alerts (orange badge)
- **Trigger:** SKU where `return_rate` exceeds configured threshold
- **Title:** "SKU X has {rate}% return rate"
- **Metrics:** Return rate, RTO vs RVP split, Cost of returns
- **Actions:** "Check listing accuracy" | "Review packaging" | "Consider removing"

### Category 3: Fee Anomalies (yellow badge)
- **Trigger:** Orders with non-empty `anomaly_flags`
- **Title:** "₹X in potentially recoverable charges"
- **Metrics:** Total anomaly amount, affected orders, rule breakdown
- **Actions:** "Review flagged orders" | "File claim with Flipkart"

### Sorting
Cards sorted by **potential money impact** descending.

### Empty State
"No actionable insights right now. Your P&L looks healthy!"

---

## 6. API Design

### Single dashboard endpoint (recommended over 3 separate)

**`GET /api/pnl/dashboard`** — returns all data for Overview + Cash Flow + Insights in one response. Avoids 3 separate DB round-trips since they all query the same underlying tables.

Query params: `from`, `to`, `accountIds` (same as existing `/api/pnl/summary`)

```typescript
interface PnlDashboardResponse {
  // Overview
  waterfall: {
    revenue: number          // absolute, positive
    platform_fees: number    // absolute, positive (display as cost)
    seller_offers: number    // absolute, positive
    logistics: number        // absolute, positive
    cogs: number             // absolute, positive
    gst: number              // absolute, positive (label: recoverable)
    tcs_tds: number          // absolute, positive (label: withheld)
    benefits: number         // absolute, positive (add back)
    true_profit: number      // signed (positive = profit, negative = loss)
  }
  mom_deltas: {
    revenue_pct: number | null       // % change vs prior month
    cogs_pct: number | null
    platform_fees_pct: number | null
    logistics_pct: number | null
    true_profit_pct: number | null
    margin_delta: number | null      // signed pp change (positive = improved, negative = declined)
  }
  top_profitable: Array<{ name: string; profit: number; margin: number }>
  top_losing: Array<{ name: string; loss: number; driver: string }>
  high_return: Array<{ name: string; return_rate: number; cost: number }>

  // Cash Flow
  cashflow: {
    settled: number
    pending: number
    settlement_rate: number
    timeline: Array<{ date: string; settled: number; pending: number }>
    pending_orders: Array<{
      order_date: string
      platform_order_id: string
      sku_name: string
      revenue: number
      projected: number
      pending: number
      days_since: number
    }>
  }

  // Insights
  insights: Array<{
    id: string            // deterministic: `{category}::{sku_id}` — matches insight_key in dismissed_insights
    category: 'money_loser' | 'return_alert' | 'fee_anomaly'
    title: string
    description: string
    metrics: Record<string, number | string>
    actions: string[]
    impact: number
  }>
}
```

### Keep existing: `GET /api/pnl/summary`
Products tab continues to use this — no changes needed.

### New: `POST /api/pnl/insights/dismiss`
Dismiss an insight by key. Body: `{ insight_key: string }`

---

## 7. New Files

| File | Purpose |
|------|---------|
| `src/app/api/pnl/dashboard/route.ts` | Dashboard API (Overview + Cash Flow + Insights) |
| `src/app/api/pnl/insights/dismiss/route.ts` | Dismiss insight API |
| `src/lib/pnl/insights.ts` | Insight generation logic (triggers, cost drivers, actions) |
| `src/lib/pnl/waterfall.ts` | Waterfall data computation |
| `src/components/pnl/PnlOverviewTab.tsx` | Overview tab |
| `src/components/pnl/WaterfallChart.tsx` | Recharts waterfall chart |
| `src/components/pnl/PnlCashFlowTab.tsx` | Cash flow tab |
| `src/components/pnl/SettlementChart.tsx` | Settlement bar chart |
| `src/components/pnl/PnlInsightsTab.tsx` | Insights tab |
| `src/components/pnl/InsightCard.tsx` | Individual insight card |

### Modified files
| File | Change |
|------|--------|
| `src/app/(dashboard)/pnl/page.tsx` | Restructure to 4 tabs, fetch dashboard API |
| `src/components/pnl/PnlProductTable.tsx` | Add groupBy dropdown |

### Deleted files
| File | Reason |
|------|--------|
| `src/components/pnl/PnlChannelTable.tsx` | Consolidated into PnlProductTable with groupBy |
| `src/components/pnl/PnlAccountTable.tsx` | Same |
| `src/components/pnl/PnlSummaryCards.tsx` | Inlined into PnlOverviewTab (needs MoM deltas) |

---

## 8. DB Migration

```sql
CREATE TABLE dismissed_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  insight_key TEXT NOT NULL,
  dismissed_by UUID,
  dismissed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, insight_key)
);
ALTER TABLE dismissed_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON dismissed_insights
  FOR ALL USING (tenant_id IN (
    SELECT user_profiles.tenant_id FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));
```

---

## 9. Dependencies

**New:** `recharts` — `npm install recharts`

---

## 10. Verification

1. **Overview tab:** Waterfall shows ₹84,689 → ₹30,063 with all bars. Seller Offers bar visible. GST labeled "recoverable", TCS+TDS labeled "withheld".
2. **MoM deltas:** Show "—" for Feb (no January data yet). After importing Jan data, deltas should populate.
3. **Top/Bottom cards:** Small Wooden Piggy Bank appears in "Loss-Making" (margin -4.3%). Fighter Plane appears in "Top Profitable".
4. **Products tab:** GroupBy dropdown switches between Product/Channel/Account instantly (prefetched).
5. **Cash Flow tab:** Settled/Pending totals match sum from DB. Timeline chart renders by order date. Pending orders table shows oldest first.
6. **Insights tab:** Red card for Small Wooden Piggy Bank (losing money). Orange cards for high-return SKUs (Fighter Plane 56.6%, Cordless Drill 64.3%). Yellow cards if any anomalies detected.
7. **Dismiss insight:** Click dismiss → card disappears → stays dismissed on page reload (DB-backed).
8. **All tabs** respect month picker and account filter.
