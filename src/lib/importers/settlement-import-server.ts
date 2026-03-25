/**
 * Server-side Settlement Report importer.
 * Matches parsed settlement rows to existing orders and updates settlement fields.
 * Does NOT create new orders — only enriches existing ones.
 */
import { createClient } from '@/lib/supabase/server'
import type { ParsedSettlementRow } from './settlement-report-parser'

export interface SettlementImportResult {
  imported: number
  skipped: number
  enriched: number
  unmappedSkus: string[]
  anomalyCount: number
  errors: string[]
}

export async function importSettlementReport(
  rows: ParsedSettlementRow[],
  tenantId: string,
  skipRowIndices?: Set<number>,
): Promise<SettlementImportResult> {
  const supabase = await createClient()

  let enriched = 0
  let skipped = 0
  const errors: string[] = []

  // ── 1. Filter valid rows ──
  const validRows: ParsedSettlementRow[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (skipRowIndices?.has(i)) {
      skipped++
      continue
    }
    if (row.error) {
      skipped++
      errors.push(`Row ${row.rowIndex}: ${row.error}`)
      continue
    }
    validRows.push(row)
  }

  if (validRows.length === 0) {
    return { imported: 0, skipped, enriched, unmappedSkus: [], anomalyCount: 0, errors }
  }

  // ── 2. Batch lookup existing orders ──
  const allItemIds = [...new Set(validRows.map((r) => r.orderItemId).filter(Boolean))]
  const allPlatformOrderIds = [...new Set(validRows.map((r) => r.platformOrderId))]

  // Lookup by order_item_id
  const existingByItemId: Array<{
    id: string
    platform_order_id: string
    order_item_id: string | null
  }> = []

  for (let i = 0; i < allItemIds.length; i += 200) {
    const chunk = allItemIds.slice(i, i + 200)
    const { data, error } = await supabase
      .from('orders')
      .select('id, platform_order_id, order_item_id')
      .eq('tenant_id', tenantId)
      .in('order_item_id', chunk)

    if (error) {
      errors.push(`Order lookup by item ID failed: ${error.message}`)
      return { imported: 0, skipped, enriched, unmappedSkus: [], anomalyCount: 0, errors }
    }
    if (data) existingByItemId.push(...data)
  }

  // Also lookup by platform_order_id for fallback matching
  const existingByOrderId: Array<{
    id: string
    platform_order_id: string
    order_item_id: string | null
  }> = []

  for (let i = 0; i < allPlatformOrderIds.length; i += 200) {
    const chunk = allPlatformOrderIds.slice(i, i + 200)
    const { data, error } = await supabase
      .from('orders')
      .select('id, platform_order_id, order_item_id')
      .eq('tenant_id', tenantId)
      .in('platform_order_id', chunk)

    if (error) {
      errors.push(`Order lookup by order ID failed: ${error.message}`)
    }
    if (data) existingByOrderId.push(...data)
  }

  // ── 3. Build lookup maps ──
  const byItemId = new Map<string, { id: string; platform_order_id: string }>()
  for (const o of existingByItemId) {
    if (o.order_item_id) {
      byItemId.set(o.order_item_id, { id: o.id, platform_order_id: o.platform_order_id })
    }
  }

  const byOrderId = new Map<string, Array<{ id: string; order_item_id: string | null }>>()
  for (const o of existingByOrderId) {
    const list = byOrderId.get(o.platform_order_id) ?? []
    list.push({ id: o.id, order_item_id: o.order_item_id })
    byOrderId.set(o.platform_order_id, list)
  }

  // ── 4. Collect order IDs that we need order_financials for ──
  const matchedOrderIds = new Set<string>()

  // ── 5. Match rows to orders and update ──
  for (const row of validRows) {
    let matchedOrderId: string | null = null

    // Prefer exact order_item_id match
    if (row.orderItemId) {
      const exact = byItemId.get(row.orderItemId)
      if (exact) matchedOrderId = exact.id
    }

    // Fallback: match by platform_order_id
    if (!matchedOrderId) {
      const candidates = byOrderId.get(row.platformOrderId)
      if (candidates && candidates.length > 0) {
        if (row.orderItemId) {
          const itemMatch = candidates.find((c) => c.order_item_id === row.orderItemId)
          if (itemMatch) matchedOrderId = itemMatch.id
        }
        if (!matchedOrderId) {
          matchedOrderId = candidates[0].id
        }
      }
    }

    if (!matchedOrderId) {
      skipped++
      continue
    }

    // Update order with settlement data
    const updateFields: Record<string, unknown> = {}
    if (row.paymentDate) updateFields.settlement_date = row.paymentDate
    if (row.neftId) updateFields.neft_id = row.neftId
    if (row.dispatchDate) updateFields.dispatch_date = row.dispatchDate

    if (Object.keys(updateFields).length > 0) {
      const { error: updateErr } = await supabase
        .from('orders')
        .update(updateFields)
        .eq('id', matchedOrderId)

      if (updateErr) {
        errors.push(`Update order ${row.orderItemId} failed: ${updateErr.message}`)
        continue
      }
    }

    // Update order_financials.amount_settled if bankSettlementValue > 0
    if (row.bankSettlementValue > 0) {
      const { error: finErr } = await supabase
        .from('order_financials')
        .update({ amount_settled: row.bankSettlementValue })
        .eq('order_id', matchedOrderId)

      if (finErr) {
        // order_financials row might not exist yet — not a hard error
        // Only log if it's not a "no rows" situation
        if (!finErr.message.includes('0 rows')) {
          errors.push(`Update financials for ${row.orderItemId}: ${finErr.message}`)
        }
      }
    }

    matchedOrderIds.add(matchedOrderId)
    enriched++
  }

  return {
    imported: 0,
    skipped,
    enriched,
    unmappedSkus: [],
    anomalyCount: 0,
    errors,
  }
}
