import { createClient } from '@/lib/supabase/server'

interface ImportResult {
  processed: number
  failed: number
  errors: string[]
}

// Normalise a header key for lookup
function n(s: string) { return s.toLowerCase().replace(/\s+/g, ' ').trim() }

function findCol(row: Record<string, string>, candidates: string[]): string | undefined {
  const normRow: Record<string, string> = {}
  for (const k of Object.keys(row)) normRow[n(k)] = row[k]
  for (const c of candidates) {
    if (normRow[c] !== undefined) return normRow[c]
  }
  return undefined
}

export async function processDispatchReport(
  rows: Record<string, string>[],
  importId: string,
  tenantId: string,
  marketplaceAccountId: string
): Promise<ImportResult> {
  const supabase = await createClient()
  let processed = 0
  let failed = 0
  const errors: string[] = []

  // Get default warehouse for this tenant
  const { data: warehouses } = await supabase
    .from('warehouses')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .limit(1)
  const defaultWarehouseId = warehouses?.[0]?.id ?? null

  for (const row of rows) {
    try {
      const orderId = findCol(row, ['order id', 'order_id', 'amazon-order-id'])
      const platformSku = findCol(row, ['sku', 'fsn', 'asin'])
      const dispatchDateRaw = findCol(row, ['dispatch date', 'dispatch_date', 'ship-date', 'ship date'])
      const qtyRaw = findCol(row, ['quantity', 'quantity-shipped', 'qty'])

      if (!orderId || !dispatchDateRaw) {
        failed++
        errors.push(`Row missing order_id or dispatch_date: ${JSON.stringify(row).slice(0, 80)}`)
        continue
      }

      const quantity = parseInt(qtyRaw ?? '1') || 1

      // Resolve master_sku_id from platform_sku
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

      // Resolve warehouse from row if present, else default
      const warehouseName = findCol(row, ['warehouse', 'warehouse name'])
      let warehouseId = defaultWarehouseId
      if (warehouseName) {
        const { data: wh } = await supabase
          .from('warehouses')
          .select('id')
          .eq('tenant_id', tenantId)
          .ilike('name', warehouseName)
          .maybeSingle()
        if (wh) warehouseId = wh.id
      }

      const { error } = await supabase.from('dispatches').insert({
        tenant_id: tenantId,
        import_id: importId,
        master_sku_id: masterSkuId,
        warehouse_id: warehouseId,
        marketplace_account_id: marketplaceAccountId || null,
        order_id: orderId,
        platform_sku: platformSku ?? null,
        quantity,
        dispatch_date: normaliseDate(dispatchDateRaw),
      })

      if (error) {
        failed++
        errors.push(`Insert error: ${error.message}`)
      } else {
        processed++
      }
    } catch (e) {
      failed++
      errors.push(`Unexpected error: ${(e as Error).message}`)
    }
  }

  return { processed, failed, errors }
}

function normaliseDate(raw: string): string {
  // Try to coerce various date formats to YYYY-MM-DD
  const d = new Date(raw)
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0]
  }
  // DD-MM-YYYY or DD/MM/YYYY
  const match = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  return raw
}
