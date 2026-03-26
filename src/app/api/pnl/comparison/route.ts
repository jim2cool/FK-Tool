import { getTenantId } from '@/lib/db/tenant'
import { calculatePnl } from '@/lib/pnl/calculate'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const params = request.nextUrl.searchParams
    const months = Math.min(parseInt(params.get('months') || '3'), 6)
    const accountIdsParam = params.get('accountIds')
    const accountIds = accountIdsParam ? accountIdsParam.split(',').filter(Boolean) : undefined

    const now = new Date()
    const results: Array<{
      month: string
      summary: { total_revenue: number; total_cogs: number; total_platform_fees: number; total_logistics: number; total_true_profit: number; overall_margin_pct: number }
      rows: Array<{ group_key: string; group_name: string; revenue: number; margin_pct: number | null; return_rate: number; net_orders: number }>
    }> = []

    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${lastDay}`

      const { summary, rows } = await calculatePnl({ tenantId, from, to, groupBy: 'product', accountIds })

      results.push({
        month: from.substring(0, 7),
        summary,
        rows: rows.map(r => ({
          group_key: r.group_key,
          group_name: r.group_name,
          revenue: r.revenue,
          margin_pct: r.margin_pct,
          return_rate: r.return_rate,
          net_orders: r.net_orders,
        })),
      })
    }

    // Reverse so oldest month is first
    return NextResponse.json({ months: results.reverse() })
  } catch (e: unknown) {
    console.error('[pnl/comparison] error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
