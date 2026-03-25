import { getTenantId } from '@/lib/db/tenant'
import { calculatePnl } from '@/lib/pnl/calculate'
import { calculateCogsBatch } from '@/lib/cogs/calculate'
import { computeRecoveryMetrics } from '@/lib/pnl/recovery'
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

    // Compute recovery metrics for product rows only
    let recoveryMap: Record<string, unknown> = {}
    if (groupBy === 'product' && result.rows.length > 0) {
      try {
        const skuIds = result.rows
          .map(r => r.group_key)
          .filter(k => k && k !== 'unmapped')

        if (skuIds.length > 0) {
          const cogsMap = await calculateCogsBatch(skuIds)
          const recoveryResult = await computeRecoveryMetrics(tenantId, skuIds, from, to, cogsMap)
          // Convert Map to plain object for JSON serialization
          for (const [key, value] of recoveryResult) {
            recoveryMap[key] = value
          }
        }
      } catch (err) {
        console.error('[pnl/summary] recovery metrics error (non-fatal):', err)
        // Recovery is non-fatal — return rows without it
      }
    }

    return NextResponse.json({
      summary: result.summary,
      rows: result.rows,
      recoveryMap,
    })
  } catch (e: unknown) {
    console.error('[pnl/summary] error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
