import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'

/** Maps our internal field names to the user's actual CSV column headers.
 *  null means "skip this field". */
export interface CsvColumnMapping {
  master_sku_name: string        // required — never null
  flipkart_sku: string | null
  amazon_sku: string | null
  d2c_sku: string | null
  description: string | null
}

export interface ImportResult {
  created: number
  updated: number
  failed: number
  errors: Array<{ row: number; sku: string; message: string }>
}

export async function importSkuMappingCsv(
  csvText: string,
  mapping: CsvColumnMapping
): Promise<ImportResult> {
  const tenantId = await getTenantId()
  const supabase = await createClient()
  const { data } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  let created = 0
  let updated = 0
  let failed = 0
  const errors: ImportResult['errors'] = []

  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    const rowNum = i + 2 // 1-indexed, +1 for header row

    const masterSkuName = row[mapping.master_sku_name]?.trim()
    if (!masterSkuName) {
      failed++
      errors.push({ row: rowNum, sku: '(blank)', message: 'Master SKU Name is empty' })
      continue
    }

    const description = mapping.description ? row[mapping.description]?.trim() || null : null

    // Check if SKU already exists
    const { data: existing } = await supabase
      .from('master_skus')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', masterSkuName)
      .single()

    let skuId: string

    if (existing) {
      // Update description if provided
      if (description !== null) {
        await supabase
          .from('master_skus')
          .update({ description })
          .eq('id', existing.id)
      }
      skuId = existing.id
      updated++
    } else {
      // Insert new SKU
      const { data: inserted, error: insertError } = await supabase
        .from('master_skus')
        .insert({ tenant_id: tenantId, name: masterSkuName, description })
        .select('id')
        .single()

      if (insertError || !inserted) {
        failed++
        errors.push({ row: rowNum, sku: masterSkuName, message: insertError?.message ?? 'Insert failed' })
        continue
      }
      skuId = inserted.id
      created++
    }

    // Upsert platform mappings for non-null mapping fields
    const platforms = [
      { platform: 'flipkart' as const, col: mapping.flipkart_sku },
      { platform: 'amazon' as const, col: mapping.amazon_sku },
      { platform: 'd2c' as const, col: mapping.d2c_sku },
    ]

    for (const { platform, col } of platforms) {
      if (!col) continue
      const platformSku = row[col]?.trim()
      if (!platformSku) continue

      const { error } = await supabase.from('sku_mappings').upsert(
        { tenant_id: tenantId, master_sku_id: skuId, platform, platform_sku: platformSku },
        { onConflict: 'tenant_id,platform,platform_sku' }
      )
      if (error) {
        errors.push({ row: rowNum, sku: masterSkuName, message: `${platform} mapping: ${error.message}` })
      }
    }
  }

  return { created, updated, failed, errors }
}
