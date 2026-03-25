/**
 * Server-only Orders Report importer.
 * Resolves SKU names via sku_mappings, batch-inserts/updates orders
 * with lifecycle dates (dispatch, delivery, cancellation, return).
 */
import { createClient } from '@/lib/supabase/server'
import type { ParsedOrderRow } from './orders-report-parser'

export interface OrdersImportResult {
  imported: number
  updated: number
  skipped: number
  unmappedSkus: string[]
  errors: string[]
}

export async function importOrdersReport(
  rows: ParsedOrderRow[],
  marketplaceAccountId: string,
  tenantId: string,
  skipRowIndices?: Set<number>,
): Promise<OrdersImportResult> {
  const supabase = await createClient()

  // ── 1. Load SKU mappings for tenant (flipkart) ──
  const { data: mappings, error: mappingsErr } = await supabase
    .from('sku_mappings')
    .select('platform_sku, master_sku_id, combo_product_id')
    .eq('tenant_id', tenantId)
    .eq('platform', 'flipkart')

  if (mappingsErr) {
    return {
      imported: 0, updated: 0, skipped: 0,
      unmappedSkus: [],
      errors: [`Failed to load SKU mappings: ${mappingsErr.message}`],
    }
  }

  const skuMap = new Map<string, { master_sku_id: string | null; combo_product_id: string | null }>()
  for (const m of mappings ?? []) {
    skuMap.set(m.platform_sku.toLowerCase(), {
      master_sku_id: m.master_sku_id,
      combo_product_id: m.combo_product_id,
    })
  }

  // ── 2. Filter valid rows + resolve SKUs ──
  const unmappedSkusSet = new Set<string>()
  const errors: string[] = []
  let skipped = 0

  interface PreparedRow {
    row: ParsedOrderRow
    masterSkuId: string | null
    comboProductId: string | null
  }

  const prepared: PreparedRow[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (skipRowIndices?.has(i)) { skipped++; continue }
    if (row.error) { skipped++; errors.push(`Row ${i + 1}: ${row.error}`); continue }

    const mapping = skuMap.get(row.skuName.toLowerCase())
    const masterSkuId = mapping?.master_sku_id ?? null
    const comboProductId = mapping?.combo_product_id ?? null
    if (!mapping) unmappedSkusSet.add(row.skuName)

    prepared.push({ row, masterSkuId, comboProductId })
  }

  if (prepared.length === 0) {
    return { imported: 0, updated: 0, skipped, unmappedSkus: [...unmappedSkusSet], errors }
  }

  // ── 3. Batch check existing orders by order_item_id ──
  const allItemIds = [...new Set(prepared.map(p => p.row.orderItemId))]

  const existingOrders: Array<{ id: string; order_item_id: string | null }> = []
  for (let i = 0; i < allItemIds.length; i += 200) {
    const chunk = allItemIds.slice(i, i + 200)
    const { data } = await supabase
      .from('orders')
      .select('id, order_item_id')
      .eq('tenant_id', tenantId)
      .in('order_item_id', chunk)
    if (data) existingOrders.push(...data)
  }

  // Map order_item_id → existing order id
  const existingMap = new Map<string, string>()
  for (const o of existingOrders) {
    if (o.order_item_id) existingMap.set(o.order_item_id, o.id)
  }

  // ── 4. Separate into new inserts vs updates ──
  const newInserts: PreparedRow[] = []
  const updates: Array<{ prepared: PreparedRow; existingOrderId: string }> = []

  for (const p of prepared) {
    const existingId = existingMap.get(p.row.orderItemId)
    if (existingId) {
      updates.push({ prepared: p, existingOrderId: existingId })
    } else {
      newInserts.push(p)
    }
  }

  // ── 5. Batch INSERT new orders (chunks of 100) ──
  let imported = 0

  for (let i = 0; i < newInserts.length; i += 100) {
    const chunk = newInserts.slice(i, i + 100)
    const insertRows = chunk.map((p) => ({
      tenant_id: tenantId,
      platform_order_id: p.row.platformOrderId,
      order_item_id: p.row.orderItemId,
      marketplace_account_id: marketplaceAccountId,
      master_sku_id: p.masterSkuId,
      combo_product_id: p.comboProductId,
      order_date: p.row.orderDate,
      status: p.row.orderStatus,
      quantity: p.row.quantity,
      fulfillment_type: p.row.fulfillmentType,
      dispatch_date: p.row.dispatchDate,
      delivery_date: p.row.deliveryDate,
      cancellation_date: p.row.cancellationDate,
      cancellation_reason: p.row.cancellationReason,
      return_request_date: p.row.returnRequestDate,
    }))

    const { data: inserted, error: insertErr } = await supabase
      .from('orders')
      .insert(insertRows)
      .select('id')

    if (insertErr) {
      errors.push(`Batch insert failed: ${insertErr.message}`)
    } else {
      imported += inserted?.length ?? 0
    }
  }

  // ── 6. Update existing orders with lifecycle dates ──
  let updated = 0

  for (const { prepared: p, existingOrderId } of updates) {
    const { error: updateErr } = await supabase
      .from('orders')
      .update({
        status: p.row.orderStatus,
        fulfillment_type: p.row.fulfillmentType,
        dispatch_date: p.row.dispatchDate,
        delivery_date: p.row.deliveryDate,
        cancellation_date: p.row.cancellationDate,
        cancellation_reason: p.row.cancellationReason,
        return_request_date: p.row.returnRequestDate,
        ...(p.masterSkuId ? { master_sku_id: p.masterSkuId } : {}),
        ...(p.comboProductId ? { combo_product_id: p.comboProductId } : {}),
      })
      .eq('id', existingOrderId)

    if (updateErr) {
      errors.push(`Update order ${p.row.orderItemId} failed: ${updateErr.message}`)
    } else {
      updated++
    }
  }

  return {
    imported,
    updated,
    skipped,
    unmappedSkus: [...unmappedSkusSet],
    errors,
  }
}
