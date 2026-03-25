import { getTenantId } from '@/lib/db/tenant'
import { calculatePnl } from '@/lib/pnl/calculate'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const params = request.nextUrl.searchParams

    const groupBy = (params.get('groupBy') || 'product') as 'product' | 'channel' | 'account'
    const from = params.get('from') || ''
    const to = params.get('to') || ''
    const accountIdsParam = params.get('accountIds')
    const accountIds = accountIdsParam ? accountIdsParam.split(',').filter(Boolean) : undefined

    if (!from || !to) {
      return NextResponse.json({ error: 'from and to date params required (YYYY-MM-DD)' }, { status: 400 })
    }

    const result = await calculatePnl({ tenantId, from, to, groupBy, accountIds })
    return NextResponse.json(result)
  } catch (e: unknown) {
    console.error('[pnl/summary] error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
