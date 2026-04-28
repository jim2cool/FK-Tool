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

    const bmWindow = computeBenchmarkWindow(new Date())

    // Run once outside the loop — same result for every account
    const { count: rowsWithNullAccount } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('marketplace_account_id', null)
      .gte('order_date', bmWindow.from)
      .lte('order_date', bmWindow.to)

    const perAccount: BenchmarkStatusPerAccount[] = []

    for (const acct of ownedAccounts) {
      // Fetch cogs/listing presence in parallel while we prepare the financials check below
      const [cogsResult, listingResult] = await Promise.all([
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

      // Step 1: Get order UUIDs + dates for this account in the benchmark window.
      const { data: acctOrders } = await supabase
        .from('orders')
        .select('id, order_date')
        .eq('tenant_id', tenantId)
        .eq('marketplace_account_id', acct.id)
        .gte('order_date', bmWindow.from)
        .lte('order_date', bmWindow.to)
        .limit(5000)

      const acctOrderUUIDs = (acctOrders ?? []).map(r => r.id)

      // Step 2: Count how many of those orders have order_financials rows.
      // order_financials links to orders via order_id (UUID), NOT order_item_id.
      let rowCount = 0
      const availableMonthsSet = new Set<string>()

      if (acctOrderUUIDs.length > 0) {
        const { data: finRows } = await supabase
          .from('order_financials')
          .select('order_id')
          .in('order_id', acctOrderUUIDs)

        const finUUIDs = new Set((finRows ?? []).map(r => r.order_id))
        rowCount = finUUIDs.size

        // Derive available months only from orders that have corresponding financials
        for (const o of (acctOrders ?? [])) {
          if (o.order_date && finUUIDs.has(o.id)) {
            availableMonthsSet.add(o.order_date.slice(0, 7))
          }
        }
      }

      const availableMonths = [...availableMonthsSet].sort()
      const missingMonths = bmWindow.months.filter(m => !availableMonthsSet.has(m))

      const status: 'full' | 'partial' | 'none' =
        availableMonths.length === bmWindow.months.length && rowCount > 0 ? 'full'
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
        rows_with_null_account: rowsWithNullAccount ?? 0,
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
        from: bmWindow.from,
        to: bmWindow.to,
        monthsLabel: bmWindow.monthsLabel,
        rationale: bmWindow.rationale,
      },
      per_account: perAccount,
    }
    return NextResponse.json(response)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
