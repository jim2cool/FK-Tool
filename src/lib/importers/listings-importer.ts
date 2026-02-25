import { createClient } from '@/lib/supabase/server'

interface ImportResult {
  processed: number
  failed: number
  errors: string[]
}

function n(s: string) { return s.toLowerCase().replace(/\s+/g, ' ').trim() }

function findCol(row: Record<string, string>, candidates: string[]): string | undefined {
  const normRow: Record<string, string> = {}
  for (const k of Object.keys(row)) normRow[n(k)] = row[k]
  for (const c of candidates) {
    if (normRow[c] !== undefined) return normRow[c]
  }
  return undefined
}

function toNum(s: string | undefined): number {
  if (!s) return 0
  return parseFloat(s.replace(/[₹,\s]/g, '')) || 0
}

function normaliseDate(raw: string): string {
  const d = new Date(raw)
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  const match = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  return raw
}

export async function processListingsSettlement(
  rows: Record<string, string>[],
  importId: string,
  tenantId: string,
  marketplaceAccountId: string
): Promise<ImportResult> {
  const supabase = await createClient()
  let processed = 0
  let failed = 0
  const errors: string[] = []

  for (const row of rows) {
    try {
      const platformOrderId = findCol(row, ['order id', 'order_id', 'amazon-order-id'])
      const platformSku = findCol(row, ['sku', 'fsn', 'asin'])
      const salePriceRaw = findCol(row, ['sale price', 'sale_price', 'item-price', 'selling price'])
      const commissionRaw = findCol(row, ['commission', 'commission amount', 'marketplace fee'])
      const logisticsRaw = findCol(row, ['logistics fee', 'logistics_fee', 'shipping fee', 'courier charges'])
      const otherDeductionsRaw = findCol(row, ['other deductions', 'collection fee', 'other charges'])
      const orderDateRaw = findCol(row, ['order date', 'order_date', 'purchase-date', 'transaction date'])
      const qtyRaw = findCol(row, ['quantity', 'qty', 'quantity-purchased'])

      if (!platformOrderId || !orderDateRaw) {
        failed++
        errors.push(`Row missing order_id or order_date`)
        continue
      }

      const salePrice = toNum(salePriceRaw)
      const commissionAmount = toNum(commissionRaw)
      const logisticsCost = toNum(logisticsRaw)
      const otherDeductions = toNum(otherDeductionsRaw)
      const commissionRate = salePrice > 0 ? commissionAmount / salePrice : 0
      const projectedSettlement = salePrice - commissionAmount - logisticsCost - otherDeductions
      const quantity = parseInt(qtyRaw ?? '1') || 1

      // Resolve master_sku_id
      let masterSkuId: string | null = null
      if (platformSku) {
        const { data: mapping } = await supabase
          .from('sku_mappings')
          .select('master_sku_id')
          .eq('tenant_id', tenantId)
          .eq('platform_sku', platformSku)
          .maybeSingle()
        masterSkuId = mapping?.master_sku_id ?? null
      }

      // Upsert order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .upsert(
          {
            tenant_id: tenantId,
            import_id: importId,
            platform_order_id: platformOrderId,
            master_sku_id: masterSkuId,
            marketplace_account_id: marketplaceAccountId || null,
            quantity,
            sale_price: salePrice,
            order_date: normaliseDate(orderDateRaw),
            status: 'delivered',
          },
          { onConflict: 'tenant_id,platform_order_id' }
        )
        .select('id')
        .single()

      if (orderError || !order) {
        // Try fetching existing
        const { data: existing } = await supabase
          .from('orders')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('platform_order_id', platformOrderId)
          .maybeSingle()
        if (!existing) {
          failed++
          errors.push(`Order upsert failed: ${orderError?.message}`)
          continue
        }
        // Insert financial row for existing order
        await supabase.from('order_financials').insert({
          tenant_id: tenantId,
          order_id: existing.id,
          sale_price: salePrice,
          commission_amount: commissionAmount,
          commission_rate: commissionRate,
          logistics_cost: logisticsCost,
          other_deductions: otherDeductions,
          projected_settlement: projectedSettlement,
        })
      } else {
        await supabase.from('order_financials').insert({
          tenant_id: tenantId,
          order_id: order.id,
          sale_price: salePrice,
          commission_amount: commissionAmount,
          commission_rate: commissionRate,
          logistics_cost: logisticsCost,
          other_deductions: otherDeductions,
          projected_settlement: projectedSettlement,
        })
      }

      processed++
    } catch (e) {
      failed++
      errors.push(`Unexpected error: ${(e as Error).message}`)
    }
  }

  return { processed, failed, errors }
}
