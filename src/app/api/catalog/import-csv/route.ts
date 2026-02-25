import { createClient } from '@/lib/supabase/server'
import { importSkuMappingCsv, CsvColumnMapping } from '@/lib/importers/sku-mapping-importer'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  // Verify auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    if (!file.name.endsWith('.csv')) {
      return NextResponse.json({ error: 'Only CSV files are supported for SKU mapping import' }, { status: 400 })
    }

    // Accept an optional JSON-encoded mapping from the request; fall back to
    // the legacy hard-coded column names so existing callers keep working.
    const rawMapping = formData.get('mapping')
    const mapping: CsvColumnMapping = rawMapping
      ? (JSON.parse(rawMapping as string) as CsvColumnMapping)
      : {
          master_sku_name: 'master_sku_name',
          flipkart_sku: 'flipkart_sku',
          amazon_sku: 'amazon_sku',
          d2c_sku: 'd2c_sku',
          description: null,
        }

    const text = await file.text()
    const result = await importSkuMappingCsv(text, mapping)
    return NextResponse.json(result)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
