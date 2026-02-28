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
  tenantId: string
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

    // Resolve warehouse
    const warehouseId = warehouseMap.get(row.warehouseName.toLowerCase())
    if (!warehouseId) {
      skipped++
      errors.push({ row: row.rowIndex, reason: `Warehouse '${row.warehouseName}' not found in Settings` })
      continue
    }

    // Resolve master_sku + variant
    let masterSkuId: string

    if (row.variant) {
      // Has variant: find/create parent, then find/create variant
      const { data: existingParent } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', row.master)
        .is('parent_id', null)
        .maybeSingle()

      let parentId: string
      if (existingParent) {
        parentId = existingParent.id
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
      }

      const { data: existingVariant } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', row.variant)
        .eq('parent_id', parentId)
        .maybeSingle()

      if (existingVariant) {
        masterSkuId = existingVariant.id
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
        masterSkuId = newVariant.id
      }
    } else {
      // Flat SKU
      const { data: existingMaster } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', row.master)
        .is('parent_id', null)
        .maybeSingle()

      if (existingMaster) {
        masterSkuId = existingMaster.id
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
        masterSkuId = newMaster.id
      }
    }

    // Insert purchase (total_cogs is GENERATED ALWAYS in DB — do not insert it)
    const { error: insertErr } = await supabase
      .from('purchases')
      .insert({
        tenant_id: tenantId,
        master_sku_id: masterSkuId,
        warehouse_id: warehouseId,
        quantity: row.qty,
        unit_purchase_price: row.ratePerUnit,
        packaging_cost: 0,
        other_cost: 0,
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
