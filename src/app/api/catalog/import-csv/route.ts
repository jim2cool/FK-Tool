import { createClient } from '@/lib/supabase/server'
import { importSkuMappingCsv, type CsvColumnMapping } from '@/lib/importers/sku-mapping-importer'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json() as { csv?: string; mapping?: CsvColumnMapping }

    if (!body.csv || typeof body.csv !== 'string') {
      return NextResponse.json({ error: 'Missing csv field' }, { status: 400 })
    }
    if (!body.mapping?.master_sku_name) {
      return NextResponse.json({ error: 'Missing or invalid mapping' }, { status: 400 })
    }

    const result = await importSkuMappingCsv(body.csv, body.mapping)
    return NextResponse.json(result)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
