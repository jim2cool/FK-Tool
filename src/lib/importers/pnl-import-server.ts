/**
 * Server-only P&L importer.
 * Resolves SKU names via sku_mappings, upserts orders + order_financials,
 * runs anomaly detection, and recomputes sku_financial_profiles.
 *
 * Uses the server Supabase client — do NOT import from client components.
 */
import { createClient } from '@/lib/supabase/server'
import type { ParsedPnlRow } from './pnl-xlsx-parser'
import type { AnomalyFlag } from '@/lib/pnl/anomaly-rules'
import { detectAnomalies } from '@/lib/pnl/anomaly-rules'

export interface PnlImportResult {
  imported: number
  skipped: number
  enriched: number
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

  // ── 1. Load SKU mappings for this tenant (Flipkart) ──
  const { data: mappings, error: mappingsErr } = await supabase
    .from('sku_mappings')
    .select('platform_sku, master_sku_id, combo_product_id')
    .eq('tenant_id', tenantId)
    .eq('platform', 'flipkart')

  if (mappingsErr) {
    return {
      imported: 0, skipped: 0, enriched: 0,
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

  const enabledRules = new Set<string>(
    (rulesData ?? []).map((r) => r.rule_key),
  )

  // ── 3. Process rows ──
  let imported = 0
  let skipped = 0
  let enriched = 0
  let anomalyCount = 0
  const unmappedSkusSet = new Set<string>()
  const errors: string[] = []
  const affectedSkuIds = new Set<string>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]

    // Skip rows the caller flagged (duplicates from preview)
    if (skipRowIndices?.has(i)) {
      skipped++
      continue
    }

    // Skip rows the parser marked as invalid
    if (row.error) {
      skipped++
      errors.push(`Row ${i + 1}: ${row.error}`)
      continue
    }

    // ── 3a. Resolve SKU ──
    const mapping = skuMap.get(row.skuName.toLowerCase())
    let masterSkuId: string | null = null
    let comboProductId: string | null = null

    if (mapping) {
      masterSkuId = mapping.master_sku_id
      comboProductId = mapping.combo_product_id
    } else {
      unmappedSkusSet.add(row.skuName)
    }

    // ── 3b. Run anomaly detection ──
    const anomalies: AnomalyFlag[] = detectAnomalies(row, enabledRules)
    if (anomalies.length > 0) anomalyCount += anomalies.length

    // ── 3c. 3-step upsert for orders ──
    // Step 1: Check for existing orders with this platform_order_id
    const { data: existingOrders, error: lookupErr } = await supabase
      .from('orders')
      .select('id, order_item_id')
      .eq('tenant_id', tenantId)
      .eq('platform_order_id', row.platformOrderId)

    if (lookupErr) {
      errors.push(`Row ${i + 1}: Order lookup failed: ${lookupErr.message}`)
      skipped++
      continue
    }

    let orderId: string | null = null

    if (existingOrders && existingOrders.length > 0) {
      // Check for exact match (true duplicate) — order_item_id matches
      const exactMatch = existingOrders.find(
        (o) => o.order_item_id === row.orderItemId,
      )
      if (exactMatch) {
        // True duplicate — skip
        skipped++
        continue
      }

      // Check for label-sorted order (order_item_id === platform_order_id)
      const labelMatch = existingOrders.find(
        (o) => o.order_item_id === row.platformOrderId,
      )
      if (labelMatch) {
        // Enrich existing label-sorted order with P&L data
        const { error: updateErr } = await supabase
          .from('orders')
          .update({
            order_item_id: row.orderItemId,
            status: row.orderStatus,
            fulfillment_type: row.fulfillmentType,
            channel: row.channel,
            payment_mode: row.paymentMode,
            final_selling_price: row.finalSellingPrice,
            gross_units: row.grossUnits,
            net_units: row.netUnits,
            rto_units: row.rtoUnits,
            rvp_units: row.rvpUnits,
            cancelled_units: row.cancelledUnits,
            ...(masterSkuId ? { master_sku_id: masterSkuId } : {}),
            ...(comboProductId ? { combo_product_id: comboProductId } : {}),
          })
          .eq('id', labelMatch.id)

        if (updateErr) {
          errors.push(`Row ${i + 1}: Order update failed: ${updateErr.message}`)
          skipped++
          continue
        }

        orderId = labelMatch.id
        enriched++
      }
    }

    // Step 3: No match — insert new order
    if (!orderId) {
      const { data: newOrder, error: insertErr } = await supabase
        .from('orders')
        .insert({
          tenant_id: tenantId,
          platform_order_id: row.platformOrderId,
          order_item_id: row.orderItemId,
          marketplace_account_id: marketplaceAccountId,
          master_sku_id: masterSkuId,
          combo_product_id: comboProductId,
          order_date: row.orderDate,
          status: row.orderStatus,
          fulfillment_type: row.fulfillmentType,
          channel: row.channel,
          payment_mode: row.paymentMode,
          final_selling_price: row.finalSellingPrice,
          sale_price: row.finalSellingPrice,
          gross_units: row.grossUnits,
          net_units: row.netUnits,
          rto_units: row.rtoUnits,
          rvp_units: row.rvpUnits,
          cancelled_units: row.cancelledUnits,
        })
        .select('id')
        .single()

      if (insertErr || !newOrder) {
        errors.push(`Row ${i + 1}: Order insert failed: ${insertErr?.message ?? 'unknown'}`)
        skipped++
        continue
      }

      orderId = newOrder.id
      imported++
    }

    // Track affected SKUs for profile recomputation
    if (masterSkuId) affectedSkuIds.add(masterSkuId)

    // ── 3d. Upsert order_financials ──
    const salePriceVal = row.accountedNetSales || row.finalSellingPrice
    const commissionAmt = Math.abs(row.commissionFee)
    const commissionRate = row.accountedNetSales
      ? Math.abs(row.commissionFee) / row.accountedNetSales
      : 0
    const logisticsCost = Math.abs(
      row.forwardShippingFee + row.reverseShippingFee + row.pickPackFee,
    )
    const otherDeductions = Math.abs(
      row.collectionFee + row.fixedFee + row.offerAdjustments,
    )
    const projectedSettlement = row.projectedSettlement
    const actualSettlement = row.amountSettled || null
    const settlementVariance = row.amountSettled
      ? row.amountSettled - row.projectedSettlement
      : null

    const { error: finErr } = await supabase
      .from('order_financials')
      .upsert(
        {
          tenant_id: tenantId,
          order_id: orderId,
          // Granular fees (stored as-is from Flipkart)
          accounted_net_sales: row.accountedNetSales,
          sale_amount: row.saleAmount,
          seller_offer_burn: row.sellerOfferBurn,
          commission_fee: row.commissionFee,
          collection_fee: row.collectionFee,
          fixed_fee: row.fixedFee,
          offer_adjustments: row.offerAdjustments,
          pick_pack_fee: row.pickPackFee,
          forward_shipping_fee: row.forwardShippingFee,
          reverse_shipping_fee: row.reverseShippingFee,
          tax_gst: row.taxGst,
          tax_tcs: row.taxTcs,
          tax_tds: row.taxTds,
          rewards: row.rewards,
          spf_payout: row.spfPayout,
          amount_settled: row.amountSettled,
          amount_pending: row.amountPending,
          // Backward-compat aggregates
          sale_price: salePriceVal,
          commission_amount: commissionAmt,
          commission_rate: commissionRate,
          logistics_cost: logisticsCost,
          other_deductions: otherDeductions,
          projected_settlement: projectedSettlement,
          actual_settlement: actualSettlement,
          settlement_variance: settlementVariance,
          // Anomaly tracking
          anomaly_flags: anomalies,
        },
        { onConflict: 'tenant_id,order_id' },
      )

    if (finErr) {
      errors.push(`Row ${i + 1}: Financials upsert failed: ${finErr.message}`)
    }
  }

  // ── 5. Recompute sku_financial_profiles for affected SKUs ──
  if (affectedSkuIds.size > 0) {
    await recomputeFinancialProfiles(supabase, tenantId, affectedSkuIds)
  }

  return {
    imported,
    skipped,
    enriched,
    unmappedSkus: [...unmappedSkusSet],
    anomalyCount,
    errors,
  }
}

/**
 * Recompute sku_financial_profiles for the given SKU IDs.
 * Fetches orders + financials and computes averages in JS.
 */
async function recomputeFinancialProfiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  skuIds: Set<string>,
) {
  const skuIdArray = [...skuIds]

  // Fetch all orders for affected SKUs
  const { data: orders } = await supabase
    .from('orders')
    .select('id, master_sku_id, gross_units, rto_units, rvp_units')
    .eq('tenant_id', tenantId)
    .in('master_sku_id', skuIdArray)

  if (!orders || orders.length === 0) return

  // Fetch all financials for those orders
  const orderIds = orders.map((o) => o.id)
  const { data: financials } = await supabase
    .from('order_financials')
    .select(
      'order_id, accounted_net_sales, commission_fee, forward_shipping_fee, reverse_shipping_fee, pick_pack_fee, amount_settled',
    )
    .in('order_id', orderIds)

  if (!financials) return

  // Build a map: orderId → financials
  const finMap = new Map<string, (typeof financials)[number]>()
  for (const f of financials) {
    finMap.set(f.order_id, f)
  }

  // Group orders by master_sku_id
  const skuOrders = new Map<string, typeof orders>()
  for (const o of orders) {
    if (!o.master_sku_id) continue
    const list = skuOrders.get(o.master_sku_id) ?? []
    list.push(o)
    skuOrders.set(o.master_sku_id, list)
  }

  // Compute profiles and upsert
  for (const [skuId, skuOrderList] of skuOrders) {
    let commissionRateSum = 0
    let commissionRateCount = 0
    let logisticsCostSum = 0
    let logisticsCostCount = 0
    let totalGrossUnits = 0
    let totalReturnUnits = 0
    let netSettlementPctSum = 0
    let netSettlementPctCount = 0

    for (const order of skuOrderList) {
      const fin = finMap.get(order.id)
      if (!fin) continue

      const ans = fin.accounted_net_sales ?? 0
      if (ans > 0) {
        commissionRateSum += Math.abs(fin.commission_fee ?? 0) / ans
        commissionRateCount++

        if (fin.amount_settled) {
          netSettlementPctSum += fin.amount_settled / ans
          netSettlementPctCount++
        }
      }

      logisticsCostSum += Math.abs(
        (fin.forward_shipping_fee ?? 0) +
          (fin.reverse_shipping_fee ?? 0) +
          (fin.pick_pack_fee ?? 0),
      )
      logisticsCostCount++

      totalGrossUnits += order.gross_units ?? 0
      totalReturnUnits += (order.rto_units ?? 0) + (order.rvp_units ?? 0)
    }

    const avgCommissionRate =
      commissionRateCount > 0 ? commissionRateSum / commissionRateCount : 0
    const avgLogisticsCost =
      logisticsCostCount > 0 ? logisticsCostSum / logisticsCostCount : 0
    const avgReturnRate =
      totalGrossUnits > 0 ? totalReturnUnits / totalGrossUnits : 0
    const avgNetSettlementPct =
      netSettlementPctCount > 0
        ? netSettlementPctSum / netSettlementPctCount
        : 0

    await supabase.from('sku_financial_profiles').upsert(
      {
        tenant_id: tenantId,
        master_sku_id: skuId,
        platform: 'flipkart',
        avg_commission_rate: avgCommissionRate,
        avg_logistics_cost: avgLogisticsCost,
        avg_return_rate: avgReturnRate,
        avg_net_settlement_pct: avgNetSettlementPct,
        sample_size: skuOrderList.length,
        last_computed_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,master_sku_id,platform' },
    )
  }
}
