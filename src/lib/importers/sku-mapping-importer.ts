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
  parent_sku_name: string | null
  variant_attr_cols: Array<{ csv_col: string; attr_key: string }>
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

    const variantSkuName = row[mapping.master_sku_name]?.trim()
    if (!variantSkuName) {
      failed++
      errors.push({ row: rowNum, sku: '(blank)', message: 'Master SKU Name is empty' })
      continue
    }

    const description = mapping.description ? row[mapping.description]?.trim() || null : null
    const parentSkuName = mapping.parent_sku_name ? row[mapping.parent_sku_name]?.trim() || null : null

    // ── Variant import path ─────────────────────────────────────────────────
    if (parentSkuName) {
      // Upsert parent product (no platform mappings on parent)
      let parentId: string
      const { data: existingParent } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', parentSkuName)
        .is('parent_id', null)
        .single()

      if (existingParent) {
        parentId = existingParent.id
      } else {
        const { data: newParent, error: parentErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: parentSkuName })
          .select('id')
          .single()
        if (parentErr || !newParent) {
          failed++
          errors.push({ row: rowNum, sku: variantSkuName, message: `Failed to create parent "${parentSkuName}": ${parentErr?.message}` })
          continue
        }
        parentId = newParent.id
      }

      // Build variant_attributes from mapped columns
      const variantAttributes: Record<string, string> = {}
      for (const { csv_col, attr_key } of (mapping.variant_attr_cols ?? [])) {
        const val = row[csv_col]?.trim()
        if (val && attr_key.trim()) variantAttributes[attr_key.trim()] = val
      }

      // Upsert variant under parent
      const { data: existingVariant } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', variantSkuName)
        .eq('parent_id', parentId)
        .single()

      let skuId: string
      if (existingVariant) {
        if (description !== null || Object.keys(variantAttributes).length > 0) {
          const upd: Record<string, unknown> = {}
          if (description !== null) upd.description = description
          if (Object.keys(variantAttributes).length > 0) upd.variant_attributes = variantAttributes
          await supabase.from('master_skus').update(upd).eq('id', existingVariant.id)
        }
        skuId = existingVariant.id
        updated++
      } else {
        const { data: newVariant, error: vErr } = await supabase
          .from('master_skus')
          .insert({
            tenant_id: tenantId,
            name: variantSkuName,
            description,
            parent_id: parentId,
            variant_attributes: Object.keys(variantAttributes).length > 0 ? variantAttributes : null,
          })
          .select('id')
          .single()
        if (vErr || !newVariant) {
          failed++
          errors.push({ row: rowNum, sku: variantSkuName, message: vErr?.message ?? 'Insert failed' })
          continue
        }
        skuId = newVariant.id
        created++
      }

      // Upsert platform mappings onto the variant
      const platforms = [
        { platform: 'flipkart' as const, col: mapping.flipkart_sku },
        { platform: 'amazon' as const, col: mapping.amazon_sku },
        { platform: 'd2c' as const, col: mapping.d2c_sku },
      ]
      for (const { platform, col } of platforms) {
        if (!col) continue
        const platformSku = row[col]?.trim()
        if (!platformSku) continue
        const { data: existingMapping } = await supabase
          .from('sku_mappings').select('master_sku_id')
          .eq('tenant_id', tenantId).eq('platform', platform).eq('platform_sku', platformSku).single()
        if (existingMapping && existingMapping.master_sku_id !== skuId) {
          errors.push({ row: rowNum, sku: variantSkuName, message: `${platform} SKU "${platformSku}" already mapped to a different SKU` })
          continue
        }
        const { error } = await supabase.from('sku_mappings').upsert(
          { tenant_id: tenantId, master_sku_id: skuId, platform, platform_sku: platformSku },
          { onConflict: 'tenant_id,platform,platform_sku' }
        )
        if (error) {
          failed++
          errors.push({ row: rowNum, sku: variantSkuName, message: `${platform} mapping: ${error.message}` })
        }
      }

      continue  // done with this row
    }

    // ── Flat SKU import path (existing logic, unchanged) ───────────────────
    const masterSkuName = variantSkuName

    const { data: existing } = await supabase
      .from('master_skus')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', masterSkuName)
      .is('parent_id', null)
      .single()

    let skuId: string

    if (existing) {
      if (description !== null) {
        const { error: updateError } = await supabase
          .from('master_skus')
          .update({ description })
          .eq('id', existing.id)
        if (updateError) {
          errors.push({ row: rowNum, sku: masterSkuName, message: `Description update failed: ${updateError.message}` })
        }
      }
      skuId = existing.id
      updated++
    } else {
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

    const platforms = [
      { platform: 'flipkart' as const, col: mapping.flipkart_sku },
      { platform: 'amazon' as const, col: mapping.amazon_sku },
      { platform: 'd2c' as const, col: mapping.d2c_sku },
    ]
    for (const { platform, col } of platforms) {
      if (!col) continue
      const platformSku = row[col]?.trim()
      if (!platformSku) continue
      const { data: existingMapping } = await supabase
        .from('sku_mappings').select('master_sku_id')
        .eq('tenant_id', tenantId).eq('platform', platform).eq('platform_sku', platformSku).single()
      if (existingMapping && existingMapping.master_sku_id !== skuId) {
        failed++
        errors.push({ row: rowNum, sku: masterSkuName, message: `${platform} SKU "${platformSku}" is already mapped to a different master SKU` })
        continue
      }
      const { error } = await supabase.from('sku_mappings').upsert(
        { tenant_id: tenantId, master_sku_id: skuId, platform, platform_sku: platformSku },
        { onConflict: 'tenant_id,platform,platform_sku' }
      )
      if (error) {
        failed++
        errors.push({ row: rowNum, sku: masterSkuName, message: `${platform} mapping: ${error.message}` })
      }
    }
  }

  return { created, updated, failed, errors }
}
