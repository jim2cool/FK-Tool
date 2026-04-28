import type { OrderStatus } from '@/types/database'

export interface ParsedOrderRow {
  rowIndex: number
  platformOrderId: string
  orderItemId: string
  orderDate: string
  orderStatus: OrderStatus
  skuName: string
  quantity: number
  fulfillmentType: string
  dispatchDate: string | null
  deliveryDate: string | null
  cancellationDate: string | null
  cancellationReason: string | null
  returnRequestDate: string | null
  error?: string
}

// Flipkart order_item_status → internal OrderStatus
const STATUS_MAP: Record<string, OrderStatus> = {
  DELIVERED: 'delivered',
  RETURNED: 'returned',
  CANCELLED: 'cancelled',
  REJECTED: 'cancelled',
  RETURN_REQUESTED: 'returned',
  READY_TO_SHIP: 'dispatched',
  APPROVED: 'pending',
  APPROVAL_HOLD: 'pending',
}

// Column header text → field name mapping
const COLUMN_DEFS: Array<{ search: string; field: string }> = [
  { search: 'order_item_id', field: 'orderItemId' },
  { search: 'order_id', field: 'platformOrderId' },
  { search: 'fulfilment_type', field: 'fulfillmentType' },
  { search: 'order_date', field: 'orderDate' },
  { search: 'order_item_status', field: 'orderStatus' },
  { search: 'sku', field: 'skuName' },
  { search: 'quantity', field: 'quantity' },
  { search: 'dispatched_date', field: 'dispatchDate' },
  { search: 'order_delivery_date', field: 'deliveryDate' },
  { search: 'order_cancellation_date', field: 'cancellationDate' },
  { search: 'cancellation_reason', field: 'cancellationReason' },
  { search: 'order_return_approval_date', field: 'returnRequestDate' },
]

const REQUIRED_FIELDS = [
  'platformOrderId',
  'orderItemId',
  'orderDate',
  'orderStatus',
  'skuName',
]

/**
 * Convert an XLSX date value to ISO date string (YYYY-MM-DD), or null if empty.
 */
function toIsoDate(val: unknown): string | null {
  if (val == null) return null
  if (val instanceof Date) {
    return val.toISOString().split('T')[0]
  }
  if (typeof val === 'number') {
    // Excel date serial number
    const excelEpoch = new Date(1899, 11, 30)
    const d = new Date(excelEpoch.getTime() + val * 86400000)
    return d.toISOString().split('T')[0]
  }
  if (typeof val === 'string' && val.trim()) {
    const d = new Date(val.trim())
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
    return null
  }
  return null
}

function toStr(val: unknown): string {
  if (val == null) return ''
  return String(val).trim()
}

function toNum(val: unknown): number {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const n = parseFloat(val.replace(/,/g, '').trim())
    return isNaN(n) ? 0 : n
  }
  return 0
}

/**
 * Normalize order_item_id: strip "OI:" prefix if present.
 */
function normalizeOrderItemId(raw: string): string {
  return raw.replace(/^OI:/i, '').trim()
}

/**
 * Normalize SKU: strip "SKU:" prefix and surrounding quotes.
 * E.g. '"SKU:KIDS GAMEPAD"' → 'KIDS GAMEPAD'
 */
function normalizeSku(raw: string): string {
  let s = raw.trim()
  // Strip surrounding quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim()
  }
  // Strip "SKU:" prefix (case-insensitive)
  s = s.replace(/^SKU:/i, '').trim()
  return s
}

/**
 * Parse a Flipkart Orders Report XLSX.
 * Reads "All-Orders" sheet (or first sheet). Row 0 = headers, data from row 1.
 */
export async function parseOrdersReport(buffer: ArrayBuffer): Promise<ParsedOrderRow[]> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })

  const sheetName =
    workbook.SheetNames.find((n) => {
      const norm = n.toLowerCase().replace(/[^a-z]/g, '')
      return norm === 'allorders' || norm === 'orders'
    }) ?? workbook.SheetNames[0]

  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error('No sheet found in workbook')

  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  })

  if (raw.length < 2) throw new Error('Sheet has fewer than 2 rows (need header + data)')

  // Row 0 = headers
  const headerRow = raw[0].map((c) => toStr(c).toLowerCase().trim())

  // Build column index map
  const colMap: Record<string, number> = {}

  for (const def of COLUMN_DEFS) {
    const searchLower = def.search.toLowerCase()
    for (let ci = 0; ci < headerRow.length; ci++) {
      // Exact match or contains
      if (headerRow[ci] === searchLower || headerRow[ci].includes(searchLower)) {
        colMap[def.field] = ci
        break
      }
    }
  }

  // Validate required columns
  const missingCols = REQUIRED_FIELDS.filter((f) => colMap[f] === undefined)
  if (missingCols.length > 0) {
    throw new Error(`Missing required columns: ${missingCols.join(', ')}`)
  }

  const get = (row: unknown[], field: string): unknown => {
    const ci = colMap[field]
    if (ci === undefined) return undefined
    return row[ci]
  }

  const results: ParsedOrderRow[] = []

  for (let ri = 1; ri < raw.length; ri++) {
    const row = raw[ri]
    const errors: string[] = []

    const rawOrderId = toStr(get(row, 'platformOrderId'))
    if (!rawOrderId) continue // skip empty rows

    const rawOrderItemId = toStr(get(row, 'orderItemId'))
    if (!rawOrderItemId) errors.push('Missing order item ID')

    const orderDate = toIsoDate(get(row, 'orderDate'))
    if (!orderDate) errors.push('Missing order date')

    const rawSku = toStr(get(row, 'skuName'))
    if (!rawSku) errors.push('Missing SKU')

    const rawStatus = toStr(get(row, 'orderStatus')).toUpperCase().replace(/\s+/g, '_')
    const orderStatus = STATUS_MAP[rawStatus]
    if (!orderStatus) errors.push(`Unknown status: ${rawStatus}`)

    const parsed: ParsedOrderRow = {
      rowIndex: ri,
      platformOrderId: rawOrderId,
      orderItemId: normalizeOrderItemId(rawOrderItemId),
      orderDate: orderDate ?? '',
      orderStatus: orderStatus ?? 'pending',
      skuName: normalizeSku(rawSku),
      quantity: toNum(get(row, 'quantity')) || 1,
      fulfillmentType: toStr(get(row, 'fulfillmentType')),
      dispatchDate: toIsoDate(get(row, 'dispatchDate')),
      deliveryDate: toIsoDate(get(row, 'deliveryDate')),
      cancellationDate: toIsoDate(get(row, 'cancellationDate')),
      cancellationReason: toStr(get(row, 'cancellationReason')) || null,
      returnRequestDate: toIsoDate(get(row, 'returnRequestDate')),
      error: errors.length > 0 ? errors.join('; ') : undefined,
    }

    results.push(parsed)
  }

  return results
}
