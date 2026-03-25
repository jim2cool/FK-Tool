import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/db/tenant'
import type { ParsedOrderRow } from '@/lib/importers/orders-report-parser'
import { importOrdersReport } from '@/lib/importers/orders-report-server'

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const body = (await req.json()) as {
      rows: ParsedOrderRow[]
      marketplaceAccountId: string
      skipRowIndices?: number[]
    }

    if (!body.rows || !Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json(
        { error: 'rows array is required' },
        { status: 400 },
      )
    }

    if (!body.marketplaceAccountId) {
      return NextResponse.json(
        { error: 'marketplaceAccountId is required' },
        { status: 400 },
      )
    }

    const skipSet = body.skipRowIndices
      ? new Set(body.skipRowIndices)
      : undefined

    const result = await importOrdersReport(
      body.rows,
      body.marketplaceAccountId,
      tenantId,
      skipSet,
    )

    return NextResponse.json(result)
  } catch (e: unknown) {
    const msg = (e as Error).message
    if (msg === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[pnl/import-orders]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
