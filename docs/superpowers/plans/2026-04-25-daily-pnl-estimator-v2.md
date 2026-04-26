# Daily P&L Estimator v2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the Daily P&L Estimator at `/daily-pnl` from single-account to multi-account with consolidated cross-account results, temporally-aware benchmark sourcing from `order_financials`, similar-priced product proxy, and a two-step Configure → Compute workflow.

**Architecture:** Two-step page flow. New `benchmark-status` API computes per-account data availability against today's IST clock (20-day finalisation lag). Updated `results` API does multi-account aggregation with quantity-weighted consolidation, similar-priced proxy fallback, and required tenant-scoping security check. Results render as accordion: Consolidated open at top, per-account collapsed below. Listing/COGS/Orders stay in `dp_*` tables for v2 — only the P&L benchmark source changes.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase, shadcn/ui (Accordion, Checkbox, Select, DropdownMenu), `date-fns` + `date-fns-tz` (need to verify or add), sonner toasts, lucide-react.

**Spec source of truth:** `docs/superpowers/specs/2026-04-25-daily-pnl-estimator-v2-design.md`

**Depends on:** `Bulk P&L Importer` (spec + plan, same date) — the "Upload P&L now" link in Benchmark Status mounts `BulkImportDialog`. If the importer ships first, deep-linking works instantly. If v2 ships first, the link gracefully falls back to `/pnl?intent=bulk-import` (handled in Task 17).

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/lib/daily-pnl/benchmark-window.ts` | Pure date math: latest-finalised-month + window from IST today |
| `src/lib/daily-pnl/similar-price-proxy.ts` | Pure: pick a similar-priced product from candidate pool |
| `src/app/api/daily-pnl/benchmark-status/route.ts` | GET: per-account benchmark availability + COGS/Listing presence |
| `src/components/daily-pnl/ConfigurationCard.tsx` | Channel + accounts (multi-select) + dispatch range + Continue button |
| `src/components/daily-pnl/BenchmarkStatusCard.tsx` | Per-account benchmark / COGS / Listing status with Bulk Importer deep-link |
| `src/components/daily-pnl/PerAccountUploadSection.tsx` | One per account: Orders required + Listing/COGS collapsed |
| `src/components/daily-pnl/ResultsAccordion.tsx` | Consolidated open + per-account collapsed sections |
| `src/components/daily-pnl/EmptyState.tsx` | Zero-accounts empty state replacing the page below the heading |

### Existing files to modify

| File | Change |
|---|---|
| `src/types/database.ts` and/or `src/lib/daily-pnl/types.ts` | Add `proxy_source` to `ConsolidatedRow`; add new response shapes for v2 APIs |
| `src/app/api/daily-pnl/results/route.ts` | Multi-account query params; tenant-scoping security check; consolidated + per-account computation; similar-priced proxy integration |
| `src/components/daily-pnl/ChannelAccountSelector.tsx` | Convert account dropdown to multi-select (checkbox menu) |
| `src/components/daily-pnl/UploadPanel.tsx` | Lighten — embedded inside `PerAccountUploadSection`; only Orders dropzone is required |
| `src/components/daily-pnl/ResultsTabs.tsx` | Add `Account` column to Order Detail (consolidated); add `Accounts` column to Consolidated tab |
| `src/app/(dashboard)/daily-pnl/page.tsx` | Rewrite as two-step page wiring all the above + localStorage persistence |

### Files NOT touched

`dp_orders`, `dp_listing`, `dp_cogs` tables stay as-is. `dp_pnl_history` keeps existing data but is no longer read by v2 (deprecated; will be retired in v3 fold-back).

---

## Chunk 1: Pure utilities (benchmark window + similar-price proxy)

### Task 1: Verify or install `date-fns-tz`

- [ ] **Step 1: Check whether date-fns-tz is installed**

Run: `node -e "console.log(require('date-fns-tz'))"` from project root.

- [ ] **Step 2: If missing, install**

```bash
npm install date-fns-tz
```

If `date-fns` is also missing, install both: `npm install date-fns date-fns-tz`.

- [ ] **Step 3: Commit if installed**

```bash
git add package.json package-lock.json
git commit -m "deps: add date-fns-tz for IST-aware benchmark window math"
```

### Task 2: Benchmark window utility

**Files:**
- Create: `src/lib/daily-pnl/benchmark-window.ts`

- [ ] **Step 1: Create the utility**

```typescript
import { addDays, endOfMonth, format, startOfMonth, subMonths } from 'date-fns'
import { utcToZonedTime } from 'date-fns-tz'

export const DEFAULT_LAG_DAYS = 20
export const DEFAULT_TZ = 'Asia/Kolkata'
export const DEFAULT_MONTHS_REQUIRED = 2

export interface BenchmarkWindow {
  from: string         // YYYY-MM-DD
  to: string           // YYYY-MM-DD
  months: string[]     // ['2026-02', '2026-03']
  monthsLabel: string  // 'Feb–Mar 2026'
  rationale: string
}

/**
 * Compute the recommended P&L benchmark window:
 *   - "today" is taken from IST (Asia/Kolkata) regardless of server clock
 *   - latest finalised month M = the latest M where end_of_month(M) + lagDays <= today
 *   - window spans the previous `monthsRequired` finalised months
 *
 * Edge cases (verified by unit tests):
 *   today=2026-04-25 → window Feb–Mar 2026 (Mar finalised on Apr 20)
 *   today=2026-04-20 → window Feb–Mar 2026 (boundary inclusive)
 *   today=2026-04-19 → window Jan–Feb 2026 (Mar not yet finalised)
 *   today=2026-03-31 → window Jan–Feb 2026 (Feb finalised on Mar 20)
 *   today=2026-01-05 → window Oct–Nov 2025 (cross-year)
 *   today=2026-01-20 → window Nov–Dec 2025 (cross-year boundary)
 */
export function computeBenchmarkWindow(
  utcNow: Date,
  lagDays: number = DEFAULT_LAG_DAYS,
  monthsRequired: number = DEFAULT_MONTHS_REQUIRED,
  tz: string = DEFAULT_TZ,
): BenchmarkWindow {
  const today = utcToZonedTime(utcNow, tz)
  const latestFinalised = findLatestFinalisedMonth(today, lagDays)
  const windowStart = startOfMonth(subMonths(latestFinalised, monthsRequired - 1))
  const windowEnd = endOfMonth(latestFinalised)

  const months = enumerateMonths(windowStart, windowEnd)
  const monthsLabel = formatMonthsLabel(windowStart, windowEnd)

  return {
    from: format(windowStart, 'yyyy-MM-dd'),
    to: format(windowEnd, 'yyyy-MM-dd'),
    months,
    monthsLabel,
    rationale: `Today is ${format(today, 'MMM d, yyyy')} (${tz}). Most recent finalised P&L = ${format(latestFinalised, 'MMM yyyy')} (${lagDays}-day lag rule). Recommended window = previous ${monthsRequired} finalised months.`,
  }
}

function findLatestFinalisedMonth(today: Date, lagDays: number): Date {
  let m = startOfMonth(today)
  while (true) {
    const finalisedDate = addDays(endOfMonth(m), lagDays)
    if (finalisedDate <= today) return m
    m = subMonths(m, 1)
  }
}

function enumerateMonths(start: Date, end: Date): string[] {
  const out: string[] = []
  let cursor = startOfMonth(start)
  const stop = startOfMonth(end)
  while (cursor <= stop) {
    out.push(format(cursor, 'yyyy-MM'))
    cursor = startOfMonth(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
  }
  return out
}

function formatMonthsLabel(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear()
  const startLabel = format(start, sameYear ? 'MMM' : 'MMM yyyy')
  const endLabel = format(end, 'MMM yyyy')
  return `${startLabel}–${endLabel}`
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification of edge cases**

Run inline node script (use `npx tsx` if needed):

```bash
npx tsx -e "
import { computeBenchmarkWindow } from './src/lib/daily-pnl/benchmark-window';
const cases = [
  ['2026-04-25T05:30:00Z', 'Feb–Mar 2026'],   // mid-Apr → window Feb-Mar
  ['2026-04-20T05:30:00Z', 'Feb–Mar 2026'],   // boundary inclusive
  ['2026-04-19T05:30:00Z', 'Jan–Feb 2026'],   // one day before
  ['2026-03-31T05:30:00Z', 'Jan–Feb 2026'],   // end of month
  ['2026-04-01T05:30:00Z', 'Jan–Feb 2026'],   // start of month
  ['2026-01-05T05:30:00Z', 'Oct–Nov 2025'],   // cross-year
  ['2026-01-20T05:30:00Z', 'Nov–Dec 2025'],   // cross-year boundary
];
for (const [iso, expected] of cases) {
  const w = computeBenchmarkWindow(new Date(iso));
  const ok = w.monthsLabel === expected;
  console.log(ok ? 'OK' : 'FAIL', iso, '=>', w.monthsLabel, '(expected', expected + ')');
}
"
```

Expected: all cases print `OK`. If any FAIL, fix the math before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/daily-pnl/benchmark-window.ts
git commit -m "feat(daily-pnl): IST-aware benchmark window utility with edge-case coverage"
```

### Task 3: Similar-priced proxy

**Files:**
- Create: `src/lib/daily-pnl/similar-price-proxy.ts`

- [ ] **Step 1: Create the utility**

```typescript
export interface ProxyTarget {
  master_product: string
  avg_bank_settlement: number | null
  account_name: string
}

export interface ProxyCandidate {
  master_product: string
  avg_bank_settlement: number
  delivery_rate: number
  est_return_cost_per_dispatched_unit: number
  account_name: string
  dispatched_units: number
}

export interface ProxyResult {
  delivery_rate: number
  est_return_cost_per_dispatched_unit: number
  proxy_master_product: string
  proxy_account_name: string
}

const RANGE = 0.25  // ±25%

/**
 * Find a similar-priced product to use as a benchmark proxy when the target
 * product has no historical P&L data.
 *
 * Returns null if:
 *   - target.avg_bank_settlement is null or <= 0
 *   - no candidate falls within ±25% of target settlement
 *
 * Tiebreakers (when multiple candidates are equidistant):
 *   1. Prefer candidate with more dispatched_units (statistical reliability)
 *   2. Prefer alphabetic master_product (deterministic fallback)
 */
export function findSimilarPricedProxy(
  target: ProxyTarget,
  candidates: ProxyCandidate[],
): ProxyResult | null {
  if (target.avg_bank_settlement == null || target.avg_bank_settlement <= 0) return null
  const targetPrice = target.avg_bank_settlement

  const min = targetPrice * (1 - RANGE)
  const max = targetPrice * (1 + RANGE)
  const inRange = candidates.filter(c => c.avg_bank_settlement >= min && c.avg_bank_settlement <= max)
  if (inRange.length === 0) return null

  // Sort by absolute price distance, then by -dispatched_units, then alphabetic
  const sorted = inRange.slice().sort((a, b) => {
    const dA = Math.abs(a.avg_bank_settlement - targetPrice)
    const dB = Math.abs(b.avg_bank_settlement - targetPrice)
    if (dA !== dB) return dA - dB
    if (b.dispatched_units !== a.dispatched_units) return b.dispatched_units - a.dispatched_units
    return a.master_product.localeCompare(b.master_product)
  })
  const winner = sorted[0]
  return {
    delivery_rate: winner.delivery_rate,
    est_return_cost_per_dispatched_unit: winner.est_return_cost_per_dispatched_unit,
    proxy_master_product: winner.master_product,
    proxy_account_name: winner.account_name,
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/daily-pnl/similar-price-proxy.ts
git commit -m "feat(daily-pnl): similar-priced proxy with ±25% range + tiebreakers"
```

### Task 4: Update types

**Files:**
- Modify: `src/lib/daily-pnl/types.ts`

- [ ] **Step 1: Add new fields and types**

Find `ConsolidatedRow` and add `proxy_source`:

```typescript
export interface ConsolidatedRow {
  // ... existing fields ...
  proxy_source?: { master_product: string; account_name: string } | null
  contributing_accounts?: string[]   // for the new "Accounts" column on Consolidated tab
}
```

Add new types for v2 endpoints:

```typescript
export interface BenchmarkStatusPerAccount {
  marketplace_account_id: string
  account_name: string
  available_months: string[]
  missing_months: string[]
  rows_in_window: number
  rows_with_null_account: number
  status: 'full' | 'partial' | 'none'
  fallback_strategy: 'similar_priced' | 'portfolio_average' | null
  cogs_present: boolean
  listing_present: boolean
  cogs_last_updated_at: string | null
  listing_last_updated_at: string | null
}

export interface BenchmarkStatusResponse {
  benchmark_window: { from: string; to: string; monthsLabel: string; rationale: string }
  per_account: BenchmarkStatusPerAccount[]
}

export interface ResultsResponseV2 {
  benchmark_window: { from: string; to: string; monthsLabel: string }
  consolidated: ResultsResponse
  per_account: Array<{
    marketplace_account_id: string
    account_name: string
    has_orders_in_range: boolean
    results: ResultsResponse | null
  }>
  warnings: string[]
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/daily-pnl/types.ts
git commit -m "types(daily-pnl): add v2 response shapes + proxy_source on ConsolidatedRow"
```

---

## Chunk 2: API endpoints

### Task 5: Benchmark-status API

**Files:**
- Create: `src/app/api/daily-pnl/benchmark-status/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse, type NextRequest } from 'next/server'
import { computeBenchmarkWindow } from '@/lib/daily-pnl/benchmark-window'
import type { BenchmarkStatusPerAccount, BenchmarkStatusResponse } from '@/lib/daily-pnl/types'

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    const idsParam = searchParams.get('marketplace_account_ids') ?? ''
    const requestedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (requestedIds.length === 0) {
      return NextResponse.json({ error: 'marketplace_account_ids required' }, { status: 400 })
    }

    // SECURITY: verify every requested account belongs to the tenant
    const { data: ownedAccounts, error: ownErr } = await supabase
      .from('marketplace_accounts')
      .select('id, account_name')
      .eq('tenant_id', tenantId)
      .in('id', requestedIds)
    if (ownErr) throw ownErr
    if (!ownedAccounts || ownedAccounts.length !== requestedIds.length) {
      return NextResponse.json({ error: 'One or more accounts not found' }, { status: 403 })
    }

    const window = computeBenchmarkWindow(new Date())

    const perAccount: BenchmarkStatusPerAccount[] = []

    for (const acct of ownedAccounts) {
      // Per-account row count in window via order_financials joined to orders.
      // Two queries: rows for this account (non-null) + rows with null account in window
      const [{ count: rowsForAccount }, { count: rowsNullAccount }, { data: cogsRow }, { data: listingRow }] = await Promise.all([
        supabase
          .from('orders')
          .select('id, order_financials!inner(order_item_id)', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('marketplace_account_id', acct.id)
          .gte('order_date', window.from)
          .lte('order_date', window.to),
        supabase
          .from('orders')
          .select('id, order_financials!inner(order_item_id)', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .is('marketplace_account_id', null)
          .gte('order_date', window.from)
          .lte('order_date', window.to),
        supabase
          .from('dp_cogs')
          .select('created_at')
          .eq('marketplace_account_id', acct.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('dp_listing')
          .select('created_at')
          .eq('marketplace_account_id', acct.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      // Compute available months by sampling distinct months in the window for this account
      const { data: monthRows } = await supabase
        .from('orders')
        .select('order_date, order_financials!inner(order_item_id)')
        .eq('tenant_id', tenantId)
        .eq('marketplace_account_id', acct.id)
        .gte('order_date', window.from)
        .lte('order_date', window.to)
        .limit(1000)   // bounded — we only need distinct months
      const availableMonthsSet = new Set<string>()
      for (const r of (monthRows ?? []) as { order_date?: string }[]) {
        if (r.order_date) availableMonthsSet.add(r.order_date.slice(0, 7))
      }
      const availableMonths = [...availableMonthsSet].sort()
      const missingMonths = window.months.filter(m => !availableMonthsSet.has(m))

      const rowCount = rowsForAccount ?? 0
      const status: 'full' | 'partial' | 'none' =
        availableMonths.length === window.months.length && rowCount > 0 ? 'full'
        : availableMonths.length > 0 ? 'partial'
        : 'none'
      const fallback: BenchmarkStatusPerAccount['fallback_strategy'] =
        status === 'full' ? null
        : status === 'partial' ? 'portfolio_average'
        : 'similar_priced'

      perAccount.push({
        marketplace_account_id: acct.id,
        account_name: acct.account_name,
        available_months: availableMonths,
        missing_months: missingMonths,
        rows_in_window: rowCount,
        rows_with_null_account: rowsNullAccount ?? 0,
        status,
        fallback_strategy: fallback,
        cogs_present: cogsRow !== null,
        listing_present: listingRow !== null,
        cogs_last_updated_at: cogsRow?.created_at ?? null,
        listing_last_updated_at: listingRow?.created_at ?? null,
      })
    }

    const response: BenchmarkStatusResponse = {
      benchmark_window: {
        from: window.from,
        to: window.to,
        monthsLabel: window.monthsLabel,
        rationale: window.rationale,
      },
      per_account: perAccount,
    }
    return NextResponse.json(response)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If the inner-join syntax `order_financials!inner(...)` doesn't return counts properly with PostgREST, fall back to two queries: first SELECT all `order_financials` order_item_ids in window, then JOIN locally to `orders.marketplace_account_id`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/daily-pnl/benchmark-status/route.ts
git commit -m "feat(daily-pnl): GET /benchmark-status — per-account benchmark + COGS/Listing presence"
```

### Task 6: Updated results API (multi-account + tenant scoping + proxy)

**Files:**
- Modify: `src/app/api/daily-pnl/results/route.ts`

- [ ] **Step 1: Read the existing route**

It currently fetches dp_orders/dp_listing/dp_cogs/dp_pnl_history for ONE account and computes per-product P&L. We need to:
1. Accept multiple `marketplace_account_ids`
2. **Verify every ID belongs to tenant** (security)
3. Fetch dp_orders/dp_listing/dp_cogs across all selected accounts (one query each, `IN`)
4. Read benchmark from `order_financials` (NOT `dp_pnl_history`) within the computed benchmark window
5. Compute per-account ResultsResponse (existing logic per slice)
6. Compute consolidated ResultsResponse by pooling all accounts and grouping by normalised `master_product` string (NOT `master_product_id`)
7. Apply similar-priced proxy where benchmark missing
8. Return v2 response shape

- [ ] **Step 2: Rewrite the handler**

Replace the entire content of `src/app/api/daily-pnl/results/route.ts` with the v2 handler. **Key code shape:**

```typescript
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse, type NextRequest } from 'next/server'
import { computeBenchmarkWindow } from '@/lib/daily-pnl/benchmark-window'
import { findSimilarPricedProxy, type ProxyCandidate } from '@/lib/daily-pnl/similar-price-proxy'
import type { ResultsResponse, ResultsResponseV2 } from '@/lib/daily-pnl/types'

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    const idsParam = searchParams.get('marketplace_account_ids') ?? ''
    const requestedIds = idsParam.split(',').map(s => s.trim()).filter(Boolean)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (requestedIds.length === 0 || !from || !to) {
      return NextResponse.json({ error: 'marketplace_account_ids, from, to are required' }, { status: 400 })
    }

    // SECURITY: tenant scoping
    const { data: owned, error: ownErr } = await supabase
      .from('marketplace_accounts')
      .select('id, account_name')
      .eq('tenant_id', tenantId)
      .in('id', requestedIds)
    if (ownErr) throw ownErr
    if (!owned || owned.length !== requestedIds.length) {
      return NextResponse.json({ error: 'One or more accounts not found' }, { status: 403 })
    }
    const accountNameById = new Map(owned.map(a => [a.id, a.account_name]))

    // Compute benchmark window (today in IST)
    const window = computeBenchmarkWindow(new Date())

    // === Fetch all data in parallel ===
    const [
      { data: orderRows },
      { data: listingRows },
      { data: cogsRows },
      { data: benchmarkRows },
    ] = await Promise.all([
      supabase
        .from('dp_orders')
        .select('marketplace_account_id, order_item_id, order_id, sku, quantity, dispatched_date, order_item_status')
        .in('marketplace_account_id', requestedIds)
        .not('dispatched_date', 'is', null)
        .gte('dispatched_date', from)
        .lte('dispatched_date', to),
      supabase
        .from('dp_listing')
        .select('marketplace_account_id, seller_sku_id, mrp, bank_settlement, selling_price, benchmark_price')
        .in('marketplace_account_id', requestedIds),
      supabase
        .from('dp_cogs')
        .select('marketplace_account_id, sku, master_product, cogs')
        .in('marketplace_account_id', requestedIds),
      // Benchmark from main schema:
      supabase
        .from('orders')
        .select(`
          marketplace_account_id,
          order_date,
          order_financials!inner(
            sku_name, gross_units, rto_units, rvp_units, cancelled_units, total_expenses
          )
        `)
        .eq('tenant_id', tenantId)
        .in('marketplace_account_id', requestedIds)
        .gte('order_date', window.from)
        .lte('order_date', window.to),
    ])

    // === Per-account computation ===
    // For each account, compute the ResultsResponse using v1 logic on its slice of data
    // (delivered/RTO/RVP, return cost / unit, est rev / unit, etc.)
    // Reuse existing helper functions if they exist in src/lib/daily-pnl/; otherwise inline

    // ... computation here — keep formulas exactly per spec section "Aggregation logic"
    // Critically:
    //   - cogsMap key:  (account_id, sku.lowercase())
    //   - listingMap key: (account_id, seller_sku_id.lowercase())
    //   - benchmark grouping: per-account, by master_product string (trim+lowercase) from cogsMap
    //   - similar-price proxy: when an account's master_product has 0 benchmark rows, build candidate pool
    //     from OTHER accounts that DO have benchmark for any master_product, and call findSimilarPricedProxy

    // === Consolidated computation ===
    // Pool all accounts' rows together, group by normalised master_product string
    // For each group:
    //   consolidated.qty = Σ per-account qty
    //   consolidated.avg_bank_settlement = Σ(account_avg × account_qty) / Σ(account_qty)
    //   consolidated.cogs_per_unit = the COGS from any contributing account (they should agree;
    //     if they differ, take the qty-weighted average and surface a warning)
    //   delivery_rate / est_return_cost_per_unit: looked up from the POOLED benchmark
    //     (all selected accounts' rows for this master_product) — NOT averaged across per-account values

    const perAccount = owned.map(a => ({
      marketplace_account_id: a.id,
      account_name: a.account_name,
      has_orders_in_range: (orderRows ?? []).some(r => r.marketplace_account_id === a.id),
      results: null as ResultsResponse | null,  // populated below
    }))

    // ... fill in `perAccount[i].results` and consolidated by running v1 logic on per-account and pooled slices ...

    const consolidated: ResultsResponse = {} as ResultsResponse  // populated by computation above

    const warnings: string[] = []

    const response: ResultsResponseV2 = {
      benchmark_window: {
        from: window.from,
        to: window.to,
        monthsLabel: window.monthsLabel,
      },
      consolidated,
      per_account: perAccount,
      warnings,
    }
    return NextResponse.json(response)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

> **Implementation note:** the calculation logic from v1 (in the existing `results/route.ts`) is well-tested against the spec workbook. Refactor it into a helper function `computeResultsForSlice(orderRows, listingRows, cogsRows, benchmarkRows)` so it can be called once for each per-account slice AND once for the pooled (consolidated) data. The per-account call uses that account's data and benchmark; the consolidated call uses ALL data and ALL benchmark pooled.

For the **proxy fallback**: when computing per-account results, if a master_product in that account has zero benchmark rows in the pooled benchmark, build a candidate pool from OTHER accounts' master_products that DO have benchmark, and call `findSimilarPricedProxy`. Set `proxy_source: { master_product, account_name }` on the resulting `ConsolidatedRow`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. The implementation will be substantial — break into smaller subtasks if needed during execution.

- [ ] **Step 4: Manual verification against the spec workbook**

Use the sample Flipkart files to recompute against the v1 numbers (which were validated to the rupee). For NuvioShop alone:
- Configure: NuvioShop only, dispatch range 2026-04-23 to 2026-04-24
- Expected total Est. P&L ≈ ₹2,152 (matching v1)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/daily-pnl/results/route.ts
git commit -m "feat(daily-pnl): v2 results — multi-account + tenant scoping + benchmark from order_financials + similar-price proxy"
```

---

## Chunk 3: UI building blocks

### Task 7: Multi-select ChannelAccountSelector

**Files:**
- Modify: `src/components/daily-pnl/ChannelAccountSelector.tsx`

- [ ] **Step 1: Read existing component**

Locate the single-account `<Select>`. Replace with a multi-select pattern using shadcn `DropdownMenu` + `DropdownMenuCheckboxItem`.

- [ ] **Step 2: Update the component**

Convert to multi-select:

```tsx
'use client'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import type { MarketplaceAccount } from '@/types'

interface Props {
  accounts: MarketplaceAccount[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function ChannelAccountSelector({ accounts, selectedIds, onChange }: Props) {
  const flipkart = accounts.filter(a => a.platform === 'flipkart')

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id])
  }
  function selectAll() { onChange(flipkart.map(a => a.id)) }
  function clearAll() { onChange([]) }

  const triggerLabel = selectedIds.length === 0
    ? 'Select accounts'
    : selectedIds.length === flipkart.length
      ? 'All accounts'
      : `${selectedIds.length} accounts`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-56 justify-between">
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-4 w-4 ml-2 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuItem onSelect={selectAll}>Select all</DropdownMenuItem>
        <DropdownMenuItem onSelect={clearAll}>Clear all</DropdownMenuItem>
        <DropdownMenuSeparator />
        {flipkart.map(a => (
          <DropdownMenuCheckboxItem
            key={a.id}
            checked={selectedIds.includes(a.id)}
            onCheckedChange={() => toggle(a.id)}
          >
            {a.account_name}
          </DropdownMenuCheckboxItem>
        ))}
        {flipkart.length === 0 && (
          <DropdownMenuItem disabled>No Flipkart accounts</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/daily-pnl/ChannelAccountSelector.tsx
git commit -m "feat(daily-pnl): multi-select account picker via DropdownMenuCheckboxItem"
```

### Task 8: ConfigurationCard

**Files:**
- Create: `src/components/daily-pnl/ConfigurationCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { ChannelAccountSelector } from './ChannelAccountSelector'
import type { MarketplaceAccount, Platform } from '@/types'

interface Props {
  accounts: MarketplaceAccount[]
  channel: Platform
  selectedAccountIds: string[]
  dispatchFrom: string
  dispatchTo: string
  onChannelChange: (p: Platform) => void
  onAccountsChange: (ids: string[]) => void
  onDispatchFromChange: (s: string) => void
  onDispatchToChange: (s: string) => void
  onContinue: () => void
}

export function ConfigurationCard(props: Props) {
  const canContinue = props.selectedAccountIds.length > 0 && !!props.dispatchFrom && !!props.dispatchTo
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <h2 className="text-lg font-bold">Daily P&amp;L Estimator</h2>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Channel</Label>
          <Select value={props.channel} onValueChange={(v) => props.onChannelChange(v as Platform)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="flipkart">Flipkart</SelectItem>
              <SelectItem value="amazon" disabled>Amazon 🔜</SelectItem>
              <SelectItem value="d2c" disabled>D2C 🔜</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Accounts</Label>
          <ChannelAccountSelector
            accounts={props.accounts}
            selectedIds={props.selectedAccountIds}
            onChange={props.onAccountsChange}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs flex items-center gap-1">
            Dispatch date
            <InfoTooltip content="When the order was shipped from your warehouse — not when ordered or delivered." />
          </Label>
          <div className="flex gap-2">
            <Input type="date" value={props.dispatchFrom} onChange={(e) => props.onDispatchFromChange(e.target.value)} className="w-36" />
            <Input type="date" value={props.dispatchTo} onChange={(e) => props.onDispatchToChange(e.target.value)} className="w-36" />
          </div>
        </div>
        <Button onClick={props.onContinue} disabled={!canContinue}>Continue</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/daily-pnl/ConfigurationCard.tsx
git commit -m "feat(daily-pnl): ConfigurationCard with multi-select + Continue button"
```

### Task 9: BenchmarkStatusCard

**Files:**
- Create: `src/components/daily-pnl/BenchmarkStatusCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BenchmarkStatusResponse } from '@/lib/daily-pnl/types'

interface Props {
  data: BenchmarkStatusResponse | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onOpenBulkImporter: () => void
}

function statusIcon(s: 'full' | 'partial' | 'none') {
  if (s === 'full')  return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" aria-label="Available" />
  if (s === 'partial') return <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" aria-label="Partial" />
  return <XCircle className="h-4 w-4 text-destructive shrink-0" aria-label="Missing" />
}

export function BenchmarkStatusCard({ data, loading, error, onRetry, onOpenBulkImporter }: Props) {
  if (loading && !data) {
    return (
      <div className="rounded-lg border p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking benchmark availability…
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-2">
        <p className="text-sm text-destructive">Failed to load benchmark status: {error}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
      </div>
    )
  }
  if (!data) return null

  const w = data.benchmark_window
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div>
        <h3 className="font-medium text-sm">P&amp;L Benchmark Status</h3>
        <p className="text-xs text-muted-foreground">{w.rationale}</p>
        <p className="text-xs">Recommended benchmark = <strong>{w.monthsLabel}</strong></p>
      </div>
      <ul className="space-y-2 text-sm">
        {data.per_account.map(a => {
          const cogsAge = a.cogs_last_updated_at ? daysAgo(a.cogs_last_updated_at) : null
          const listingAge = a.listing_last_updated_at ? daysAgo(a.listing_last_updated_at) : null
          return (
            <li key={a.marketplace_account_id} className="flex items-start gap-2">
              {statusIcon(a.status)}
              <div className="flex-1 min-w-0">
                <p className="font-medium">
                  {a.account_name} —{' '}
                  {a.status === 'full' && <span>Benchmark complete ({a.rows_in_window} rows)</span>}
                  {a.status === 'partial' && <span className="text-amber-700">Partial: missing {a.missing_months.join(', ')}</span>}
                  {a.status === 'none' && <span className="text-destructive">No benchmark in window</span>}
                </p>
                {a.status !== 'full' && a.fallback_strategy && (
                  <p className="text-xs text-muted-foreground">
                    Fallback: {a.fallback_strategy === 'similar_priced' ? 'similar-priced products from other accounts' : 'portfolio average'}
                  </p>
                )}
                {!a.cogs_present && (
                  <p className="text-xs text-destructive">⚠ COGS missing — required for compute</p>
                )}
                {!a.listing_present && (
                  <p className="text-xs text-destructive">⚠ Listing missing — required for compute</p>
                )}
                {a.cogs_present && cogsAge != null && cogsAge > 90 && (
                  <p className="text-xs text-amber-700">COGS is {cogsAge} days old — consider updating</p>
                )}
                {a.listing_present && listingAge != null && listingAge > 30 && (
                  <p className="text-xs text-amber-700">Listing is {listingAge} days old — consider updating</p>
                )}
                {a.status !== 'full' && (
                  <Button size="sm" variant="ghost" className="text-xs h-auto py-1 px-2 mt-1" onClick={onOpenBulkImporter}>
                    <Upload className="h-3 w-3 mr-1" /> Upload P&amp;L now via Bulk Importer
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function daysAgo(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/daily-pnl/BenchmarkStatusCard.tsx
git commit -m "feat(daily-pnl): BenchmarkStatusCard with per-account status + Bulk Importer deep-link"
```

### Task 10: PerAccountUploadSection

**Files:**
- Create: `src/components/daily-pnl/PerAccountUploadSection.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { UploadPanel } from './UploadPanel'   // reuse existing for the actual dropzones
import type { Platform } from '@/types'

interface Props {
  marketplaceAccountId: string
  accountName: string
  platform: Platform
  cogsLastUpdatedDays: number | null
  listingLastUpdatedDays: number | null
  cogsPresent: boolean
  listingPresent: boolean
  onAnyUploaded: () => void
}

export function PerAccountUploadSection(props: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <p className="font-medium text-sm">{props.accountName}</p>

      {/* Orders is the only required-per-day upload — always visible */}
      <UploadPanel
        marketplaceAccountId={props.marketplaceAccountId}
        platform={props.platform}
        onAnyUploaded={props.onAnyUploaded}
        onlyShow={['orders']}
      />

      {/* Listing + COGS — collapsed disclosure */}
      <button
        type="button"
        onClick={() => setShowAdvanced(s => !s)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Listing &amp; COGS
        {!props.listingPresent && <span className="text-destructive ml-2">(Listing missing)</span>}
        {!props.cogsPresent && <span className="text-destructive ml-2">(COGS missing)</span>}
        {props.listingPresent && props.listingLastUpdatedDays != null && (
          <span className="ml-2">· Listing {props.listingLastUpdatedDays}d old</span>
        )}
      </button>

      {showAdvanced && (
        <UploadPanel
          marketplaceAccountId={props.marketplaceAccountId}
          platform={props.platform}
          onAnyUploaded={props.onAnyUploaded}
          onlyShow={['listing', 'cogs']}
        />
      )}
    </div>
  )
}
```

> **Note:** existing `UploadPanel` component currently shows all 4 zones. For v2, add an `onlyShow?: ReportType[]` prop that filters which zones it renders. This is a small additive change to the existing component.

- [ ] **Step 2: Update UploadPanel to support `onlyShow`**

Modify `src/components/daily-pnl/UploadPanel.tsx`:
- Add `onlyShow?: Array<'orders' | 'listing' | 'cogs' | 'pnl_history'>` prop
- When provided, filter the rendered drop zones to those types only
- Default behavior (when prop is undefined) — all 4 zones, matching v1

- [ ] **Step 3: Commit**

```bash
git add src/components/daily-pnl/PerAccountUploadSection.tsx src/components/daily-pnl/UploadPanel.tsx
git commit -m "feat(daily-pnl): PerAccountUploadSection + UploadPanel onlyShow prop"
```

### Task 11: ResultsAccordion

**Files:**
- Create: `src/components/daily-pnl/ResultsAccordion.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ResultsTabs } from './ResultsTabs'
import type { ResultsResponseV2 } from '@/lib/daily-pnl/types'

interface Props {
  data: ResultsResponseV2
  dispatchFrom: string
  dispatchTo: string
}

function fmtINR(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function totalPnl(r: { consolidated: { total_est_pnl: number | null }[] } | null): number {
  if (!r) return 0
  return r.consolidated.reduce((s, row) => s + (row.total_est_pnl ?? 0), 0)
}
function totalUnits(r: { consolidated: { quantity: number }[] } | null): number {
  if (!r) return 0
  return r.consolidated.reduce((s, row) => s + row.quantity, 0)
}

export function ResultsAccordion({ data, dispatchFrom, dispatchTo }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ consolidated: true })

  function toggle(key: string) {
    setExpanded(p => ({ ...p, [key]: !p[key] }))
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Dispatch {dispatchFrom} → {dispatchTo} · Benchmark {data.benchmark_window.monthsLabel}
      </p>

      {/* Consolidated, open by default */}
      <Section
        keyName="consolidated"
        title="Consolidated"
        statsLine={`${fmtINR(totalPnl(data.consolidated))} · ${totalUnits(data.consolidated)} units`}
        expanded={!!expanded.consolidated}
        onToggle={() => toggle('consolidated')}
      >
        <ResultsTabs data={data.consolidated} from={dispatchFrom} to={dispatchTo} showAccountColumn />
      </Section>

      {/* Per-account, collapsed */}
      {data.per_account.map(acc => (
        <Section
          key={acc.marketplace_account_id}
          keyName={acc.marketplace_account_id}
          title={acc.account_name}
          statsLine={
            acc.has_orders_in_range && acc.results
              ? `${fmtINR(totalPnl(acc.results))} · ${totalUnits(acc.results)} units`
              : 'No orders in range'
          }
          expanded={!!expanded[acc.marketplace_account_id]}
          onToggle={() => toggle(acc.marketplace_account_id)}
        >
          {acc.results ? (
            <ResultsTabs data={acc.results} from={dispatchFrom} to={dispatchTo} />
          ) : (
            <p className="text-sm text-muted-foreground">No dispatched orders for this account in this date range.</p>
          )}
        </Section>
      ))}

      {data.warnings.length > 0 && (
        <ul className="text-xs text-amber-700 space-y-1">
          {data.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
        </ul>
      )}
    </div>
  )
}

function Section({ keyName, title, statsLine, expanded, onToggle, children }: {
  keyName: string
  title: string
  statsLine: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border rounded-lg">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-muted/40 transition-colors"
        aria-expanded={expanded}
        aria-controls={`section-${keyName}`}
      >
        <span className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="font-medium">{title}</span>
        </span>
        <span className="text-xs text-muted-foreground">{statsLine}</span>
      </button>
      {expanded && <div id={`section-${keyName}`} className="px-4 pb-4 pt-1 border-t">{children}</div>}
    </div>
  )
}
```

> **Note:** `ResultsTabs` will need an optional `showAccountColumn` prop to add the Account column on the Order Detail tab (only used in the consolidated view).

- [ ] **Step 2: Update ResultsTabs to support showAccountColumn**

Add `showAccountColumn?: boolean` prop. When true, render an "Account" column in the Order Detail tab table. The data needs to include the account name per row — extend `OrderDetailRow` with an optional `account_name?: string` field, populated by the v2 results API.

Also add the "Accounts" column to the Consolidated P&L tab (driven by `contributing_accounts`).

- [ ] **Step 3: Commit**

```bash
git add src/components/daily-pnl/ResultsAccordion.tsx src/components/daily-pnl/ResultsTabs.tsx src/lib/daily-pnl/types.ts
git commit -m "feat(daily-pnl): ResultsAccordion + Account columns on consolidated view"
```

### Task 12: EmptyState

**Files:**
- Create: `src/components/daily-pnl/EmptyState.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'
import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EmptyState() {
  return (
    <div className="border rounded-lg p-12 text-center space-y-4">
      <Building2 className="h-12 w-12 mx-auto text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-lg font-medium">No Flipkart accounts yet</p>
        <p className="text-sm text-muted-foreground">
          Each Seller Hub login is one account in FK-Tool. Add an account in Settings to start using the Daily P&amp;L Estimator.
        </p>
      </div>
      <Button asChild><Link href="/settings">Open Settings →</Link></Button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/daily-pnl/EmptyState.tsx
git commit -m "feat(daily-pnl): EmptyState component for zero-account tenants"
```

---

## Chunk 4: Main page rewrite

### Task 13: Rewrite /daily-pnl page

**Files:**
- Modify: `src/app/(dashboard)/daily-pnl/page.tsx`

- [ ] **Step 1: Read existing page for state shape**

Note current useState calls and the patterns used.

- [ ] **Step 2: Rewrite with two-step flow**

Replace the existing page with:

```tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfigurationCard } from '@/components/daily-pnl/ConfigurationCard'
import { BenchmarkStatusCard } from '@/components/daily-pnl/BenchmarkStatusCard'
import { PerAccountUploadSection } from '@/components/daily-pnl/PerAccountUploadSection'
import { ResultsAccordion } from '@/components/daily-pnl/ResultsAccordion'
import { EmptyState } from '@/components/daily-pnl/EmptyState'
import { BulkImportDialog } from '@/components/pnl/BulkImportDialog'
import type { MarketplaceAccount, Platform } from '@/types'
import type { BenchmarkStatusResponse, ResultsResponseV2 } from '@/lib/daily-pnl/types'

const STORAGE_KEY = 'fk-tool:daily-pnl:last-config'

function yesterday(): string {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export default function DailyPnlPage() {
  // Configuration
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [channel, setChannel] = useState<Platform>('flipkart')
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [dispatchFrom, setDispatchFrom] = useState(yesterday())
  const [dispatchTo, setDispatchTo] = useState(yesterday())

  // Step 2 (revealed after Continue)
  const [continued, setContinued] = useState(false)
  const [benchmarkStatus, setBenchmarkStatus] = useState<BenchmarkStatusResponse | null>(null)
  const [benchmarkLoading, setBenchmarkLoading] = useState(false)
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null)

  // Compute / Results
  const [results, setResults] = useState<ResultsResponseV2 | null>(null)
  const [computing, setComputing] = useState(false)

  const [bulkImportOpen, setBulkImportOpen] = useState(false)

  // Load accounts on mount + restore last config from localStorage
  useEffect(() => {
    fetch('/api/marketplace-accounts')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load accounts')))
      .then((data: MarketplaceAccount[]) => {
        setAccounts(data ?? [])
        setAccountsLoaded(true)

        // Restore last config (filter to still-existing accounts)
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY)
          if (raw) {
            const last = JSON.parse(raw) as { channel?: Platform; accountIds?: string[]; from?: string; to?: string }
            if (last.channel) setChannel(last.channel)
            if (last.accountIds) {
              const stillExist = last.accountIds.filter(id => (data ?? []).some(a => a.id === id))
              if (stillExist.length > 0) setSelectedAccountIds(stillExist)
            }
            if (last.from) setDispatchFrom(last.from)
            if (last.to) setDispatchTo(last.to)
          }
        } catch { /* ignore */ }
      })
      .catch(e => {
        toast.error((e as Error).message)
        setAccountsLoaded(true)
      })
  }, [])

  // Persist config on change
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        channel, accountIds: selectedAccountIds, from: dispatchFrom, to: dispatchTo,
      }))
    } catch { /* ignore */ }
  }, [channel, selectedAccountIds, dispatchFrom, dispatchTo])

  // Continue → fetch benchmark status
  const handleContinue = useCallback(async () => {
    setContinued(true)
    setResults(null)
    await loadBenchmarkStatus()
  }, [selectedAccountIds, dispatchFrom, dispatchTo])

  const loadBenchmarkStatus = useCallback(async () => {
    if (selectedAccountIds.length === 0) return
    setBenchmarkLoading(true); setBenchmarkError(null)
    try {
      const url = `/api/daily-pnl/benchmark-status?marketplace_account_ids=${selectedAccountIds.join(',')}&dispatch_from=${dispatchFrom}&dispatch_to=${dispatchTo}`
      const res = await fetch(url)
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      setBenchmarkStatus(await res.json())
    } catch (e) {
      setBenchmarkError((e as Error).message)
    } finally {
      setBenchmarkLoading(false)
    }
  }, [selectedAccountIds, dispatchFrom, dispatchTo])

  // Reset Step-2 state when configuration changes after Continue
  useEffect(() => {
    if (continued) {
      setResults(null)
      // Re-fetch benchmark status with new params
      loadBenchmarkStatus()
    }
  }, [selectedAccountIds, dispatchFrom, dispatchTo])  // eslint-disable-line

  // Bulk Importer auto-refresh on close
  function handleBulkImporterClose() {
    setBulkImportOpen(false)
    if (continued) loadBenchmarkStatus()
  }

  // Compute
  const handleCompute = useCallback(async () => {
    setComputing(true); setResults(null)
    try {
      const url = `/api/daily-pnl/results?marketplace_account_ids=${selectedAccountIds.join(',')}&from=${dispatchFrom}&to=${dispatchTo}`
      const res = await fetch(url)
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      setResults(await res.json())
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setComputing(false)
    }
  }, [selectedAccountIds, dispatchFrom, dispatchTo])

  // Compute disabled if any selected account is missing COGS or Listing
  const computeDisabled = useMemo(() => {
    if (computing) return true
    if (!benchmarkStatus) return true
    const haveAnyOrders = benchmarkStatus.per_account.some(a => a.cogs_present && a.listing_present)
    return !haveAnyOrders
  }, [benchmarkStatus, computing])

  // Empty state
  const flipkartAccounts = accounts.filter(a => a.platform === 'flipkart')
  if (accountsLoaded && flipkartAccounts.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-bold">Daily P&amp;L Estimator</h1>
        <EmptyState />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <ConfigurationCard
        accounts={accounts}
        channel={channel}
        selectedAccountIds={selectedAccountIds}
        dispatchFrom={dispatchFrom}
        dispatchTo={dispatchTo}
        onChannelChange={setChannel}
        onAccountsChange={setSelectedAccountIds}
        onDispatchFromChange={setDispatchFrom}
        onDispatchToChange={setDispatchTo}
        onContinue={handleContinue}
      />

      {continued && (
        <BenchmarkStatusCard
          data={benchmarkStatus}
          loading={benchmarkLoading}
          error={benchmarkError}
          onRetry={loadBenchmarkStatus}
          onOpenBulkImporter={() => setBulkImportOpen(true)}
        />
      )}

      {continued && benchmarkStatus && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Per-Account Uploads</h2>
          {benchmarkStatus.per_account.map(a => {
            const cogsAge = a.cogs_last_updated_at ? Math.floor((Date.now() - new Date(a.cogs_last_updated_at).getTime()) / 86400000) : null
            const listingAge = a.listing_last_updated_at ? Math.floor((Date.now() - new Date(a.listing_last_updated_at).getTime()) / 86400000) : null
            return (
              <PerAccountUploadSection
                key={a.marketplace_account_id}
                marketplaceAccountId={a.marketplace_account_id}
                accountName={a.account_name}
                platform={channel}
                cogsLastUpdatedDays={cogsAge}
                listingLastUpdatedDays={listingAge}
                cogsPresent={a.cogs_present}
                listingPresent={a.listing_present}
                onAnyUploaded={loadBenchmarkStatus}
              />
            )
          })}
        </div>
      )}

      {continued && benchmarkStatus && (
        <div className="sticky bottom-0 bg-background border-t py-3 flex justify-end">
          <Button onClick={handleCompute} disabled={computeDisabled}>
            {computing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Computing…</> : 'Compute'}
          </Button>
        </div>
      )}

      {results && (
        <ResultsAccordion
          data={results}
          dispatchFrom={dispatchFrom}
          dispatchTo={dispatchTo}
        />
      )}

      <BulkImportDialog
        open={bulkImportOpen}
        onOpenChange={(o) => o ? setBulkImportOpen(true) : handleBulkImporterClose()}
        onImportComplete={() => { /* refetch handled in close */ }}
        enabledReportTypes={['pnl']}
      />
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/daily-pnl/page.tsx
git commit -m "feat(daily-pnl): two-step page with multi-account, benchmark status, accordion results"
```

---

## Chunk 5: Deploy + smoke test

### Task 14: Final type-check and deploy

- [ ] **Step 1: Run final type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Push and deploy**

```bash
git push origin main
ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=no root@46.225.117.86 "cd /opt/fk-tool && bash deploy.sh"
```

### Task 15: Smoke test on live site

Open https://ecommerceforall.in/daily-pnl.

- [ ] **Step 1: Empty state**
  - Test only if 0 Flipkart accounts; otherwise skip.

- [ ] **Step 2: Configuration card renders + restores last config**
  - Initial load: defaults to yesterday-yesterday and Flipkart channel.
  - After picking an account combo and date, reload — verify localStorage restores them.

- [ ] **Step 3: Multi-select**
  - Click Accounts dropdown — verify checkbox items, Select all, Clear all.
  - Pick 2 accounts → trigger label updates ("2 accounts").

- [ ] **Step 4: Continue → Benchmark Status**
  - Click Continue → loading skeleton briefly → BenchmarkStatusCard renders.
  - Verify rationale string ("Today is …, Most recent finalised P&L = …, Recommended window = …").
  - Verify per-account rows reflect actual state (✅/⚠️/❌ + COGS/Listing presence + age warnings).

- [ ] **Step 5: Bulk Importer deep-link**
  - For an account with `status='partial'` or `status='none'`, click "Upload P&L now via Bulk Importer".
  - Verify BulkImportDialog opens (with `enabledReportTypes={['pnl']}` — only the P&L card visible).
  - Upload a P&L file for that account, complete the flow, close.
  - Verify BenchmarkStatusCard auto-refreshes.

- [ ] **Step 6: Per-Account Uploads**
  - Verify one section per selected account.
  - Orders dropzone is always visible.
  - Listing/COGS section is collapsed by default; expand and verify it works.

- [ ] **Step 7: Compute (multi-account)**
  - Drop Orders for at least 2 accounts (use the actual sample files, varying date ranges).
  - Click Compute → loading state → ResultsAccordion renders.
  - Consolidated section is open by default with stats line.
  - Per-account sections are collapsed with stats lines.
  - Click each per-account section → verify ResultsTabs renders correctly.

- [ ] **Step 8: Math verification**
  - Pick one master_product. Sum its `Total Est. P&L` from each per-account section. Confirm it equals the consolidated row's `Total Est. P&L` (give or take rounding).
  - Verify the v1 single-account regression case: one account, dispatch range 2026-04-23 to 2026-04-24 → Total Est. P&L should be ~₹2,152 (the spec workbook's known answer).

- [ ] **Step 9: Order Detail account column**
  - Open Consolidated → Order Detail tab.
  - Verify the new "Account" column is present with the right values.

- [ ] **Step 10: Tenant scoping security**
  - From the browser console (logged in as user A), attempt:
    ```javascript
    fetch('/api/daily-pnl/results?marketplace_account_ids=<UUID-from-another-tenant>&from=2026-04-20&to=2026-04-24').then(r=>r.json()).then(console.log)
    ```
  - Expected: 403 with `{ error: 'One or more accounts not found' }`.
  - Same check on `/api/daily-pnl/benchmark-status`.

- [ ] **Step 11: Compute with all-missing benchmark**
  - Pick an account with `status='none'` → Compute.
  - Verify either the proxy fallback applies (if other accounts have benchmark) OR a clear empty state if no benchmark anywhere.

- [ ] **Step 12: Compute partial — some accounts missing COGS**
  - Pick 2 accounts where one is missing COGS.
  - Compute → verify the missing-COGS account renders as empty section with "No dispatched orders for this account in this date range" or similar guidance, and the other account computes normally.

- [ ] **Step 13: localStorage clean restart**
  - Clear localStorage manually (`localStorage.removeItem('fk-tool:daily-pnl:last-config')`)
  - Reload — defaults to yesterday-yesterday with no accounts pre-selected.

---

## Done

Update spec status:

```bash
# Edit docs/superpowers/specs/2026-04-25-daily-pnl-estimator-v2-design.md
# Change "Status: Draft v2 (reviewed and revised)" → "Status: Shipped 2026-04-25"
git add docs/superpowers/specs/2026-04-25-daily-pnl-estimator-v2-design.md
git commit -m "docs: mark daily pnl estimator v2 spec as shipped"
git push origin main
```
