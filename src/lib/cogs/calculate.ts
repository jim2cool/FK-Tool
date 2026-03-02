// src/lib/cogs/calculate.ts
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'

export interface CogsBreakdown {
  sku_id: string
  sku_name: string
  parent_name?: string

  // Purchase COGS (WAC)
  wac_base_per_unit: number          // weighted avg unit_purchase_price (ex-GST)
  wac_freight_per_unit: number       // allocated ex-GST freight per unit
  purchase_cogs_per_unit: number     // wac_base + wac_freight

  // Dispatch COGS
  packaging_cost_per_dispatch: number  // sum(material_cost × qty_per_dispatch)
  delivery_rate: number                // e.g. 0.85
  dispatch_cogs_per_unit: number       // packaging_cost / delivery_rate

  // Shrinkage
  shrinkage_rate: number               // e.g. 0.02
  shrinkage_per_unit: number           // shrinkage_rate × purchase_cogs_per_unit

  // Total
  full_cogs_per_unit: number

  // Supporting data
  total_units_purchased: number
  lot_count: number
  latest_purchase_date: string | null
}

export async function calculateCogs(skuId: string): Promise<CogsBreakdown | null> {
  const supabase = await createClient()
  const tenantId = await getTenantId()

  // 1. All purchases for this SKU
  const { data: purchases } = await supabase
    .from('purchases')
    .select('id, quantity, unit_purchase_price, invoice_number, purchase_date')
    .eq('tenant_id', tenantId)
    .eq('master_sku_id', skuId)
    .order('purchase_date', { ascending: true })

  if (!purchases || purchases.length === 0) return null

  // 2. WAC base — unit_purchase_price is already ex-GST
  const totalQty = purchases.reduce((s, p) => s + Number(p.quantity), 0)
  const totalValue = purchases.reduce(
    (s, p) => s + Number(p.quantity) * Number(p.unit_purchase_price),
    0
  )
  const wacBase = totalQty > 0 ? totalValue / totalQty : 0

  // 3. Freight allocation — pro-rate by SKU value within each invoice
  const invoiceNumbers = [
    ...new Set(purchases.map(p => p.invoice_number).filter(Boolean)),
  ] as string[]
  let totalAllocatedFreight = 0

  for (const invNum of invoiceNumbers) {
    const skuLotRows = purchases.filter(p => p.invoice_number === invNum)
    const skuLotValue = skuLotRows.reduce(
      (s, p) => s + Number(p.quantity) * Number(p.unit_purchase_price),
      0
    )
    const skuLotQty = skuLotRows.reduce((s, p) => s + Number(p.quantity), 0)

    // Fetch ALL purchases for this invoice (all SKUs) to get correct lot total value
    const { data: allLotPurchases } = await supabase
      .from('purchases')
      .select('quantity, unit_purchase_price')
      .eq('tenant_id', tenantId)
      .eq('invoice_number', invNum)

    const lotTotalValue = (allLotPurchases ?? []).reduce(
      (s, p) => s + Number(p.quantity) * Number(p.unit_purchase_price),
      0
    )

    // Fetch freight invoices for this purchase invoice
    const { data: freightRows } = await supabase
      .from('freight_invoices')
      .select('total_amount, tax_paid, gst_rate_slab')
      .eq('tenant_id', tenantId)
      .eq('purchase_invoice_number', invNum)

    for (const f of freightRows ?? []) {
      const rate =
        parseFloat(String(f.gst_rate_slab).replace('%', '')) || 0
      // Strip GST from freight to get ex-GST amount
      const freightExGst = f.tax_paid
        ? Number(f.total_amount) / (1 + rate / 100)
        : Number(f.total_amount)

      if (lotTotalValue > 0 && skuLotQty > 0) {
        // Freight allocated to this SKU for this lot
        const allocated = freightExGst * (skuLotValue / lotTotalValue)
        totalAllocatedFreight += allocated
      }
    }
  }

  const wacFreight = totalQty > 0 ? totalAllocatedFreight / totalQty : 0
  const purchaseCogs = wacBase + wacFreight

  // 4. SKU config — shrinkage_rate + delivery_rate + parent name
  const { data: skuRow } = await supabase
    .from('master_skus')
    .select('id, name, parent_id, shrinkage_rate, delivery_rate')
    .eq('id', skuId)
    .eq('tenant_id', tenantId)
    .single()

  const shrinkageRate = Number(skuRow?.shrinkage_rate ?? 0.02)
  const deliveryRate = Number(skuRow?.delivery_rate ?? 1.0)

  let parentName: string | undefined
  if (skuRow?.parent_id) {
    const { data: parentRow } = await supabase
      .from('master_skus')
      .select('name')
      .eq('id', skuRow.parent_id)
      .eq('tenant_id', tenantId)
      .single()
    parentName = parentRow?.name ?? undefined
  }

  // 5. Dispatch packaging cost
  const { data: packagingConfig } = await supabase
    .from('sku_packaging_config')
    .select('qty_per_dispatch, packaging_materials(unit_cost)')
    .eq('tenant_id', tenantId)
    .eq('master_sku_id', skuId)

  const packagingCostPerDispatch = (packagingConfig ?? []).reduce((s, c) => {
    const mat = (Array.isArray(c.packaging_materials) ? c.packaging_materials[0] : c.packaging_materials) as { unit_cost: number } | null
    return s + (Number(mat?.unit_cost) ?? 0) * Number(c.qty_per_dispatch)
  }, 0)

  const dispatchCogs =
    deliveryRate > 0 ? packagingCostPerDispatch / deliveryRate : 0

  // 6. Shrinkage
  const shrinkagePerUnit = shrinkageRate * purchaseCogs

  // 7. Full COGS
  const fullCogs = purchaseCogs + dispatchCogs + shrinkagePerUnit

  const lotSet = new Set(
    purchases.map(p => p.invoice_number).filter(Boolean)
  )

  return {
    sku_id: skuId,
    sku_name: skuRow?.name ?? '',
    parent_name: parentName,
    wac_base_per_unit: Math.round(wacBase * 100) / 100,
    wac_freight_per_unit: Math.round(wacFreight * 100) / 100,
    purchase_cogs_per_unit: Math.round(purchaseCogs * 100) / 100,
    packaging_cost_per_dispatch: Math.round(packagingCostPerDispatch * 100) / 100,
    delivery_rate: deliveryRate,
    dispatch_cogs_per_unit: Math.round(dispatchCogs * 100) / 100,
    shrinkage_rate: shrinkageRate,
    shrinkage_per_unit: Math.round(shrinkagePerUnit * 100) / 100,
    full_cogs_per_unit: Math.round(fullCogs * 100) / 100,
    total_units_purchased: totalQty,
    lot_count: lotSet.size,
    latest_purchase_date: purchases.at(-1)?.purchase_date ?? null,
  }
}
