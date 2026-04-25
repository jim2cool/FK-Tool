# Daily P&L Estimator v2 — Design Spec

**Date:** 2026-04-25
**Status:** Draft, awaiting review
**Depends on:** Bulk P&L Importer (separate spec, same date)

## Goal

Make the Daily P&L Estimator usable across multiple seller accounts in a single 5-minute workflow, with a consolidated cross-account view by default and per-account drill-down on demand. Source the P&L benchmark data from the main FK-Tool data layer (`order_financials`, populated via the Bulk P&L Importer) instead of the standalone `dp_pnl_history` table.

## What stays the same as v1

- Listing data: still uploaded per-account into `dp_listing` (rare changes)
- COGS data: still uploaded per-account into `dp_cogs` (rare changes)
- Orders: still uploaded fresh per day per-account into `dp_orders`
- All P&L formulas (already validated against the spec workbook to the rupee)
- The 3-tab results structure: Consolidated P&L / Order Detail / Return Costs
- Dispatch-day snapshot semantics — terminal-status overrides are still deferred

## What changes in v2

| Area | v1 | v2 |
|---|---|---|
| Account selector | Single dropdown | Multi-select with checkboxes |
| Workflow | Pick → upload → compute | **Two-step:** Configure → Submit → Per-account uploads & benchmark status revealed → Compute |
| Benchmark source | `dp_pnl_history` (uploaded into the Estimator itself) | `order_financials` (populated by Bulk P&L Importer in `/pnl`) |
| Benchmark window | "Whatever was last uploaded" | "Most recent 2 finalised months relative to today" — temporally aware |
| Benchmark gaps | Falls back to portfolio average silently | Surfaces explicitly per-account in a Benchmark Status card; offers inline link to Bulk Importer to fix |
| Results display | Single block for the one selected account | **Accordion stack**: Consolidated open at top, one collapsed per-account section below |

## Non-goals (deferred to future work)

- Folding `dp_orders` / `dp_listing` / `dp_cogs` into the main schema (separate effort, after backfill is complete)
- Cross-channel (Amazon, D2C) results — channel selector still locks to Flipkart in this iteration
- Editable benchmark window override per-product (e.g., "use only the last 1 month for this SKU"). Defer to v3.
- Replacing dispatch-day snapshot with terminal-status override. Still locked.
- Manual "this product behaves like Y" mappings for new-product proxy. v2 uses automatic similar-priced proxy only.

## Architecture

### High-level flow

```
1. User lands on /daily-pnl
2. Configuration card: pick channel + accounts (multi-select) + dispatch date range
3. Click [Submit]
4. Page expands:
   - Benchmark Status card (per-account check against order_financials)
   - Per-Account Upload sections (one per selected account)
5. User uploads Orders for each account (and Listing/COGS if needed)
6. Click [Compute]
7. Results render as an accordion:
   - "Consolidated" section pinned at top, expanded by default
   - One collapsed section per selected account below
```

### Component structure

```
src/app/(dashboard)/daily-pnl/page.tsx           (rewrites the v1 page)
src/components/daily-pnl/
  ChannelAccountSelector.tsx                     (UPDATED — multi-select accounts)
  ConfigurationCard.tsx                          (NEW — wraps channel + accounts + date + Submit)
  BenchmarkStatusCard.tsx                        (NEW — per-account benchmark availability)
  PerAccountUploadSection.tsx                    (NEW — one per selected account)
  ResultsAccordion.tsx                           (NEW — replaces the v1 single ResultsTabs render)
  ResultsTabs.tsx                                (UNCHANGED — reused inside each accordion section)
  UploadPanel.tsx                                (UPDATED — now embedded inside PerAccountUploadSection)
```

### API changes

#### NEW: `GET /api/daily-pnl/benchmark-status`

**Query params:**
- `marketplace_account_ids`: comma-separated UUIDs
- `dispatch_from`, `dispatch_to`: YYYY-MM-DD range

**Response:**
```typescript
{
  benchmark_window: {
    from: string             // YYYY-MM-DD — start of recommended benchmark range
    to: string               // YYYY-MM-DD — end (= last day of latest finalised month)
    months_label: string     // e.g., "Feb–Mar 2026"
    rationale: string        // e.g., "Today is Apr 25. Most recent finalised P&L = Mar (20-day lag rule). Recommended window = previous 2 finalised months."
  }
  per_account: Array<{
    marketplace_account_id: string
    account_name: string
    available_months: string[]              // ["2026-02", "2026-03"]
    missing_months: string[]                // [] or ["2026-02"]
    rows_in_window: number                  // count of order_financials rows in benchmark window
    status: 'full' | 'partial' | 'none'
    fallback_strategy?: 'similar_priced' | 'portfolio_average' | null
  }>
}
```

**Behavior:**
- Compute benchmark window = previous 2 finalised months, where "finalised" = `month_end + 20 days <= today`. (Configurable lag in `src/lib/daily-pnl/benchmark-window.ts`.)
- For each requested account, query `order_financials` joined to `orders` (filter by `marketplace_account_id` + `tenant_id`) and bucket by `order_date` month.
- Compare against the benchmark window months. Compute `available_months`, `missing_months`, `rows_in_window`, `status`.
- `status`:
  - `full` if all benchmark months are present with non-zero rows
  - `partial` if some months are present
  - `none` if zero rows in window
- `fallback_strategy` is set when `status != full`:
  - `similar_priced` if `none` (uses similar-priced products from accounts that DO have history)
  - `portfolio_average` if `partial` (mixed quality, fall back to portfolio for missing slices — this is the existing v1 behavior, not a new ML hop)

#### UPDATED: `GET /api/daily-pnl/results`

**Query params (changed):**
- `marketplace_account_ids`: comma-separated UUIDs (was singular in v1)
- `from`, `to`: dispatch date range

**Response (changed shape):**
```typescript
{
  benchmark_window: { from: string; to: string; months_label: string }
  consolidated: ResultsResponse                 // aggregated across all selected accounts
  per_account: Array<{
    marketplace_account_id: string
    account_name: string
    results: ResultsResponse
  }>
}
```

`ResultsResponse` itself is unchanged — same `consolidated`, `order_detail`, `return_costs`, `unmapped_skus`, etc.

**Computation:**
- Fetch dp_orders for all selected accounts (single query, `WHERE marketplace_account_id IN (...)`)
- Fetch dp_listing rows for selected accounts (single query)
- Fetch dp_cogs rows for selected accounts (single query)
- **Fetch P&L benchmark from `order_financials` joined to `orders`**, scoped to selected accounts, where `order_date BETWEEN benchmark_window.from AND benchmark_window.to`
- Build the cogs/listing/history maps — keys are `(account_id, sku.lowercase())` to keep accounts isolated even when SKU strings collide across accounts
- For per-account computation: run the v1 logic per account on the slice of data for that account
- For consolidated computation: same logic but with all per-account data pooled before aggregation, grouping by `master_product` only (account is collapsed)

#### NEW: similar-priced product proxy

Add `src/lib/daily-pnl/similar-price-proxy.ts`:

```typescript
function findSimilarPricedProxy(
  targetProduct: { master_product: string; avg_bank_settlement: number },
  candidates: Array<{ master_product: string; avg_bank_settlement: number; delivery_rate: number; est_return_cost_per_dispatched_unit: number }>
): { delivery_rate: number; est_return_cost_per_dispatched_unit: number; proxy_master_product: string } | null
```

**Algorithm:**
1. Filter candidates to those with non-null `delivery_rate` and `est_return_cost_per_dispatched_unit`.
2. Compute `|target_settlement - candidate_settlement|` per candidate.
3. Pick the candidate with the smallest absolute difference within ±25% of target settlement.
4. If no candidate is within ±25%, return `null` and the caller falls back to portfolio average.

The `proxy_master_product` is surfaced in the UI so the user knows which product was used as a proxy ("Estimated based on similar-priced product: 'Hair Curler'").

The existing `ConsolidatedRow` type gains an optional field:

```typescript
proxy_source?: string | null    // null if real history was used; master_product name if a proxy was used
```

Existing `low_confidence` flag stays for the "1 month of history only" partial case.

### Benchmark window logic

`src/lib/daily-pnl/benchmark-window.ts`

```typescript
const DEFAULT_LAG_DAYS = 20

export function computeBenchmarkWindow(
  today: Date,
  lagDays: number = DEFAULT_LAG_DAYS,
  monthsRequired: number = 2
): { from: string; to: string; months: string[]; rationale: string } {
  // Find latest fully-finalised month: the latest month M where
  //   end_of_month(M) + lagDays <= today.
  const latestFinalised = findLatestFinalisedMonth(today, lagDays)

  // Window spans [start_of_month(latestFinalised - monthsRequired + 1) ... end_of_month(latestFinalised)]
  const windowStart = startOfMonth(subMonths(latestFinalised, monthsRequired - 1))
  const windowEnd = endOfMonth(latestFinalised)

  return {
    from: format(windowStart, 'yyyy-MM-dd'),
    to: format(windowEnd, 'yyyy-MM-dd'),
    months: enumerateMonths(windowStart, windowEnd, 'yyyy-MM'),
    rationale: `Today is ${format(today, 'MMM d')}. Most recent finalised P&L = ${format(latestFinalised, 'MMM yyyy')} (${lagDays}-day lag rule). Recommended window = previous ${monthsRequired} finalised months.`,
  }
}
```

Both `monthsRequired` and `lagDays` are constants for v2. v3 candidate: per-tenant override settings.

## UI / UX

### Configuration card (top of page, always visible)

```
┌─────────────────────────────────────────────────────────┐
│  Daily P&L Estimator                                    │
├─────────────────────────────────────────────────────────┤
│  Channel:    [Flipkart ▾]   (Amazon 🔜  D2C 🔜)         │
│  Accounts:   [☑ NuvioCentral  ☑ BodhNest  ☐ NuvioStore  │
│               ☑ NuvioShop                          ▾]   │
│  Dispatch:   [From: 2026-04-20]  [To: 2026-04-24]       │
│                                                         │
│                                              [Submit]   │
└─────────────────────────────────────────────────────────┘
```

- Channel: same dropdown as v1, Amazon/D2C disabled with 🔜 label.
- Accounts: shadcn `DropdownMenu` rendering checkbox items, fed from `/api/marketplace-accounts` filtered by selected channel. Includes "Select all" / "Clear all" shortcuts.
- Dispatch date range: defaults to yesterday-to-yesterday.
- **Submit** is the gate to revealing everything below.

### Benchmark Status card (revealed after Submit)

```
┌─────────────────────────────────────────────────────────┐
│  P&L Benchmark Status                                   │
│                                                         │
│  Today is Apr 25. Most recent finalised P&L = Mar 2026  │
│  (20-day lag rule). Recommended benchmark = Feb + Mar   │
│  (previous 2 finalised months).                         │
│                                                         │
│  ✅ NuvioCentral — Feb + Mar P&L available (1,200 rows) │
│  ⚠️ BodhNest — only Mar available, missing Feb          │
│       Estimates will use 1 month. Marked "low conf".    │
│  ❌ NuvioShop — no Feb/Mar P&L found.                   │
│       → Will fall back to similar-priced products from  │
│         other accounts.                                 │
│       [📥 Upload P&L now via Bulk Importer]             │
└─────────────────────────────────────────────────────────┘
```

- Calls `/api/daily-pnl/benchmark-status` on Submit (and on subsequent re-Submits if accounts/date change).
- Each row coloured green/yellow/red based on `status`.
- Clicking the "Upload P&L now" link opens the **Bulk Importer dialog as a modal overlay** (mounting the same `BulkImportDialog` component built in the Bulk Importer spec, with `enabledReportTypes={['pnl']}`). When the dialog closes, this card auto-refetches.

### Per-Account Upload sections (revealed after Submit)

```
┌─────────────────────────────────────────────────────────┐
│  Per-Account Uploads                                    │
├─────────────────────────────────────────────────────────┤
│  ▼ NuvioCentral                                         │
│    Orders for Apr 20–24 (required):  [Drop file…]       │
│    Listing (last updated 14 days ago) ▸ click to update │
│    COGS (last updated 60 days ago) ▸ click to update    │
│                                                         │
│  ▼ BodhNest                                             │
│    Orders for Apr 20–24 (required):  ✅ Uploaded (16    │
│       rows, 2 mins ago)                                 │
│    Listing (last updated 14 days ago) ▸ click to update │
│    COGS (last updated 60 days ago) ▸ click to update    │
│                                                         │
│  ▼ NuvioShop                                            │
│    Orders for Apr 20–24 (required):  [Drop file…]       │
│    ...                                                  │
└─────────────────────────────────────────────────────────┘
```

**Per-section structure:**
- Account name as section header (always visible)
- **Orders dropzone** — required, expanded by default; replaces the v1 "Orders" tile in `UploadPanel`
- **Listing** dropzone — collapsed under a disclosure triangle, shows `last updated X ago` from `dp_listing.created_at` max query. Expand to drop a fresh file (which replaces the existing listing for that account, same as v1).
- **COGS** dropzone — same pattern as Listing
- **No P&L History dropzone** — that lives in the Bulk Importer now

After all required uploads are done across all selected accounts, the global **[Compute]** button enables.

### Compute button

Sits below the Per-Account Uploads section.

```
                            [Compute]
```

Disabled state when:
- Any selected account has no `dp_orders` rows in the dispatch range
- (No other gating — Listing/COGS are optional updates; Compute uses the most recent stored Listing/COGS)

Hover tooltip when disabled: "Upload Orders for: BodhNest, NuvioShop"

### Results — accordion (after Compute)

```
┌─────────────────────────────────────────────────────────┐
│  ▼ Consolidated  (Open by default)                      │
│  ─────────────────────────────────────────────────────  │
│   [3 tabs: Consolidated P&L | Order Detail | Return     │
│    Costs]                                               │
│   Total Est. P&L: ₹12,540  ·  Units: 64  ·  Avg Margin: │
│    9.2%                                                 │
│   ... (the v1 ResultsTabs rendered with cross-account   │
│        aggregated data) ...                             │
├─────────────────────────────────────────────────────────┤
│  ▶ NuvioCentral   (Collapsed)                           │
│       Total Est. P&L: ₹4,120  ·  Units: 16              │
├─────────────────────────────────────────────────────────┤
│  ▶ BodhNest   (Collapsed)                               │
│       Total Est. P&L: ₹3,580  ·  Units: 18              │
├─────────────────────────────────────────────────────────┤
│  ▶ NuvioShop   (Collapsed)                              │
│       Total Est. P&L: ₹4,840  ·  Units: 30              │
└─────────────────────────────────────────────────────────┘
```

- **Top section: "Consolidated"** — expanded by default. Renders the v1 `ResultsTabs` with `data = response.consolidated` (cross-account aggregate).
- **Subsequent sections: one per selected account** — collapsed by default. Section header shows compact stats (Total Est. P&L, Units) so the user can scan without expanding. Clicking the header expands and renders the same v1 `ResultsTabs` with `data = response.per_account[i].results`.
- All sections share the same date range and benchmark window (rendered in a small caption above the consolidated section: "Apr 20–24, 2026 · Benchmark: Feb–Mar 2026").

### Order Detail tab — special case for the consolidated section

In the consolidated section's "Order Detail" tab, add an **Account** column so the user can tell which row came from which account. Per-account sections don't need this column (they're already scoped).

### Consolidated section — additional column

In the Consolidated tab of the consolidated section, add an **Accounts** column showing which accounts contributed to that master_product (e.g., "NuvioCentral + BodhNest").

## Data flow summary

```
Configure  →  Submit  →  GET /api/daily-pnl/benchmark-status
                          (uses today + lag rule + selected accounts)
                          ⇣
                       BenchmarkStatusCard renders
                       PerAccountUploadSection renders (one per account)

Per-account upload  →  POST /api/daily-pnl/upload (existing v1 endpoint)
                       (writes into dp_orders / dp_listing / dp_cogs)

Compute  →  GET /api/daily-pnl/results?marketplace_account_ids=...&from=...&to=...
            ⇣
         API joins dp_orders + dp_listing + dp_cogs (per-account scoped)
         API reads benchmark from order_financials joined to orders (filtered by
            marketplace_account_id IN (...) and order_date in benchmark window)
         API computes:
            - per-account ResultsResponse (one per account)
            - consolidated ResultsResponse (cross-account aggregate)
            - similar-price proxy applied where benchmark missing
         ⇣
         ResultsAccordion renders all sections
```

## Error handling

| Scenario | Behavior |
|---|---|
| User clicks Submit with 0 accounts selected | Submit disabled; help text "Pick at least one account" |
| Benchmark Status API fails | Card shows error state; "Retry" button. Other sections still appear (no benchmark info shown). |
| User uploads Orders for an account but the file's date range is outside the configured dispatch range | Soft warning under that dropzone: "File contains orders from Apr 18–22, but selected range is Apr 20–24. 8 orders will be ignored." Upload proceeds; Compute filters by date. |
| Compute finds zero `dp_orders` for an account in the date range | That account's section renders with an empty-state message ("No dispatched orders for this account in this date range"). Other accounts proceed. |
| Compute API fails | Single error toast; results section doesn't render; Compute button re-enables for retry. |
| User changes accounts/date AFTER computing | Results clear; user must Submit + Compute again. |
| Benchmark Status indicates a missing month, user clicks "Upload P&L now", uploads → modal closes | BenchmarkStatusCard auto-refetches; if status changed to `full`, the warning collapses. |

## Testing strategy

### Unit
- `computeBenchmarkWindow` with various dates: end of month / start of month / mid-month
- `findSimilarPricedProxy` with: no candidates / one candidate / multiple candidates / target outside ±25% range
- Per-account vs consolidated aggregation logic in `results` route — assert the consolidated row is `Σ` of per-account rows for the same master_product

### Integration
- Mock 3 accounts with mixed benchmark availability (full / partial / none); call benchmark-status; assert per-account `status` and `fallback_strategy` values
- End-to-end: upload Orders for 3 accounts → call results API → verify accordion renders with correct per-account breakdowns
- Verify proxy: account with no benchmark gets `proxy_source` populated and `low_confidence: true`

### Manual smoke test (mandatory before deploy)
1. Open `/daily-pnl`. Verify single-account v1 flow still works (backward-compat: pick 1 account, upload, compute).
2. Pick 2 accounts → Submit → verify Benchmark Status card shows both
3. Click "Upload P&L now" on a missing-month row → Bulk Importer opens → upload P&L → close → verify Benchmark Status auto-refreshes
4. Drop Orders for both accounts → Compute → verify accordion: Consolidated open, both accounts collapsed with stats
5. Expand each account section → verify per-account ResultsTabs render correctly
6. Change date range → Submit + Compute again → verify results update
7. Compare consolidated totals against summing per-account totals manually for one master product

## Implementation budget

- benchmark-window utility + tests: ~0.5 day
- benchmark-status API + similar-price proxy + tests: ~1 day
- results API rewrite (multi-account + consolidated): ~1 day
- ConfigurationCard + BenchmarkStatusCard + PerAccountUploadSection: ~1.5 days
- ResultsAccordion + state mgmt: ~1 day
- Wire-up, testing, polish: ~1 day

**Estimated total: ~6 dev-days.**

## Open design points (please confirm during review)

1. **Benchmark window: relative to TODAY, not to dispatch date.**
   - **Default chosen:** always use the most recent 2 finalised months from "now". Even if computing P&L for an old date range, we still want today's best-known benchmark.
   - Alternative: relative to dispatch date (more "historically faithful" but less accurate for current fee structures).

2. **Two-step flow (Submit → reveal → Compute).**
   - **Default chosen:** keep the gate. Submit is "tell me what data I need"; Compute is "run it". Lets the user see and fix gaps before committing to a calculation.
   - Alternative: collapse into one step (auto-show upload sections as soon as accounts/date are picked). Faster but less explicit about the upload-then-compute mental model.

3. **Listing/COGS uploaded per-account, not via a Bulk Importer-style screen.**
   - **Default chosen:** keep them per-account inside Per-Account Uploads. They change rarely; bulk-loading them is unnecessary complexity for v2.
   - Alternative: add Listing/COGS as supported types in the Bulk Importer too. Defer to v3.

4. **Per-account drill-down via accordion below consolidated, all on one page.**
   - **Locked per user direction:** Consolidated open at top; one collapsed accordion section per selected account below; each section renders the same 3-tab ResultsTabs scoped to that account.

5. **Similar-price proxy threshold ±25%.**
   - **Default chosen:** ±25% of target settlement. Tune with usage data later.
   - Alternative: dynamic banding (e.g., "premium / mid / value" buckets). Defer.

6. **No persistent state between sessions.**
   - **Default chosen:** if the user closes the tab mid-flow, they restart from Configuration. The dp_* tables retain uploaded data; only the ephemeral selection/date state is lost.
   - Alternative: localStorage-persist the last-used account selection and date range. Small UX win; defer to v3.
