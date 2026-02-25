import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'

// Expected CSV columns: master_sku_name, flipkart_sku, amazon_sku, d2c_sku
export async function importSkuMappingCsv(csvText: string) {
  const tenantId = await getTenantId()
  const supabase = await createClient()
  const { data } = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })

  let processed = 0
  let failed = 0
  const errors: string[] = []

  for (const row of data) {
    const masterSkuName = row['master_sku_name']?.trim()
    if (!masterSkuName) { failed++; continue }

    // Upsert master SKU by name
    const { data: sku, error: skuError } = await supabase.from('master_skus')
      .upsert(
        { tenant_id: tenantId, name: masterSkuName },
        { onConflict: 'tenant_id,name', ignoreDuplicates: false }
      )
      .select('id')
      .single()

    if (skuError || !sku) {
      // upsert may have returned nothing on conflict — fetch the existing row
      const { data: existing } = await supabase.from('master_skus')
        .select('id').eq('tenant_id', tenantId).eq('name', masterSkuName).single()
      if (!existing) {
        failed++
        errors.push(`Failed to upsert SKU: ${masterSkuName}`)
        continue
      }
      // use the existing SKU id
      const skuId = existing.id
      await upsertPlatformMappings(supabase, tenantId, skuId, row, errors)
    } else {
      await upsertPlatformMappings(supabase, tenantId, sku.id, row, errors)
    }
    processed++
  }

  return { processed, failed, errors }
}

async function upsertPlatformMappings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  masterSkuId: string,
  row: Record<string, string>,
  errors: string[]
) {
  const platforms = [
    { platform: 'flipkart', col: 'flipkart_sku' },
    { platform: 'amazon', col: 'amazon_sku' },
    { platform: 'd2c', col: 'd2c_sku' },
  ] as const

  for (const { platform, col } of platforms) {
    const platformSku = row[col]?.trim()
    if (!platformSku) continue
    const { error } = await supabase.from('sku_mappings').upsert(
      { tenant_id: tenantId, master_sku_id: masterSkuId, platform, platform_sku: platformSku },
      { onConflict: 'tenant_id,platform,platform_sku' }
    )
    if (error) errors.push(`Mapping error for ${platform}: ${error.message}`)
  }
}
