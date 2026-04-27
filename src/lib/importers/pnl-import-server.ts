/**
 * Server-only P&L importer.
 * Resolves SKU names via sku_mappings, batch-inserts orders + order_financials,
 * runs anomaly detection, and recomputes sku_financial_profiles.
 *
 * Optimized: uses bulk INSERT instead of row-by-row queries.
 */
import { createClient } from '@/lib/supabase/server'
import type { ParsedPnlRow } from './pnl-xlsx-parser'
import type { AnomalyFlag } from '@/lib/pnl/anomaly-rules'
import { detectAnomalies } from '@/lib/pnl/anomaly-rules'

export interface PnlImportResult {
  imported: number
  skipped: number
  enriched: number
  mismatchedAccount: number
  unmappedSkus: string[]
  anomalyCount: number
  errors: string[]
}

export async function importPnlData(
  rows: ParsedPnlRow[],
  marketplaceAccountId: string,
  tenantId: string,
  skipRowIndices?: Set<number>,
): Promise<PnlImportResult> {
  const supabase = await createClient()

  // ── 1. Load SKU mappings ──
  const { data: mappings, error: mappingsErr } = await supabase
    .from('sku_mappings')
    .select('platform_sku, master_sku_id, combo_product_id')
    .eq('tenant_id', tenantId)
    .eq('platform', 'flipkart')

  if (mappingsErr) {
    return {
      imported: 0, skipped: 0, enriched: 0, mismatchedAccount: 0,
      unmappedSkus: [], anomalyCount: 0,
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

  // ── 2. Load enabled anomaly rules ──
  const { data: rulesData } = await supabase
    .from('pnl_anomaly_rules')
    .select('rule_key')
    .eq('tenant_id', tenantId)
    .eq('enabled', true)

  const enabledRules = new Set<string>((rulesData ?? []).map(r => r.rule_key))

  // ── 3. Filter valid rows + resolve SKUs + detect anomalies (all in-memory) ──
  const unmappedSkusSet = new Set<string>()
  const errors: string[] = []
  let anomalyCount = 0
  let skipped = 0

  interface PreparedRow {
    row: ParsedPnlRow
    masterSkuId: string | null
    comboProductId: string | null
    anomalies: AnomalyFlag[]
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

    const anomalies = detectAnomalies(row, enabledRules)
    if (anomalies.length > 0) anomalyCount += anomalies.length

    prepared.push({ row, masterSkuId, comboProductId, anomalies })
  }

  if (prepared.length === 0) {
    return { imported: 0, skipped, enriched: 0, mismatchedAccount: 0, unmappedSkus: [...unmappedSkusSet], anomalyCount, errors }
  }

  // ── 4. Batch check existing orders ──
  const allPlatformOrderIds = [...new Set(prepared.map(p => p.row.platformOrderId))]

  // Supabase .in() has a limit of ~300 items, chunk if needed
  const existingOrders: Array<{ id: string; platform_order_id: string; order_item_id: string | null; marketplace_account_id: string | null }> = []
  for (let i = 0; i < allPlatformOrderIds.length; i += 200) {
    const chunk = allPlatformOrderIds.slice(i, i + 200)
    const { data } = await supabase
      .from('orders')
      .select('id, platform_order_id, order_item_id, marketplace_account_id')
      .eq('tenant_id', tenantId)
      .in('platform_order_id', chunk)
    if (data) existingOrders.push(...data)
  }

  // Build lookup maps
  const exactMatchSet = new Set<string>() // order_item_id values that already exist
  const labelMatchMap = new Map<string, string>() // platform_order_id → order.id (for label-enrichment)
  const labelAccountMap = new Map<string, string | null>() // platform_order_id → existing marketplace_account_id

  for (const o of existingOrders) {
    if (o.order_item_id) exactMatchSet.add(o.order_item_id)
    if (o.order_item_id === o.platform_order_id) {
      labelMatchMap.set(o.platform_order_id, o.id)
      labelAccountMap.set(o.platform_order_id, o.marketplace_account_id ?? null)
    }
  }

  // ── 5. Separate into: new inserts, enrichments, duplicates ──
  interface NewOrderRow {
    prepared: PreparedRow
  }
  interface EnrichRow {
    prepared: PreparedRow
    existingOrderId: string
  }

  const newInserts: NewOrderRow[] = []
  const enrichments: EnrichRow[] = []
  let enriched = 0
  let mismatchedAccount = 0

  for (const p of prepared) {
    if (exactMatchSet.has(p.row.orderItemId)) {
      skipped++
      continue
    }

    const labelOrderId = labelMatchMap.get(p.row.platformOrderId)
    if (labelOrderId) {
      enrichments.push({ prepared: p, existingOrderId: labelOrderId })
    } else {
      newInserts.push({ prepared: p })
    }
  }

  // ── 6. Batch INSERT new orders (chunks of 100) ──
  const insertedOrderMap = new Map<string, string>() // orderItemId → orderId

  for (let i = 0; i < newInserts.length; i += 100) {
    const chunk = newInserts.slice(i, i + 100)
    const insertRows = chunk.map(({ prepared: p }) => ({
      tenant_id: tenantId,
      platform_order_id: p.row.platformOrderId,
      order_item_id: p.row.orderItemId,
      marketplace_account_id: marketplaceAccountId,
      master_sku_id: p.masterSkuId,
      combo_product_id: p.comboProductId,
      order_date: p.row.orderDate,
      status: p.row.orderStatus,
      fulfillment_type: p.row.fulfillmentType,
      channel: p.row.channel,
      payment_mode: p.row.paymentMode,
      final_selling_price: p.row.finalSellingPrice,
      sale_price: p.row.finalSellingPrice,
      gross_units: p.row.grossUnits,
      net_units: p.row.netUnits,
      rto_units: p.row.rtoUnits,
      rvp_units: p.row.rvpUnits,
      cancelled_units: p.row.cancelledUnits,
    }))

    const { data: inserted, error: insertErr } = await supabase
      .from('orders')
      .insert(insertRows)
      .select('id, order_item_id')

    if (insertErr) {
      errors.push(`Batch insert failed: ${insertErr.message}`)
    } else if (inserted) {
      for (const o of inserted) {
        insertedOrderMap.set(o.order_item_id, o.id)
      }
    }
  }

  const imported = insertedOrderMap.size

  // ── 7. Batch UPDATE enrichments (one at a time — typically few) ──
  for (const { prepared: p, existingOrderId } of enrichments) {
    // Refuse to silently overwrite an existing order's account with a different one.
    // If the existing account is null (legacy label-ingested row), proceed and backfill it.
    const existingAccountId: string | null = labelAccountMap.get(p.row.platformOrderId) ?? null
    if (existingAccountId && existingAccountId !== marketplaceAccountId) {
      mismatchedAccount += 1
      continue
    }

    const { error: updateErr } = await supabase
      .from('orders')
      .update({
        order_item_id: p.row.orderItemId,
        marketplace_account_id: marketplaceAccountId,
        status: p.row.orderStatus,
        fulfillment_type: p.row.fulfillmentType,
        channel: p.row.channel,
        payment_mode: p.row.paymentMode,
        final_selling_price: p.row.finalSellingPrice,
        gross_units: p.row.grossUnits,
        net_units: p.row.netUnits,
        rto_units: p.row.rtoUnits,
        rvp_units: p.row.rvpUnits,
        cancelled_units: p.row.cancelledUnits,
        ...(p.masterSkuId ? { master_sku_id: p.masterSkuId } : {}),
        ...(p.comboProductId ? { combo_product_id: p.comboProductId } : {}),
      })
      .eq('id', existingOrderId)

    if (updateErr) {
      errors.push(`Enrich order failed: ${updateErr.message}`)
    } else {
      insertedOrderMap.set(p.row.orderItemId, existingOrderId)
      enriched++
    }
  }

  // ── 8. Batch UPSERT order_financials (chunks of 100) ──
  // Build all financial rows for successfully inserted/enriched orders
  const allFinancialRows: Array<Record<string, unknown>> = []
  const affectedSkuIds = new Set<string>()

  for (const p of [...newInserts.map(n => n.prepared), ...enrichments.map(e => e.prepared)]) {
    const orderId = insertedOrderMap.get(p.row.orderItemId)
    if (!orderId) continue

    if (p.masterSkuId) affectedSkuIds.add(p.masterSkuId)

    const salePriceVal = p.row.accountedNetSales || p.row.finalSellingPrice
    const anomalies = p.anomalies

    allFinancialRows.push({
      tenant_id: tenantId,
      order_id: orderId,
      accounted_net_sales: p.row.accountedNetSales,
      sale_amount: p.row.saleAmount,
      seller_offer_burn: p.row.sellerOfferBurn,
      commission_fee: p.row.commissionFee,
      collection_fee: p.row.collectionFee,
      fixed_fee: p.row.fixedFee,
      offer_adjustments: p.row.offerAdjustments,
      pick_pack_fee: p.row.pickPackFee,
      forward_shipping_fee: p.row.forwardShippingFee,
      reverse_shipping_fee: p.row.reverseShippingFee,
      tax_gst: p.row.taxGst,
      tax_tcs: p.row.taxTcs,
      tax_tds: p.row.taxTds,
      rewards: p.row.rewards,
      spf_payout: p.row.spfPayout,
      amount_settled: p.row.amountSettled,
      amount_pending: p.row.amountPending,
      sale_price: salePriceVal,
      commission_amount: Math.abs(p.row.commissionFee),
      commission_rate: p.row.accountedNetSales ? Math.abs(p.row.commissionFee) / p.row.accountedNetSales : 0,
      logistics_cost: Math.abs(p.row.forwardShippingFee + p.row.reverseShippingFee + p.row.pickPackFee),
      other_deductions: Math.abs(p.row.collectionFee + p.row.fixedFee + p.row.offerAdjustments),
      projected_settlement: p.row.projectedSettlement,
      actual_settlement: p.row.amountSettled || null,
      settlement_variance: p.row.amountSettled ? p.row.amountSettled - p.row.projectedSettlement : null,
      anomaly_flags: anomalies,
    })
  }

  for (let i = 0; i < allFinancialRows.length; i += 100) {
    const chunk = allFinancialRows.slice(i, i + 100)
    const { error: finErr } = await supabase
      .from('order_financials')
      .upsert(chunk, { onConflict: 'tenant_id,order_id' })

    if (finErr) {
      errors.push(`Financials batch upsert failed: ${finErr.message}`)
    }
  }

  // ── 9. Recompute sku_financial_profiles ──
  if (affectedSkuIds.size > 0) {
    await recomputeFinancialProfiles(supabase, tenantId, affectedSkuIds)
  }

  return {
    imported,
    skipped,
    enriched,
    mismatchedAccount,
    unmappedSkus: [...unmappedSkusSet],
    anomalyCount,
    errors,
  }
}

async function recomputeFinancialProfiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  skuIds: Set<string>,
) {
  const skuIdArray = [...skuIds]

  const { data: orders } = await supabase
    .from('orders')
    .select('id, master_sku_id, gross_units, rto_units, rvp_units')
    .eq('tenant_id', tenantId)
    .in('master_sku_id', skuIdArray)

  if (!orders || orders.length === 0) return

  const orderIds = orders.map(o => o.id)

  // Chunk orderIds for .in() limit
  const allFinancials: Array<Record<string, number | null>> = []
  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200)
    const { data } = await supabase
      .from('order_financials')
      .select('order_id, accounted_net_sales, commission_fee, forward_shipping_fee, reverse_shipping_fee, pick_pack_fee, amount_settled')
      .in('order_id', chunk)
    if (data) allFinancials.push(...(data as Array<Record<string, number | null>>))
  }

  const finMap = new Map<string, Record<string, number | null>>()
  for (const f of allFinancials) finMap.set(f.order_id as unknown as string, f)

  const skuOrders = new Map<string, typeof orders>()
  for (const o of orders) {
    if (!o.master_sku_id) continue
    const list = skuOrders.get(o.master_sku_id) ?? []
    list.push(o)
    skuOrders.set(o.master_sku_id, list)
  }

  // Batch upsert all profiles at once
  const profileRows: Array<Record<string, unknown>> = []

  for (const [skuId, skuOrderList] of skuOrders) {
    let commRateSum = 0, commRateCount = 0
    let logSum = 0, logCount = 0
    let grossUnits = 0, returnUnits = 0
    let nspSum = 0, nspCount = 0

    for (const order of skuOrderList) {
      const fin = finMap.get(order.id)
      if (!fin) continue
      const ans = (fin.accounted_net_sales as number) ?? 0
      if (ans > 0) {
        commRateSum += Math.abs((fin.commission_fee as number) ?? 0) / ans
        commRateCount++
        if (fin.amount_settled) {
          nspSum += (fin.amount_settled as number) / ans
          nspCount++
        }
      }
      logSum += Math.abs(((fin.forward_shipping_fee as number) ?? 0) + ((fin.reverse_shipping_fee as number) ?? 0) + ((fin.pick_pack_fee as number) ?? 0))
      logCount++
      grossUnits += order.gross_units ?? 0
      returnUnits += (order.rto_units ?? 0) + (order.rvp_units ?? 0)
    }

    profileRows.push({
      tenant_id: tenantId,
      master_sku_id: skuId,
      platform: 'flipkart',
      avg_commission_rate: commRateCount > 0 ? commRateSum / commRateCount : 0,
      avg_logistics_cost: logCount > 0 ? logSum / logCount : 0,
      avg_return_rate: grossUnits > 0 ? returnUnits / grossUnits : 0,
      avg_net_settlement_pct: nspCount > 0 ? nspSum / nspCount : 0,
      sample_size: skuOrderList.length,
      last_computed_at: new Date().toISOString(),
    })
  }

  if (profileRows.length > 0) {
    await supabase
      .from('sku_financial_profiles')
      .upsert(profileRows, { onConflict: 'tenant_id,master_sku_id,platform' })
  }
}
