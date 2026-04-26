# Daily P&L Estimator v2 — Design Spec

**Date:** 2026-04-25
**Status:** Draft v2 (reviewed and revised)
**Depends on:** Bulk P&L Importer (separate spec, same date)

## Goal

Make the Daily P&L Estimator usable across multiple seller accounts in a single 5-minute workflow, with a consolidated cross-account view by default and per-account drill-down on demand. Source the P&L benchmark data from the main FK-Tool data layer (`order_financials`, populated via the Bulk P&L Importer) instead of the standalone `dp_pnl_history` table.

## What stays the same as v1

- Listing data: still uploaded per-account into `dp_listing` (rare changes)
- COGS data: still uploaded per-account into `dp_cogs` (rare changes)
- Orders: still uploaded fresh per day per-account into `dp_orders`
- All P&L formulas (already validated against the spec workbook to the rupee)
- The 3-tab results structure: Consolidated P&L / Order Detail / Return Costs
- Dispatch-day snapshot semantics — terminal-status overrides remain deferred

## What changes in v2

| Area | v1 | v2 |
|---|---|---|
| Account selector | Single dropdown | Multi-select with checkboxes |
| Workflow | Pick → upload → compute | **Two-step:** Configure → Continue → Per-account uploads & benchmark status revealed → Compute |
| Benchmark source | `dp_pnl_history` (uploaded into Estimator itself) | `order_financials` (populated by Bulk Importer in `/pnl`) |
| Benchmark window | "Whatever was last uploaded" | "Most recent 2 finalised months relative to today" — temporally aware |
| Benchmark gaps | Falls back to portfolio average silently | Surfaces explicitly per-account; offers inline link to Bulk Importer |
| Results display | Single block for the one selected account | **Accordion**: Consolidated open at top; one collapsed per-account section below |

## Architectural temporary state

v2 reads benchmarks from `order_financials` (main schema) but writes Orders / Listing / COGS to `dp_*` tables (parallel schema). This **split-brain pattern is intentional and temporary**.

- It exists because folding `dp_*` into the main schema requires backfill data first (chicken-and-egg).
- Once the backfill is meaningful, a future v3 effort folds `dp_orders`, `dp_listing`, `dp_cogs` into the main schema and `dp_*` tables retire.
- An inline code comment in `src/app/api/daily-pnl/results/route.ts` references this section so future engineers don't think the cross-schema read is a bug.

## Non-goals (deferred to v3+)

- Folding `dp_*` into the main schema
- Cross-channel results (Amazon, D2C still locked)
- Editable benchmark window override per-product
- Replacing dispatch-day snapshot with terminal-status override
- Manual "this product behaves like Y" mappings (v2 uses automatic similar-priced proxy only)
- Exporting consolidated + per-account in one ZIP / multi-sheet XLSX
- Comparison view ("show me last week vs this week")
- Mobile / responsive — desktop-only feature for v2

## Architecture

### High-level flow

```
1. User lands on /daily-pnl
2. Configuration card: pick channel + accounts (multi-select) + dispatch date range
3. Click [Continue]
4. Page expands:
   - Benchmark Status card (per-account check against order_financials)
   - Per-Account Upload sections (one per selected account)
5. User uploads Orders for each account (and Listing/COGS if needed)
6. Click [Compute]
7. Results render as accordion: Consolidated open on top; per-account collapsed below
```

### Component structure

```
src/app/(dashboard)/daily-pnl/page.tsx           (rewrites the v1 page)
src/components/daily-pnl/
  ChannelAccountSelector.tsx                     (UPDATED — multi-select accounts)
  ConfigurationCard.tsx                          (NEW — channel + accounts + date + Continue)
  BenchmarkStatusCard.tsx                        (NEW — per-account benchmark availability)
  PerAccountUploadSection.tsx                    (NEW — one per selected account)
  ResultsAccordion.tsx                           (NEW — replaces v1 single ResultsTabs render)
  ResultsTabs.tsx                                (UNCHANGED — reused inside each accordion section)
  UploadPanel.tsx                                (UPDATED — embedded inside PerAccountUploadSection)
  EmptyState.tsx                                 (NEW — handles zero accounts, missing data)
```

### API changes

#### NEW: `GET /api/daily-pnl/benchmark-status`

**Query params:**
- `marketplace_account_ids`: comma-separated UUIDs
- `dispatch_from`, `dispatch_to`: YYYY-MM-DD

**Response:**
```typescript
{
  benchmark_window: {
    from: string             // YYYY-MM-DD
    to: string               // YYYY-MM-DD (= last day of latest finalised month)
    months_label: string     // e.g., "Feb–Mar 2026"
    rationale: string
  }
  per_account: Array<{
    marketplace_account_id: string
    account_name: string
    available_months: string[]              // ["2026-02", "2026-03"]
    missing_months: string[]
    rows_in_window: number
    rows_with_null_account: number          // count of order_financials rows in window
                                             // whose orders.marketplace_account_id IS NULL
                                             // (legacy data; see note below)
    status: 'full' | 'partial' | 'none'
    fallback_strategy?: 'similar_priced' | 'portfolio_average' | null
    cogs_present: boolean                   // whether dp_cogs has data for this account
    listing_present: boolean                // whether dp_listing has data for this account
    cogs_last_updated_at?: string           // ISO timestamp of MAX(dp_cogs.created_at) WHERE marketplace_account_id = X
    listing_last_updated_at?: string        // ISO timestamp of MAX(dp_listing.created_at) WHERE marketplace_account_id = X
  }>
}
```

**Stale-data UI:** the client computes "X days ago" from `cogs_last_updated_at` / `listing_last_updated_at` using its own local clock (display only). Server returns the raw ISO timestamps so different time zones don't cause "9 vs 10 days ago" inconsistencies between server and client.

**Legacy null-account note:** the existing `pnl-import-server.ts` enrichment path (pre-Estimator-v2) sometimes left `orders.marketplace_account_id = NULL`. The benchmark count `rows_in_window` only includes rows where `orders.marketplace_account_id = X` (per-account scoped). Rows in the window with NULL account belong to no specific account and are surfaced separately as `rows_with_null_account` for diagnostic display ("242 rows in this period have no account assignment — backfill needed"). v2 does NOT backfill those automatically; that's a separate maintenance task to be scheduled.

The endpoint also returns whether COGS / Listing data exists per-account, and how stale it is. The UI uses this to:
- Show "COGS missing — required" red label if `cogs_present = false`
- Show stale-data warning if `cogs_last_updated_days_ago > 90` or `listing_last_updated_days_ago > 30`

**Benchmark window logic** (see Detailed Logic section).

#### UPDATED: `GET /api/daily-pnl/results`

**🔒 Security requirement (non-optional):** the endpoint MUST verify EVERY `marketplace_account_id` in the request belongs to the caller's tenant. Implementation:

```typescript
const { data: ownedAccounts } = await supabase
  .from('marketplace_accounts')
  .select('id')
  .eq('tenant_id', tenantId)
  .in('id', requestedAccountIds)

if (!ownedAccounts || ownedAccounts.length !== requestedAccountIds.length) {
  return NextResponse.json({ error: 'One or more accounts not found' }, { status: 403 })
}
```

The same check applies to `GET /api/daily-pnl/benchmark-status` and any other multi-account endpoint added in v2. Without this, a malicious user could pass another tenant's account UUID and receive their data — `dp_orders` rows have no `tenant_id` column, so this check is the ONLY tenant-isolation defence.

**Query params (changed):**
- `marketplace_account_ids`: comma-separated UUIDs (was singular)
- `from`, `to`: dispatch range
- `skip_accounts_without_orders`: boolean (default `true`)

**Response (changed shape):**
```typescript
{
  benchmark_window: { from: string; to: string; months_label: string }
  consolidated: ResultsResponse                 // aggregated across selected accounts WITH orders
  per_account: Array<{
    marketplace_account_id: string
    account_name: string
    has_orders_in_range: boolean
    results: ResultsResponse | null            // null if has_orders_in_range = false
  }>
  warnings: string[]                           // non-fatal warnings surfaced in UI banner
}
```

`skip_accounts_without_orders=true` (the default) lets the user compute even when some selected accounts have no Orders uploaded — those accounts render in the accordion as collapsed empty-state sections rather than blocking Compute.

#### Aggregation logic (multi-account)

For per-account results: existing v1 logic per account on its slice of data.

For consolidated:
1. Group all order_detail rows across accounts by **`dp_cogs.master_product` (a normalized string key)**. This is the same grouping field v1 uses today — see `src/app/api/daily-pnl/results/route.ts:51` (`const master = cogs?.master_product ?? '__unmapped__'`). v2 does NOT introduce a new master_product UUID; it stays on the v1 string.
2. **Normalization for the join key:** `master_product.trim().toLowerCase()`. Display uses the original casing from one of the contributing accounts (deterministic: alphabetic-first account's casing).
3. **Quantity-weighted** aggregation across accounts:
   ```
   consolidated_avg_bank_settlement = Σ (account_avg_bank_settlement × account_qty) / Σ (account_qty)
   consolidated_avg_selling_price = Σ (account_avg_selling × account_qty) / Σ (account_qty)
   consolidated_qty = Σ (account_qty)
   ```
4. Delivery rate and Est. Return Cost / Unit are **looked up from the consolidated benchmark pool** (all selected accounts' P&L history pooled), not averaged across accounts. This matches the spec workbook math.
5. Add per-row `contributing_accounts: string[]` for the new "Accounts" column.

**SKU-mismerge note (revised understanding):** because the join key is `master_product` (a free-text label that the user maintains in `dp_cogs` per-account), two accounts MUST use the same label for the same logical product to consolidate correctly. If NuvioCentral has master_product = `"Washing Machine"` and BodhNest has `"washing-machine"`, the normalization (trim + lowercase) catches that. If they're genuinely different labels (`"Washing Machine"` vs `"Top Loader"`) for the same physical product, the v2 model leaves them as two consolidated rows. This is an accepted v2 limitation; v3 will fold consolidation onto `master_sku_id` (UUID from main schema's catalog) when `dp_*` retires.

**Required documentation in UI:** the Bulk Importer / catalog onboarding flows should encourage consistent `master_product` labels across accounts. v2 doesn't add programmatic enforcement.

#### Similar-priced product proxy

`src/lib/daily-pnl/similar-price-proxy.ts`

```typescript
function findSimilarPricedProxy(
  target: { master_product: string; avg_bank_settlement: number; account_name: string },
  candidates: Array<{
    master_product: string;
    avg_bank_settlement: number;
    delivery_rate: number;
    est_return_cost_per_dispatched_unit: number;
    account_name: string;
    dispatched_units: number;          // for tiebreaker
  }>
): {
  delivery_rate: number;
  est_return_cost_per_dispatched_unit: number;
  proxy_master_product: string;
  proxy_account_name: string;          // for UI provenance
} | null
```

**Algorithm:**
1. **Guard:** if `target.avg_bank_settlement <= 0` or null, return `null` (caller falls back further or surfaces "missing listing price").
2. Filter candidates with non-null `delivery_rate` and `est_return_cost_per_dispatched_unit`.
3. Filter to candidates within ±25% of target's `avg_bank_settlement`.
4. If empty, return `null`.
5. Pick the candidate with smallest absolute price difference.
6. **Tiebreaker (equidistant):** prefer the candidate with more `dispatched_units` (more statistically reliable). If still tied, prefer alphabetic `master_product`.

UI provenance: when proxy is used, the row in Consolidated/Order Detail tab renders:
> "Estimated based on similar-priced product 'Hair Curler' from BodhNest"

Both the master_product and the source account are shown.

`ConsolidatedRow` gains:
```typescript
proxy_source?: {
  master_product: string
  account_name: string
} | null
```

### Benchmark window logic (with explicit edge cases)

`src/lib/daily-pnl/benchmark-window.ts`

```typescript
import { utcToZonedTime } from 'date-fns-tz'
import { addDays, endOfMonth, startOfMonth, subMonths, format } from 'date-fns'

const DEFAULT_LAG_DAYS = 20
const DEFAULT_TZ = 'Asia/Kolkata'   // India sellers; use IST for "today"

export function computeBenchmarkWindow(
  utcNow: Date,                              // server's UTC clock
  lagDays: number = DEFAULT_LAG_DAYS,
  monthsRequired: number = 2,
  tz: string = DEFAULT_TZ
): { from: string; to: string; months: string[]; rationale: string } {
  // Convert UTC to user's local "today" — without this, a midnight-IST request
  // would compute the wrong day from a UTC server.
  const today = utcToZonedTime(utcNow, tz)

  // Rule: latest finalised month M = the latest month where
  //   end_of_month(M) + lagDays <= today
  // (i.e., we wait `lagDays` days past month-end before considering it finalised)
  const latestFinalised = findLatestFinalisedMonth(today, lagDays)

  const windowStart = startOfMonth(subMonths(latestFinalised, monthsRequired - 1))
  const windowEnd = endOfMonth(latestFinalised)

  return {
    from: format(windowStart, 'yyyy-MM-dd'),
    to: format(windowEnd, 'yyyy-MM-dd'),
    months: enumerateMonths(windowStart, windowEnd, 'yyyy-MM'),
    rationale: `Today is ${format(today, 'MMM d, yyyy')} (${tz}). Most recent finalised P&L = ${format(latestFinalised, 'MMM yyyy')} (${lagDays}-day lag rule). Recommended window = previous ${monthsRequired} finalised months.`,
  }
}

function findLatestFinalisedMonth(today: Date, lagDays: number): Date {
  // Walk backwards from this month until end_of_month(M) + lagDays <= today
  let m = startOfMonth(today)
  while (true) {
    const finalisedDate = addDays(endOfMonth(m), lagDays)
    if (finalisedDate <= today) return m
    m = subMonths(m, 1)
  }
}
```

**Timezone is non-optional.** All "today" math happens in `Asia/Kolkata`. Without this, an IST seller running the report at 1am IST gets benchmark windows that are off by a day from the user's mental model.

#### Edge cases (named test cases — REQUIRED for v2)

The rule is **`end_of_month(M) + lagDays ≤ today`** (boundary day inclusive — on April 20, March IS finalised because `2026-03-31 + 20 days = 2026-04-20`).

All cases use `lagDays = 20`, `monthsRequired = 2`, `tz = 'Asia/Kolkata'`.

| Today (IST) | Latest finalised | Window | Why |
|---|---|---|---|
| **2026-04-25** | March 2026 | Feb–Mar 2026 | Standard case mid-month |
| **2026-04-20** (boundary inclusive) | March 2026 | Feb–Mar 2026 | `2026-03-31 + 20 = 2026-04-20`; ≤ holds |
| **2026-04-19** (one day before boundary) | February 2026 | Jan–Feb 2026 | March needs `2026-04-20`; today is earlier so March NOT yet finalised |
| **2026-04-01** (start of month) | February 2026 | Jan–Feb 2026 | March requires April 20; today is April 1 |
| **2026-03-31** (end of month) | February 2026 | Jan–Feb 2026 | Feb's finalisation date is `2026-03-20`, ≤ today; March's is `2026-04-20`, > today |
| **2026-01-05** (cross-year) | November 2025 | Oct–Nov 2025 | Dec needs `2026-01-20`; today is Jan 5; step back to Nov (`2025-12-20` ≤ Jan 5) |
| **2026-01-20** (cross-year boundary) | December 2025 | Nov–Dec 2025 | Dec needs `2026-01-20`; ≤ holds |

These exact cases are required unit tests. The `findLatestFinalisedMonth` helper must produce these exact outputs. Earlier draft of this table had two arithmetic errors that are now corrected.

## UI / UX

### Configuration card (top, always visible)

```
┌─────────────────────────────────────────────────────────┐
│  Daily P&L Estimator                                    │
├─────────────────────────────────────────────────────────┤
│  Channel:    [Flipkart ▾]   (Amazon 🔜  D2C 🔜)         │
│  Accounts:   [☑ NuvioCentral  ☑ BodhNest  ☐ NuvioStore  │
│               ☑ NuvioShop                          ▾]   │
│  Dispatch    [From: 2026-04-20]  [To: 2026-04-24]   ⓘ   │
│   date:                                                 │
│              ⓘ  "When the order was shipped from your   │
│                  warehouse — not when ordered or        │
│                  delivered."                            │
│                                                         │
│                                            [Continue]   │
└─────────────────────────────────────────────────────────┘
```

- Channel: same dropdown as v1; Amazon/D2C disabled with 🔜 label
- Accounts: shadcn `DropdownMenu` with checkbox items, fed from `/api/marketplace-accounts` filtered by selected channel; "Select all" / "Clear all" shortcuts
- Dispatch date range: `<InfoTooltip>` clarifying meaning; default = yesterday-to-yesterday
- **Continue** button (renamed from "Submit") — gate to revealing everything below

#### Empty state: zero Flipkart accounts

If `/api/marketplace-accounts?platform=flipkart` returns empty:

```
You haven't set up any Flipkart accounts yet.

Each Flipkart Seller Hub login is one "account" in FK-Tool.
Add an account in Settings to start using the Daily P&L Estimator.

           [Open Settings →]
```

The whole page below the heading is replaced with this empty state. Continue button hidden.

### Persistence (localStorage)

Last-used selection is persisted per-tenant in localStorage:
```typescript
key: `fk-tool:daily-pnl:last-config:${tenantId}`
value: { channel, accountIds, dispatchFrom, dispatchTo }
```

Restored on page mount. If accounts have been deleted/added since, the restore filters out missing IDs.

This is a small UX win that pays back across sessions and reloads.

### Benchmark Status card (revealed after Continue)

```
┌─────────────────────────────────────────────────────────┐
│  P&L Benchmark Status                                   │
│                                                         │
│  Today is Apr 25, 2026. Most recent finalised P&L =     │
│  Mar 2026 (20-day lag rule).                            │
│  Recommended benchmark = Feb–Mar 2026                   │
│                                                         │
│  ✅ NuvioCentral — Feb + Mar P&L available (1,200 rows) │
│                                                         │
│  ⚠️ BodhNest — only Mar available, missing Feb          │
│       Estimates use 1 month → flagged "low confidence"  │
│                                                         │
│  ❌ NuvioShop — no Feb/Mar P&L found                    │
│       → Will use similar-priced product proxy from      │
│         other accounts                                  │
│       [📥 Upload P&L now via Bulk Importer]             │
│                                                         │
│  ❌ NuvioStore — COGS missing                           │
│       Compute disabled until COGS uploaded for this     │
│       account. [Upload COGS in Per-Account section ↓]   │
└─────────────────────────────────────────────────────────┘
```

**Loading state:** skeleton card with "Checking benchmark availability for N accounts…" and an aggregate spinner. Per-account rows render progressively as their data arrives (parallel API calls behind the scenes; results stream in).

**Critical safeguards:**
- Each account row shows status for **both benchmark and required-data presence** (COGS, Listing). Missing COGS or Listing is highlighted as an error, not just the missing benchmark.
- If ALL accounts show `status='none'` AND the proxy has no candidates anywhere (i.e., zero accounts have any P&L history), a section-level banner replaces the per-account list:
  > "No P&L history found for any selected account. Upload at least 1 month of P&L via the Bulk Importer to compute estimates."

**Status icon labels:** every ✅ ⚠️ ❌ has visible text equivalent (`Available` / `Partial` / `Missing`) and `aria-label` for screen readers.

**Bulk Importer deep-link:** clicking "📥 Upload P&L now" mounts `BulkImportDialog` with `enabledReportTypes={['pnl']}` as a modal overlay.

**Auto-refresh after modal close:** when the Bulk Importer modal closes, this card immediately re-fetches with a "Refreshing…" inline state. Status icons animate from ❌ → ✅ on success. Toast confirms "Benchmark updated for N accounts."

**Bulk Importer not yet shipped fallback:** if `BulkImportDialog` isn't available (sequencing — feature shipping after Estimator v2), the link instead navigates to `/pnl?intent=bulk-import` with a tooltip "Opens the P&L tab where you can upload."

### Per-Account Upload sections (revealed after Continue)

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
│       rows · 2 mins ago)                                │
│    Listing (last updated 14 days ago) ▸ click to update │
│    COGS (last updated 60 days ago) ▸ click to update    │
│                                                         │
│  ▶ NuvioShop                                            │
│    Orders for Apr 20–24 (required):  [Drop file…]       │
│    ❌ Listing missing — required                        │
│      [Upload Listing] (this expands the Listing zone)   │
│    ❌ COGS missing — required                           │
│      [Upload COGS]                                      │
│                                                         │
│  ▶ NuvioStore                                           │
│    Orders for Apr 20–24 (required):  [Drop file…]       │
│    ⚠️ Listing 32 days old — prices may have changed     │
│    Listing (last updated 32 days ago) ▸ click to update │
│    COGS (last updated 60 days ago) ▸ click to update    │
└─────────────────────────────────────────────────────────┘
```

**Per-section structure:**
- Account name as section header (always visible)
- **Orders dropzone** — required, expanded by default
- **Listing** — collapsed under disclosure if `listing_present = true`. If missing, RED label "Listing missing — required" with explicit "Upload Listing" button that expands the zone
- **COGS** — same pattern

**Stale-data warnings:**
- Listing > 30 days old: ⚠️ yellow warning "Prices may have changed. Consider re-uploading."
- COGS > 90 days old: ⚠️ yellow warning "Costs may have changed. Consider re-uploading."

**Per-file Orders upload state machine** (4 states surfaced in UI):

| State | UI |
|---|---|
| `idle` | `[Drop file…]` |
| `parsing` | `🔄 Parsing file…` |
| `uploading` | `🔄 Uploading…` (with progress bar for files > 5 MB) |
| `uploaded` | `✅ Uploaded (N rows · 2 mins ago)` |
| `error` | `❌ Failed: <reason> [Retry]` |

**Date-range mismatch warning:** if the uploaded Orders file contains rows outside the configured dispatch range:
```
⚠️ File contains orders from Apr 18–22, but selected range is Apr 20–24.
   16 of 24 orders will be ignored on Compute.
```

Upload still proceeds; the API filters by dispatch_date.

### Compute button

Sticky-bottom bar at the page level. Always visible while results haven't been computed:

```
┌─────────────────────────────────────────────────────────┐
│ Ready to compute for 3 of 4 selected accounts.          │
│ NuvioStore: COGS missing — fix above to include.        │
│                                              [Compute]  │
└─────────────────────────────────────────────────────────┘
```

**Disabled state** when:
- No accounts have Orders in range AND no accounts have COGS+Listing
- (Otherwise enabled — partial computation is allowed)

**Tooltip when disabled:** lists the fixable issues per account.

**Partial-computation behavior** (the default): accounts missing COGS or Listing are silently excluded from results. Their accordion sections in the results show a clear empty-state message rather than blocking the whole compute. The status bar above the Compute button summarises this ("3 of 4 accounts will be included").

### Compute loading state

Click → button disables and shows `<Loader2 />` "Computing P&L for N accounts…"

If the request takes > 5 seconds, an inline message appears:
> "Computing benchmarks across {months_label}… this typically takes 5–15 seconds."

Timeout at 60 seconds → error toast + retry button.

### Re-Continue / re-Compute behavior

| User action | What persists | What clears |
|---|---|---|
| Change channel | Selection cleared (no choice except Flipkart anyway) | Everything below resets; uploads in `dp_*` tables remain |
| Change accounts (after Continue) | Per-account upload UI for newly-added/removed accounts updates; previously-uploaded `dp_*` data still in DB | Results clear |
| Change dispatch range (after Continue) | Per-account upload UI persists | Results clear; Benchmark Status re-fetches |
| Click Continue again | Page re-renders Benchmark Status + Per-Account sections | Results clear |
| Click Compute again with new uploads | Results re-render | Previous results swap with new ones |

**Critical:** the per-account upload sections in the UI re-query the server on Continue, so any data uploaded in a previous session shows correctly as `✅ Uploaded` rather than appearing fresh.

### Results — accordion (after Compute)

```
┌─────────────────────────────────────────────────────────┐
│  Apr 20–24, 2026 · Benchmark: Feb–Mar 2026              │
├─────────────────────────────────────────────────────────┤
│  ▼ Consolidated  (Open by default)                      │
│  ─────────────────────────────────────────────────────  │
│   [3 tabs: Consolidated P&L | Order Detail | Return     │
│    Costs]                                               │
│   Total Est. P&L: ₹12,540  ·  Units: 64  ·  Avg Margin: │
│    9.2%                                                 │
│   ... (v1 ResultsTabs with cross-account aggregated     │
│        data; "Accounts" column on Consolidated;         │
│        "Account" column on Order Detail) ...            │
├─────────────────────────────────────────────────────────┤
│  ▶ NuvioCentral   (Collapsed)                           │
│       Total Est. P&L: ₹4,120  ·  Units: 16              │
├─────────────────────────────────────────────────────────┤
│  ▶ BodhNest   (Collapsed)                               │
│       Total Est. P&L: ₹3,580  ·  Units: 18              │
├─────────────────────────────────────────────────────────┤
│  ▶ NuvioShop   (Collapsed)                              │
│       Total Est. P&L: ₹4,840  ·  Units: 30              │
├─────────────────────────────────────────────────────────┤
│  ▶ NuvioStore   (Collapsed) — empty                     │
│       No dispatched orders in this date range.          │
└─────────────────────────────────────────────────────────┘
```

**Accordion section structure:**
- **Consolidated:** expanded by default; renders `ResultsTabs` with `data = response.consolidated`
- **Per-account sections:** collapsed by default; section header shows compact stats (Total Est. P&L · Units)
- **Empty per-account section** (no orders in range): header shows `"₹0 · 0 units"` greyed; expanded body shows "No dispatched orders for this account in this date range."

**Order Detail tab in Consolidated section:**
- New "Account" column showing the account each row came from
- **Sortable** alphabetic by account
- **Filterable** via a multi-select pill above the table

**Consolidated P&L tab in Consolidated section:**
- New "Accounts" column listing contributing accounts (e.g., `NuvioCentral + BodhNest`)
- All other columns are quantity-weighted aggregates (per the Aggregation logic above)

**Performance:**
- Order Detail renders virtualized (e.g., react-virtual) when row count > 100, to avoid mass DOM layout
- Hard cap at 5,000 rows in the rendered table; if exceeded, banner "Showing first 5,000 of N rows. Export CSV for full data."

**CSV export:** existing per-tab Export buttons preserved on every accordion section. v2 does NOT add an "Export All" combined button — that's a v3 candidate.

## Accessibility

- **Multi-select dropdown:** verified keyboard support (arrow keys, space-toggle, escape-close). Manual smoke test step.
- **Accordion sections:** `aria-expanded` / `aria-controls` on triggers; standard shadcn `Accordion` primitive provides this.
- **Status icons** (✅ ⚠️ ❌): paired with visible text + `aria-label`.
- **Focus management:**
  - On Continue click, focus moves to the Benchmark Status card heading (`aria-live="polite"` for screen-reader announcement)
  - When Bulk Importer modal opens, focus enters the modal; on close, returns to the deep-link button
  - On Compute, focus moves to Results accordion heading

## Error handling

| Scenario | Behavior |
|---|---|
| 0 marketplace accounts in tenant | Empty state replaces the page; deep-link to Settings |
| 0 accounts selected | Continue disabled; helper "Select at least one account" |
| Benchmark Status API fails | Card shows error state with Retry button; Per-Account upload sections still render |
| Per-account benchmark partial-fail (some accounts succeed, some fail) | Show successful rows + error placeholders for failed accounts with "Retry this account" links |
| User uploads Orders for a date outside the dispatch range | Soft warning under that dropzone (see UI section); upload proceeds |
| Account has no COGS data | Red flag in Benchmark Status; account excluded from compute (with explanation in Compute status bar) |
| Account has no Listing data | Same as COGS; required for the calc |
| Compute API returns 500 | Toast error; Compute button re-enables; uploaded data preserved |
| Compute API timeout (> 60s) | Same as 500 + suggest reducing date range or accounts |
| All accounts have status=`none` AND no proxy candidates | Section banner; Compute disabled |
| Listing or COGS > stale threshold | Yellow warning; Compute still allowed (user accepts the risk) |
| User changes config after Continue | Results clear; Benchmark Status re-fetches; uploads preserved |
| User reloads mid-flow | localStorage restores last config; page restarts at Configuration; uploads in DB persist |
| Browser back/forward | Standard SPA behavior; localStorage restore covers reloads |

## Testing strategy

### Unit
- `computeBenchmarkWindow` — every named edge case in the table above; assert exact `from`, `to`, `months_label`
- `findSimilarPricedProxy` — no candidates, single candidate, multiple candidates within range, target outside ±25%, equidistant tiebreaker (more units wins, then alphabetic), target with `avg_settlement = 0` returns null
- Multi-account aggregation: assert consolidated `avg_bank_settlement` is qty-weighted across accounts
- SKU mismerge guard: same `platform_sku` mapped to different `master_product_id` in two accounts → consolidated row stays separate

### Integration
- Mock 4 accounts with mixed benchmark availability (full / partial / none / missing-COGS); call benchmark-status; assert per-account `status` and `fallback_strategy`
- Compute with 4 selected accounts where 2 have orders, 2 don't → 2 per-account sections render with results, 2 with empty-state; consolidated reflects only the 2 with data
- Bulk Importer deep-link: simulate modal open → upload P&L → modal close → assert Benchmark Status auto-refetches and animates ❌ → ✅
- localStorage restore: set last-config → reload → assert configuration card pre-populates
- localStorage stale-account guard: set last-config with an account that's been deleted → reload → assert deleted account is filtered out without errors

### Manual smoke test (mandatory before deploy)
1. With 0 accounts → empty state shown
2. Add accounts → reload → backward-compat: pick 1 account, upload, compute → verify single-account flow still works
3. Pick 4 accounts → Continue → Benchmark Status renders with mixed statuses
4. Click "Upload P&L now" on a missing-month row → Bulk Importer opens → upload → close → Benchmark Status auto-refreshes
5. Drop Orders for 3 of 4 accounts → leave 4th account empty → click Compute
6. Verify Compute status bar reads "Ready for 3 of 4 accounts"
7. Verify accordion: Consolidated expanded with totals from 3 accounts; the 4th account's section shows empty-state when expanded
8. Expand each account section → verify per-account ResultsTabs render correctly
9. Order Detail tab in Consolidated → verify Account column, sort by account, filter to 1 account → verify rows update
10. Consolidated P&L tab → verify "Accounts" column lists contributing accounts per row
11. Change date range → Continue → Compute again → verify Benchmark Status updates and results refresh
12. Reload page mid-flow → verify localStorage restores config
13. Manually verify the math: pick one master_product, sum its `Total Est. P&L` across each per-account section → assert equals consolidated row's `Total Est. P&L` (give or take rounding)
14. Test cross-year benchmark: temporarily set system clock or pass mock today value to backend → verify January benchmarks correctly produce October–November of previous year

## Implementation budget

- benchmark-window utility + tests (with all named edge cases): ~1 day
- benchmark-status API + similar-price proxy + tests: ~1.5 days
- results API rewrite (multi-account + consolidated + qty-weighted aggregation + SKU-mismerge safeguard): ~1.5 days
- ConfigurationCard + BenchmarkStatusCard + PerAccountUploadSection: ~2 days
- ResultsAccordion + state mgmt + virtualization: ~1.5 days
- localStorage persistence + Bulk Importer deep-link wiring: ~0.5 day
- Empty states + error states + accessibility: ~1 day
- Wire-up, manual + integration testing: ~1 day

**Estimated total: ~10 dev-days.**

## Resolved design points (from review)

1. **"Submit" → "Continue"** — clearer about the two-step flow.
2. **Empty states** — zero accounts, missing COGS, missing Listing, all explicit.
3. **Final fallback** — section banner when no benchmark data anywhere.
4. **Benchmark window edge cases** — named test cases for cross-year, end-of-month, lag-boundary timing.
5. **Multi-account aggregation math** — quantity-weighted across accounts, explicit formulas, SKU-mismerge safeguard.
6. **Cross-account proxy provenance** — both `master_product` and `account_name` shown in UI.
7. **Compute partial computation** — `skip_accounts_without_orders=true` default; status bar shows X of Y accounts included.
8. **Bulk Importer sequencing** — graceful fallback to `/pnl?intent=bulk-import` if dialog component not yet shipped.
9. **Stale data warnings** — Listing > 30 days, COGS > 90 days.
10. **Loading states** — explicit for benchmark-status (progressive), file upload (4-state machine), compute (long-running indicator).
11. **Auto-refresh after modal close** — explicit, with animation.
12. **Compute button placement** — sticky-bottom bar.
13. **Empty per-account sections** — header shows ₹0 · 0 units greyed; expanded body explains.
14. **Order Detail Account column** — sortable + filterable.
15. **Order Detail performance** — virtualized rendering past 100 rows; hard cap at 5,000 rows.
16. **Date-range mismatch warning** — soft banner under affected upload zone.
17. **localStorage persistence** — last-used config restored on mount.
18. **Proxy tiebreaker** — more dispatched units wins; alphabetic fallback.
19. **Zero/null target settlement** — proxy returns null; "missing listing price" surfaced.
20. **Architectural split-brain documentation** — explicit "Architectural temporary state" section + inline code comment.
21. **Accessibility** — multi-select keyboard nav, accordion ARIA, focus management, status icon labels.

## Open design points (please confirm during review)

1. **Default dispatch range = yesterday-to-yesterday.** Common case is "what happened yesterday." But if team runs this on Monday morning to catch up Fri/Sat/Sun, default is wrong. Alternatives: today-to-today (likely empty), last-7-days (broader sweep), or remember the last-used range from localStorage as default. Recommend **localStorage-remembered with yesterday-to-yesterday as initial fallback**.

2. **5,000-row hard cap on Order Detail tab.** Caps prevent browser death but mean truly large multi-account queries get truncated. Acceptable for v2 since CSV export is unlimited?

3. **`Export All` button (consolidated + per-account ZIP).** Deferred to v3 in current draft. Worth pulling into v2? Adds ~half day.

4. **Sticky Compute button** — sometimes obstructs accordion content as it scrolls. Acceptable, or make it dismissible after first compute?

5. **"Continue" button label.** Worth gut-checking: does "Continue" feel like step 1 of 2, or could "Next" / "Load configuration" be clearer? My pick: "Continue" — short, action-oriented, doesn't promise side-effects.

## Corrections from implementation-readiness review

The following issues were found in a second adversarial review pass and corrected in this spec:

1. **`master_product_id` confusion** — earlier draft claimed consolidation joins on a `master_product_id` UUID resolved via `sku_mappings`. v1 actually uses the `dp_cogs.master_product` STRING. Spec now correctly uses the string with `trim+toLowerCase` normalization. v3 fold-back will move to `master_sku_id` UUID when `dp_*` retires.

2. **Benchmark window math errors** — earlier table had two arithmetic errors:
   - `2026-04-20`: said February finalised; correct answer is **March finalised** (boundary day inclusive).
   - `2026-03-31`: said January finalised; correct answer is **February finalised**.
   Both corrected with worked-out `end_of_month + lagDays ≤ today` derivations in the table.

3. **Timezone undefined** — earlier draft used naive `Date` math, which would give wrong results for IST sellers near midnight. Spec now explicitly uses `Asia/Kolkata` via `date-fns-tz`.

4. **Tenant-scoping security gap** — multi-account endpoints had no explicit tenant verification beyond the v1 single-account check. `dp_orders` rows have no `tenant_id` column, so the only defence is verifying every requested account belongs to the caller. Now spec'd as a non-optional security requirement on both `/api/daily-pnl/results` and `/api/daily-pnl/benchmark-status`.

5. **Legacy null `orders.marketplace_account_id` handling** — earlier draft assumed the column was always populated. Reality: legacy P&L imports left it null. Spec now surfaces `rows_with_null_account` as diagnostic output instead of silently miscounting.

6. **Bulk Importer `?intent=bulk-import` deep-link contract** — moved into the Bulk Importer spec, so the fallback link from the Benchmark Status card actually works.

## Future enhancements (v3 candidates)

- Fold `dp_*` tables into main schema (orders, order_financials, sku_financial_profiles)
- Comparison view: this-week vs last-week, this-month vs last-month
- "Export All" combined ZIP / multi-sheet XLSX
- Benchmark window override per-product (manual: "use only March for this SKU")
- Manual proxy mappings: "this product behaves like Y"
- Auto-suggest "you ran this 3 days ago — run again for the new 3 days?"
- Mobile / responsive layout
- Per-tenant config: override lag days (some sellers have different lag patterns)
