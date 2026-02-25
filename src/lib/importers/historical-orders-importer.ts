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

function normaliseDate(raw: string): string {
  const d = new Date(raw)
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  const match = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  return raw
}

function classifyReturnType(raw: string): { returnType: 'customer' | 'logistics' | 'cancellation'; causesDeduction: boolean } {
  const v = raw.toLowerCase()
  if (v.includes('customer')) return { returnType: 'customer', causesDeduction: true }
  if (v.includes('cancel')) return { returnType: 'cancellation', causesDeduction: false }
  return { returnType: 'logistics', causesDeduction: false }
}

export async function processHistoricalOrders(
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
      const orderDateRaw = findCol(row, ['order date', 'order_date', 'purchase-date'])
      const statusRaw = findCol(row, ['status', 'order status', 'order-status']) ?? 'delivered'
      const returnTypeRaw = findCol(row, ['return type', 'return_type', 'return reason'])
      const qtyRaw = findCol(row, ['quantity', 'qty'])

      if (!platformOrderId || !orderDateRaw) {
        failed++
        errors.push(`Row missing order_id or order_date`)
        continue
      }

      const quantity = parseInt(qtyRaw ?? '1') || 1
      const orderDate = normaliseDate(orderDateRaw)

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
            sale_price: 0,
            order_date: orderDate,
            status: statusRaw.toLowerCase(),
          },
          { onConflict: 'tenant_id,platform_order_id' }
        )
        .select('id')
        .single()

      let orderId: string | null = order?.id ?? null
      if (orderError || !orderId) {
        const { data: existing } = await supabase
          .from('orders')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('platform_order_id', platformOrderId)
          .maybeSingle()
        orderId = existing?.id ?? null
      }

      // Insert return if applicable
      if (returnTypeRaw && returnTypeRaw.trim()) {
        const { returnType, causesDeduction } = classifyReturnType(returnTypeRaw)
        await supabase.from('returns').insert({
          tenant_id: tenantId,
          import_id: importId,
          order_id: orderId,
          master_sku_id: masterSkuId,
          return_type: returnType,
          causes_deduction: causesDeduction,
          deduction_amount: 0,
          quantity,
          return_date: orderDate,
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
