/**
 * Server-only purchases importer.
 * Uses the server Supabase client — do NOT import from client components.
 */
import { createClient } from '@/lib/supabase/server'
import { parsePurchasesCsv } from './purchases-csv-parser'
import type { PurchaseImportResult } from './purchases-csv-parser'

export type { PurchaseImportResult } from './purchases-csv-parser'

export async function importPurchasesCsv(
  csvText: string,
  tenantId: string,
  skipRowIndices?: Set<number>,
): Promise<PurchaseImportResult> {
  const supabase = await createClient()

  // Load warehouses lookup map: name_lowercase → id
  const { data: warehouses, error: warehousesErr } = await supabase
    .from('warehouses')
    .select('id, name')
    .eq('tenant_id', tenantId)

  if (warehousesErr) {
    return {
      created: 0,
      skipped: 0,
      errors: [{ row: 0, reason: `Failed to load warehouses: ${warehousesErr.message}` }],
    }
  }

  const warehouseMap = new Map<string, string>() // name_lc → id
  for (const w of warehouses ?? []) {
    warehouseMap.set(w.name.toLowerCase(), w.id)
  }

  // Pre-load ALL existing master_skus for this tenant into caches
  // This prevents N+1 queries AND the maybeSingle() duplicate bug
  const { data: existingSkus } = await supabase
    .from('master_skus')
    .select('id, name, parent_id')
    .eq('tenant_id', tenantId)
    .eq('is_archived', false)

  const skuCache = new Map<string, string>() // name_lc → id (flat/parent SKUs)
  const variantCache = new Map<string, string>() // "parentId::name_lc" → id
  for (const s of existingSkus ?? []) {
    if (s.parent_id === null) {
      skuCache.set(s.name.toLowerCase(), s.id)
    } else {
      variantCache.set(`${s.parent_id}::${s.name.toLowerCase()}`, s.id)
    }
  }

  const rows = parsePurchasesCsv(csvText)
  let created = 0
  let skipped = 0
  const errors: PurchaseImportResult['errors'] = []

  for (const row of rows) {
    if (row.error) {
      skipped++
      errors.push({ row: row.rowIndex, reason: row.error })
      continue
    }

    if (skipRowIndices?.has(row.rowIndex)) {
      skipped++
      continue
    }

    // Resolve warehouse
    const warehouseId = warehouseMap.get(row.warehouseName.toLowerCase())
    if (!warehouseId) {
      skipped++
      errors.push({ row: row.rowIndex, reason: `Warehouse '${row.warehouseName}' not found in Settings` })
      continue
    }

    // Resolve master_sku + variant using caches
    let masterSkuId: string

    if (row.variant) {
      // Has variant: find/create parent, then find/create variant
      let parentId: string
      const cachedParentId = skuCache.get(row.master.toLowerCase())

      if (cachedParentId) {
        parentId = cachedParentId
      } else {
        const { data: newParent, error: parentErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: row.master })
          .select('id')
          .single()
        if (parentErr || !newParent) {
          skipped++
          errors.push({ row: row.rowIndex, reason: `Failed to create product "${row.master}": ${parentErr?.message ?? 'unknown'}` })
          continue
        }
        parentId = newParent.id
        skuCache.set(row.master.toLowerCase(), parentId)
      }

      const variantKey = `${parentId}::${row.variant!.toLowerCase()}`
      const cachedVariantId = variantCache.get(variantKey)

      if (cachedVariantId) {
        masterSkuId = cachedVariantId
      } else {
        const { data: newVariant, error: variantErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: row.variant, parent_id: parentId })
          .select('id')
          .single()
        if (variantErr || !newVariant) {
          skipped++
          errors.push({ row: row.rowIndex, reason: `Failed to create variant "${row.variant}": ${variantErr?.message ?? 'unknown'}` })
          continue
        }
        variantCache.set(variantKey, newVariant.id)
        masterSkuId = newVariant.id
      }
    } else {
      // Flat SKU — check cache first
      const cachedId = skuCache.get(row.master.toLowerCase())

      if (cachedId) {
        masterSkuId = cachedId
      } else {
        const { data: newMaster, error: masterErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: row.master })
          .select('id')
          .single()
        if (masterErr || !newMaster) {
          skipped++
          errors.push({ row: row.rowIndex, reason: `Failed to create product "${row.master}": ${masterErr?.message ?? 'unknown'}` })
          continue
        }
        skuCache.set(row.master.toLowerCase(), newMaster.id)
        masterSkuId = newMaster.id
      }
    }

    const { error: insertErr } = await supabase
      .from('purchases')
      .insert({
        tenant_id: tenantId,
        master_sku_id: masterSkuId,
        warehouse_id: warehouseId,
        quantity: row.qty,
        unit_purchase_price: row.ratePerUnit,
        supplier: row.vendorName || null,
        purchase_date: row.date,
        hsn_code: row.hsnCode || null,
        gst_rate_slab: row.gstRateSlab,
        tax_paid: row.taxPaid,
        invoice_number: row.invoiceNumber || null,
      })

    if (insertErr) {
      skipped++
      errors.push({ row: row.rowIndex, reason: `Insert failed: ${insertErr.message}` })
      continue
    }
    created++
  }

  return { created, skipped, errors }
}
