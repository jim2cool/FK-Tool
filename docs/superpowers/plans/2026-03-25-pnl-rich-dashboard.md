# P&L Rich Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the P&L page from a basic table view into a rich 4-tab dashboard with waterfall chart, cash flow tracking, MoM deltas, and actionable insights.

**Architecture:** 4-tab page (Overview/Products/Cash Flow/Insights) powered by a single dashboard API endpoint that returns waterfall data, MoM deltas, cash flow, and insight cards. Summary cards stay above tabs. Products tab consolidates 3 table components into 1 with a groupBy dropdown.

**Tech Stack:** Next.js 16, Recharts (already installed), Supabase, shadcn/ui, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-25-pnl-rich-dashboard-design.md`

---

## Phase 1: DB Migration + Backend

### Task 1.1: DB Migrations

**Files:** None (Supabase MCP migrations)

- [ ] Apply migration `add_threshold_value_to_anomaly_rules`:
  ```sql
  ALTER TABLE pnl_anomaly_rules ADD COLUMN IF NOT EXISTS threshold_value NUMERIC;
  ```

- [ ] Apply migration `create_dismissed_insights`:
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

- [ ] Update `src/types/database.ts` — add `DismissedInsight` interface, add `threshold_value: number | null` to `PnlAnomalyRule`

- [ ] Verify: `npx tsc --noEmit`

### Task 1.2: Create waterfall computation

**Files:**
- Create: `src/lib/pnl/waterfall.ts`

- [ ] Export `WaterfallData` interface:
  ```typescript
  export interface WaterfallData {
    revenue: number          // absolute positive
    platform_fees: number    // absolute positive
    seller_offers: number    // absolute positive
    logistics: number        // absolute positive
    cogs: number             // absolute positive
    gst: number              // absolute positive
    tcs_tds: number          // absolute positive
    benefits: number         // absolute positive
    true_profit: number      // signed
  }
  ```

- [ ] Export `MomDeltas` interface:
  ```typescript
  export interface MomDeltas {
    revenue_pct: number | null
    cogs_pct: number | null
    platform_fees_pct: number | null
    logistics_pct: number | null
    true_profit_pct: number | null
    margin_delta: number | null  // signed pp change
  }
  ```

- [ ] Implement `computeWaterfall(rows: PnlBreakdown[]): WaterfallData` — aggregate fee_details across all rows, convert to absolute values. Use `fee_details.commission_fee + collection_fee + fixed_fee + offer_adjustments` for platform_fees (all stored as negative, take abs). `seller_offer_burn` separate. `tax_gst` separate from `tax_tcs + tax_tds`.

- [ ] Implement `computeMomDeltas(current: PnlSummary, prior: PnlSummary | null): MomDeltas` — percentage change for each metric. Return null values if prior is null.

- [ ] Verify: `npx tsc --noEmit`

### Task 1.3: Create insights engine

**Files:**
- Create: `src/lib/pnl/insights.ts`

- [ ] Export `PnlInsight` interface:
  ```typescript
  export interface PnlInsight {
    id: string              // deterministic: `{category}::{group_key}`
    category: 'money_loser' | 'return_alert' | 'fee_anomaly'
    title: string
    description: string
    metrics: Record<string, number | string>
    actions: string[]
    impact: number
  }
  ```

- [ ] Implement `generateInsights(rows: PnlBreakdown[], dismissedKeys: Set<string>, thresholds: { moneyLoserMargin: number; highReturnRate: number }): PnlInsight[]`
  - Money losers: rows where `true_profit < 0` or `margin_pct < threshold`. Determine cost driver (returns vs fees vs COGS). Compute break-even price increase.
  - Return alerts: rows where `return_rate > threshold`. Include RTO vs RVP split from fee_details.
  - Fee anomalies: rows where `anomaly_count > 0`. Show recoverable amount.
  - Filter out dismissed keys. Sort by impact descending.

- [ ] Verify: `npx tsc --noEmit`

### Task 1.4: Create dashboard API

**Files:**
- Create: `src/app/api/pnl/dashboard/route.ts`

- [ ] GET handler with params: `from`, `to`, `accountIds`
  1. `getTenantId()`, parse params
  2. Call `calculatePnl({ groupBy: 'product', from, to, ... })` for current period
  3. Compute prior month range, call `calculatePnl` for prior period
  4. `computeWaterfall(currentRows)` + `computeMomDeltas(currentSummary, priorSummary)`
  5. Derive top_profitable (top 3 profit), top_losing (top 3 loss), high_return (top 3 return rate)
  6. Cash flow: separate query joining orders + order_financials for per-order settlement data. Aggregate by order_date for timeline. Filter pending > 0 for pending_orders table (limit 100).
  7. Insights: fetch anomaly rules (for thresholds), fetch dismissed_insights, call `generateInsights()`
  8. Return full `PnlDashboardResponse`

- [ ] Verify: `npx tsc --noEmit`

### Task 1.5: Create dismiss API

**Files:**
- Create: `src/app/api/pnl/insights/dismiss/route.ts`

- [ ] POST handler: accept `{ insight_key: string }`, upsert into `dismissed_insights`

- [ ] Verify: `npx tsc --noEmit`

- [ ] Commit + push + deploy Phase 1

---

## Phase 2: Page Restructure + Summary Cards with MoM

### Task 2.1: Restructure page to 4 tabs

**Files:**
- Modify: `src/app/(dashboard)/pnl/page.tsx`

- [ ] Add dashboard API fetch alongside existing summary fetches:
  ```typescript
  const [dashboardData, setDashboardData] = useState<PnlDashboardResponse | null>(null)
  ```
  Fetch in the same `useEffect` as existing fetches (parallel).

- [ ] Enhance inline `SummaryCard` with optional `delta` prop:
  ```typescript
  function SummaryCard({ title, value, icon, delta, color }: {
    // ...existing props
    delta?: number | null
  })
  ```
  Render delta as green "↑ X%" / red "↓ X%" / gray "—"

- [ ] Move summary cards ABOVE `<Tabs>` (they're currently inside the `hasData` conditional — keep that, just put them before Tabs)

- [ ] Change tab values to `overview | products | cashflow | insights`. Default to `overview`.

- [ ] Tab content: Overview and CashFlow render placeholder "Loading..." for now (components built in Phases 3-4). Products renders `PnlProductTable`. Insights renders placeholder.

- [ ] Remove imports for `PnlChannelTable`, `PnlAccountTable`

### Task 2.2: Consolidate PnlProductTable with groupBy

**Files:**
- Modify: `src/components/pnl/PnlProductTable.tsx`

- [ ] Change props to accept all 3 row arrays:
  ```typescript
  interface Props {
    productRows: PnlBreakdown[]
    channelRows: PnlBreakdown[]
    accountRows: PnlBreakdown[]
  }
  ```

- [ ] Add local `groupBy` state with dropdown (`<select>` with Tailwind styling):
  Product | Channel | Account

- [ ] Switch displayed rows based on groupBy. Change first column header label. Hide `Exp. Profit/Dispatch` and COGS breakdown for non-product groupings.

### Task 2.3: Delete redundant files

- [ ] Delete `src/components/pnl/PnlChannelTable.tsx`
- [ ] Delete `src/components/pnl/PnlAccountTable.tsx`
- [ ] Delete `src/components/pnl/PnlSummaryCards.tsx`

- [ ] Verify: `npx tsc --noEmit`
- [ ] Commit + push + deploy Phase 2

---

## Phase 3: Overview Tab — Waterfall + Top/Bottom SKUs

### Task 3.1: Create waterfall chart component

**Files:**
- Create: `src/components/pnl/WaterfallChart.tsx`

- [ ] Build Recharts waterfall using stacked BarChart:
  - Invisible base bar (transparent fill) + visible value bar
  - Transform `WaterfallData` into bar array with running totals
  - 9 bars: Revenue → Platform Fees → Seller Offers → Logistics → COGS → GST → TCS+TDS → Benefits → True Profit
  - Colors: green for revenue/benefits/profit(+), red for costs/profit(-), amber for GST
  - `<Tooltip>` showing amount + % of revenue
  - `<ResponsiveContainer>` for responsive sizing
  - INR formatting on Y-axis using `Intl.NumberFormat('en-IN')`

### Task 3.2: Create Overview tab component

**Files:**
- Create: `src/components/pnl/PnlOverviewTab.tsx`

- [ ] Props: `{ dashboardData: PnlDashboardResponse; onSwitchTab: (tab: string) => void }`

- [ ] Layout:
  1. `<WaterfallChart>` full width
  2. 3-column grid of mini cards: Top Profitable | Top Loss-Making | Highest Return Rates
  - Each card: title, 3 items (name + metric), clickable items call `onSwitchTab('products')`

- [ ] Wire into page.tsx — replace Overview placeholder with real component

- [ ] Verify: `npx tsc --noEmit`
- [ ] Commit + push + deploy Phase 3

---

## Phase 4: Cash Flow Tab

### Task 4.1: Create settlement chart

**Files:**
- Create: `src/components/pnl/SettlementChart.tsx`

- [ ] Recharts stacked BarChart:
  - Green bars: settled amount by date
  - Orange bars: pending amount by date
  - X-axis: dates (format as day number)
  - Y-axis: INR
  - `<Tooltip>`, `<Legend>`, `<ResponsiveContainer>`
  - Caption below: "Settlement status grouped by order date."

### Task 4.2: Create Cash Flow tab component

**Files:**
- Create: `src/components/pnl/PnlCashFlowTab.tsx`

- [ ] Props: `{ cashflow: PnlDashboardResponse['cashflow'] }`

- [ ] Layout:
  1. 3 summary cards: Settled (green) | Pending (orange) | Settlement Rate (%)
  2. Settlement chart
  3. Pending orders table (max 100, rows >14 days highlighted yellow)
  - Columns: Order Date | Order ID | SKU | Revenue | Projected | Pending | Days Since

- [ ] Wire into page.tsx

- [ ] Verify: `npx tsc --noEmit`
- [ ] Commit + push + deploy Phase 4

---

## Phase 5: Insights Tab + Dismiss

### Task 5.1: Create InsightCard component

**Files:**
- Create: `src/components/pnl/InsightCard.tsx`

- [ ] Props: `{ insight: PnlInsight; onDismiss: (key: string) => void; dismissing: boolean }`

- [ ] Layout:
  - Category badge (red/orange/yellow)
  - Title (bold) + description
  - Metrics row (2-3 key numbers)
  - Actions as muted text
  - Dismiss X button (top-right)

### Task 5.2: Create Insights tab component

**Files:**
- Create: `src/components/pnl/PnlInsightsTab.tsx`

- [ ] Props: `{ insights: PnlInsight[]; onDismiss: (key: string) => void }`

- [ ] Empty state: "No actionable insights right now. Your P&L looks healthy!"
- [ ] Otherwise: vertical stack of InsightCard components

### Task 5.3: Wire dismiss into page

- [ ] In page.tsx: dismiss handler calls `POST /api/pnl/insights/dismiss`, removes card from local state (optimistic update)

- [ ] Verify: `npx tsc --noEmit`
- [ ] Commit + push + deploy Phase 5

---

## Verification Checklist

After all phases deployed:

- [ ] Overview tab: waterfall shows ₹84,689 revenue flowing to ₹30,063 profit with all cost bars
- [ ] MoM deltas: show "—" for Feb (no Jan data). After importing Jan, deltas populate
- [ ] Top/Bottom cards: Fighter Plane in profitable, Small Wooden Piggy Bank in loss-making
- [ ] Products tab: groupBy dropdown switches Product/Channel/Account instantly
- [ ] Cash Flow: settled/pending totals match DB. Old pending orders highlighted
- [ ] Insights: red card for Small Wooden Piggy Bank (-4.3%). Orange cards for high-return SKUs
- [ ] Dismiss: click dismiss → card gone → stays gone on refresh

---

## Gotchas

1. **Recharts already installed** — no `npm install` needed
2. **Two `calculatePnl` calls for MoM** — current + prior month. Fine for 672 orders.
3. **Cash flow needs separate query** — `calculatePnl` aggregates away per-order dates
4. **Waterfall is not a native Recharts type** — build with invisible base segments in stacked BarChart
5. **Summary cards stay above tabs** — not inside Overview tab
6. **Products tab prefetches all 3 groupings** — dropdown switches display, no re-fetch
7. **Insight thresholds auto-seed** — follow anomaly rules auto-seed pattern
8. **`PnlSummaryCards.tsx` was never used** — page already has inline `SummaryCard`, safe to delete
