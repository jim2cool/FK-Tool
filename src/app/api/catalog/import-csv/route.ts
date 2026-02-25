import { createClient } from '@/lib/supabase/server'
import { importSkuMappingCsv } from '@/lib/importers/sku-mapping-importer'
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

    const text = await file.text()
    const result = await importSkuMappingCsv(text)
    return NextResponse.json(result)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
