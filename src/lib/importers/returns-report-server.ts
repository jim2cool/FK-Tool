/**
 * Server-side Returns Report importer.
 * Matches parsed return rows to existing orders and updates return fields.
 * Does NOT create new orders — only enriches existing ones.
 */
import { createClient } from '@/lib/supabase/server'
import type { ParsedReturnRow } from './returns-report-parser'

export interface ReturnsImportResult {
  updated: number
  notFound: number
  skipped: number
  errors: string[]
}

export async function importReturnsReport(
  rows: ParsedReturnRow[],
  tenantId: string,
  skipRowIndices?: Set<number>,
): Promise<ReturnsImportResult> {
  const supabase = await createClient()

  let updated = 0
  let notFound = 0
  let skipped = 0
  const errors: string[] = []

  // ── 1. Filter valid rows ──
  const validRows: ParsedReturnRow[] = []
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
    return { updated, notFound, skipped, errors }
  }

  // ── 2. Batch lookup existing orders ──
  const allPlatformOrderIds = [
    ...new Set(validRows.map((r) => r.platformOrderId)),
  ]

  const existingOrders: Array<{
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
      errors.push(`Order lookup failed: ${error.message}`)
      return { updated, notFound, skipped, errors }
    }
    if (data) existingOrders.push(...data)
  }

  // ── 3. Build lookup maps ──
  // order_item_id → order record (exact match)
  const byItemId = new Map<
    string,
    { id: string; platform_order_id: string }
  >()
  // platform_order_id → order records (fallback: match by order ID only)
  const byOrderId = new Map<
    string,
    Array<{ id: string; order_item_id: string | null }>
  >()

  for (const o of existingOrders) {
    if (o.order_item_id) {
      byItemId.set(o.order_item_id, {
        id: o.id,
        platform_order_id: o.platform_order_id,
      })
    }
    const list = byOrderId.get(o.platform_order_id) ?? []
    list.push({ id: o.id, order_item_id: o.order_item_id })
    byOrderId.set(o.platform_order_id, list)
  }

  // ── 4. Match rows to orders and batch update ──
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
        // If there's an exact item match in candidates, prefer it
        if (row.orderItemId) {
          const itemMatch = candidates.find(
            (c) => c.order_item_id === row.orderItemId,
          )
          if (itemMatch) matchedOrderId = itemMatch.id
        }
        // Otherwise take the first candidate
        if (!matchedOrderId) {
          matchedOrderId = candidates[0].id
        }
      }
    }

    if (!matchedOrderId) {
      notFound++
      continue
    }

    const { error: updateErr } = await supabase
      .from('orders')
      .update({
        return_type: row.returnType,
        return_request_date: row.returnRequestDate,
        return_complete_date: row.returnCompleteDate,
        return_status: row.returnStatus,
        return_reason: row.returnReason,
        return_sub_reason: row.returnSubReason,
        status: 'returned',
      })
      .eq('id', matchedOrderId)

    if (updateErr) {
      errors.push(
        `Update order ${row.platformOrderId} failed: ${updateErr.message}`,
      )
    } else {
      updated++
    }
  }

  return { updated, notFound, skipped, errors }
}
