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

/**
 * Batch COGS calculation — fetches all data in ~6 queries regardless of SKU count.
 * Use this for P&L dashboard and list views. Single-SKU calculateCogs() is kept for detail views.
 */
export async function calculateCogsBatch(skuIds: string[]): Promise<Map<string, CogsBreakdown>> {
  const result = new Map<string, CogsBreakdown>()
  if (skuIds.length === 0) return result

  const supabase = await createClient()
  const tenantId = await getTenantId()

  // 1. All purchases for all SKUs
  const { data: allPurchases } = await supabase
    .from('purchases')
    .select('id, master_sku_id, quantity, unit_purchase_price, invoice_number, purchase_date')
    .eq('tenant_id', tenantId)
    .in('master_sku_id', skuIds)
    .order('purchase_date', { ascending: true })

  if (!allPurchases || allPurchases.length === 0) return result

  // Group purchases by SKU
  const purchasesBySku = new Map<string, typeof allPurchases>()
  for (const p of allPurchases) {
    const list = purchasesBySku.get(p.master_sku_id) ?? []
    list.push(p)
    purchasesBySku.set(p.master_sku_id, list)
  }

  // 2. All unique invoice numbers
  const allInvoiceNumbers = [...new Set(allPurchases.map(p => p.invoice_number).filter(Boolean))] as string[]

  // 3. All purchases per invoice (for lot total value calculation)
  let allLotPurchases: Array<{ invoice_number: string; quantity: number; unit_purchase_price: number }> = []
  if (allInvoiceNumbers.length > 0) {
    const { data } = await supabase
      .from('purchases')
      .select('invoice_number, quantity, unit_purchase_price')
      .eq('tenant_id', tenantId)
      .in('invoice_number', allInvoiceNumbers)
    allLotPurchases = data ?? []
  }

  // Group lot purchases by invoice
  const lotPurchasesByInvoice = new Map<string, typeof allLotPurchases>()
  for (const p of allLotPurchases) {
    if (!p.invoice_number) continue
    const list = lotPurchasesByInvoice.get(p.invoice_number) ?? []
    list.push(p)
    lotPurchasesByInvoice.set(p.invoice_number, list)
  }

  // 4. All freight invoices for these invoice numbers
  let allFreight: Array<{ purchase_invoice_number: string; total_amount: number; tax_paid: boolean; gst_rate_slab: string }> = []
  if (allInvoiceNumbers.length > 0) {
    const { data } = await supabase
      .from('freight_invoices')
      .select('purchase_invoice_number, total_amount, tax_paid, gst_rate_slab')
      .eq('tenant_id', tenantId)
      .in('purchase_invoice_number', allInvoiceNumbers)
    allFreight = data ?? []
  }

  // Group freight by invoice
  const freightByInvoice = new Map<string, typeof allFreight>()
  for (const f of allFreight) {
    const list = freightByInvoice.get(f.purchase_invoice_number) ?? []
    list.push(f)
    freightByInvoice.set(f.purchase_invoice_number, list)
  }

  // 5. All SKU rows (name, parent_id, shrinkage_rate, delivery_rate)
  const { data: skuRows } = await supabase
    .from('master_skus')
    .select('id, name, parent_id, shrinkage_rate, delivery_rate')
    .eq('tenant_id', tenantId)
    .in('id', skuIds)

  const skuMap = new Map((skuRows ?? []).map(s => [s.id, s]))

  // Get parent names for variants
  const parentIds = [...new Set((skuRows ?? []).map(s => s.parent_id).filter(Boolean))] as string[]
  let parentMap = new Map<string, string>()
  if (parentIds.length > 0) {
    const { data: parents } = await supabase
      .from('master_skus')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .in('id', parentIds)
    parentMap = new Map((parents ?? []).map(p => [p.id, p.name]))
  }

  // 6. All packaging configs with material costs
  const { data: allPackagingConfig } = await supabase
    .from('sku_packaging_config')
    .select('master_sku_id, qty_per_dispatch, packaging_materials(unit_cost)')
    .eq('tenant_id', tenantId)
    .in('master_sku_id', skuIds)

  // Group packaging by SKU
  const packagingBySku = new Map<string, typeof allPackagingConfig>()
  for (const c of allPackagingConfig ?? []) {
    const list = packagingBySku.get(c.master_sku_id) ?? []
    list.push(c)
    packagingBySku.set(c.master_sku_id, list)
  }

  // Compute per-SKU COGS using same math as calculateCogs()
  for (const skuId of skuIds) {
    const purchases = purchasesBySku.get(skuId)
    if (!purchases || purchases.length === 0) continue

    // WAC base
    const totalQty = purchases.reduce((s, p) => s + Number(p.quantity), 0)
    const totalValue = purchases.reduce(
      (s, p) => s + Number(p.quantity) * Number(p.unit_purchase_price), 0
    )
    const wacBase = totalQty > 0 ? totalValue / totalQty : 0

    // Freight allocation
    const invoiceNumbers = [...new Set(purchases.map(p => p.invoice_number).filter(Boolean))] as string[]
    let totalAllocatedFreight = 0

    for (const invNum of invoiceNumbers) {
      const skuLotRows = purchases.filter(p => p.invoice_number === invNum)
      const skuLotValue = skuLotRows.reduce(
        (s, p) => s + Number(p.quantity) * Number(p.unit_purchase_price), 0
      )
      const skuLotQty = skuLotRows.reduce((s, p) => s + Number(p.quantity), 0)

      const lotPurchases = lotPurchasesByInvoice.get(invNum) ?? []
      const lotTotalValue = lotPurchases.reduce(
        (s, p) => s + Number(p.quantity) * Number(p.unit_purchase_price), 0
      )

      const freightRows = freightByInvoice.get(invNum) ?? []
      for (const f of freightRows) {
        const rate = parseFloat(String(f.gst_rate_slab).replace('%', '')) || 0
        const freightExGst = f.tax_paid
          ? Number(f.total_amount) / (1 + rate / 100)
          : Number(f.total_amount)

        if (lotTotalValue > 0 && skuLotQty > 0) {
          totalAllocatedFreight += freightExGst * (skuLotValue / lotTotalValue)
        }
      }
    }

    const wacFreight = totalQty > 0 ? totalAllocatedFreight / totalQty : 0
    const purchaseCogs = wacBase + wacFreight

    // SKU config
    const skuRow = skuMap.get(skuId)
    const shrinkageRate = Number(skuRow?.shrinkage_rate ?? 0.02)
    const deliveryRate = Number(skuRow?.delivery_rate ?? 1.0)
    const parentName = skuRow?.parent_id ? parentMap.get(skuRow.parent_id) : undefined

    // Packaging
    const packagingConfig = packagingBySku.get(skuId) ?? []
    const packagingCostPerDispatch = packagingConfig.reduce((s, c) => {
      const mat = (Array.isArray(c.packaging_materials) ? c.packaging_materials[0] : c.packaging_materials) as { unit_cost: number } | null
      return s + (Number(mat?.unit_cost) ?? 0) * Number(c.qty_per_dispatch)
    }, 0)

    const dispatchCogs = deliveryRate > 0 ? packagingCostPerDispatch / deliveryRate : 0
    const shrinkagePerUnit = shrinkageRate * purchaseCogs
    const fullCogs = purchaseCogs + dispatchCogs + shrinkagePerUnit

    const lotSet = new Set(purchases.map(p => p.invoice_number).filter(Boolean))

    result.set(skuId, {
      sku_id: skuId,
      sku_name: skuRow?.name ?? '',
      parent_name: parentName ?? undefined,
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
    })
  }

  return result
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
