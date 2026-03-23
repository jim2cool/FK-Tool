import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/db/tenant'
import { importPurchasesCsv } from '@/lib/importers/purchases-import-server'

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const body = await req.json()
    const { csv, skipRowIndices } = body as { csv: string; skipRowIndices?: number[] }

    if (!csv || typeof csv !== 'string') {
      return NextResponse.json({ error: 'csv field is required' }, { status: 400 })
    }

    const skipSet = skipRowIndices?.length ? new Set(skipRowIndices) : undefined
    const result = await importPurchasesCsv(csv, tenantId, skipSet)
    return NextResponse.json(result)
  } catch (e: unknown) {
    const msg = (e as Error).message
    if (msg === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[purchases/import-csv] error:', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
