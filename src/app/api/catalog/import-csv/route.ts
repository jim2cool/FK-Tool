import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/db/tenant'
import { importCatalogCsv } from '@/lib/importers/sku-mapping-importer'

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getTenantId()

    const body = await req.json()
    const { csv } = body as { csv: string }

    if (!csv || typeof csv !== 'string') {
      return NextResponse.json({ error: 'csv field is required' }, { status: 400 })
    }

    const result = await importCatalogCsv(csv, tenantId)
    return NextResponse.json(result)
  } catch (e: unknown) {
    const msg = (e as Error).message
    if (msg === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[import-csv] error:', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
