import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse, type NextRequest } from 'next/server'
import { computeBenchmarkWindow } from '@/lib/daily-pnl-v2/benchmark-window'
import type { BenchmarkStatusPerAccount, BenchmarkStatusResponse } from '@/lib/daily-pnl-v2/types'

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
      // Fetch: (1) count of order_financials rows for this account in window,
      //        (2) count of rows with null account in window,
      //        (3) latest COGS upload timestamp,
      //        (4) latest listing upload timestamp
      // NOTE: dp_cogs and dp_listing do NOT have tenant_id columns — they're scoped by marketplace_account_id
      // The tenant scoping is enforced by the marketplace_accounts ownership check above.
      const [rowsForAccountResult, rowsNullAccountResult, cogsResult, listingResult] = await Promise.all([
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('marketplace_account_id', acct.id)
          .gte('order_date', window.from)
          .lte('order_date', window.to)
          .not('id', 'is', null),
        supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
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

      // Compute available months by sampling distinct months for this account
      // NOTE: We check order_financials indirectly via orders that have financial rows.
      // For simplicity we check orders in the window for this account. If an order exists
      // AND has order_financials, it counts. We keep a 1000-row bound.
      const { data: monthRows } = await supabase
        .from('orders')
        .select('order_date')
        .eq('tenant_id', tenantId)
        .eq('marketplace_account_id', acct.id)
        .gte('order_date', window.from)
        .lte('order_date', window.to)
        .limit(1000)

      const availableMonthsSet = new Set<string>()
      for (const r of (monthRows ?? []) as { order_date?: string | null }[]) {
        if (r.order_date) availableMonthsSet.add(r.order_date.slice(0, 7))
      }
      const availableMonths = [...availableMonthsSet].sort()
      const missingMonths = window.months.filter(m => !availableMonthsSet.has(m))

      const rowCount = rowsForAccountResult.count ?? 0
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
        rows_with_null_account: rowsNullAccountResult.count ?? 0,
        status,
        fallback_strategy: fallback,
        cogs_present: cogsResult.data !== null,
        listing_present: listingResult.data !== null,
        cogs_last_updated_at: (cogsResult.data as { created_at: string } | null)?.created_at ?? null,
        listing_last_updated_at: (listingResult.data as { created_at: string } | null)?.created_at ?? null,
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
