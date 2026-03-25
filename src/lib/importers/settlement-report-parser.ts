/**
 * Client-safe parser for Flipkart Settlement Report XLSX.
 * Reads the "Orders" sheet which has 2-row headers.
 * Dynamically imports `xlsx` to avoid SSR issues.
 */

export interface ParsedSettlementRow {
  rowIndex: number
  neftId: string           // col 0 or header "NEFT ID"
  paymentDate: string      // col 2 or header "Payment Date"
  bankSettlementValue: number // col 3 or header "Bank Settlement Value"
  platformOrderId: string  // col 7 or header "Order ID"
  orderItemId: string      // col 8 or header "Order Item ID"
  saleAmount: number       // col 9 or header "Sale Amount"
  sellerSku: string        // col 58 or header "Seller SKU"
  dispatchDate: string     // col 56 or header "Dispatch Date"
  returnType: string       // col 62 or header "Return Type"
  error?: string
}

// Column header search text -> field name
const COLUMN_DEFS: Array<{
  search: string
  field: keyof ParsedSettlementRow
  preferRow: 0 | 1 | null
}> = [
  { search: 'neft id', field: 'neftId', preferRow: null },
  { search: 'payment date', field: 'paymentDate', preferRow: null },
  { search: 'bank settlement value', field: 'bankSettlementValue', preferRow: null },
  { search: 'order id', field: 'platformOrderId', preferRow: null },
  { search: 'order item id', field: 'orderItemId', preferRow: null },
  { search: 'sale amount', field: 'saleAmount', preferRow: 1 },
  { search: 'seller sku', field: 'sellerSku', preferRow: null },
  { search: 'dispatch date', field: 'dispatchDate', preferRow: null },
  { search: 'return type', field: 'returnType', preferRow: null },
]

const REQUIRED_FIELDS: Array<keyof ParsedSettlementRow> = [
  'platformOrderId',
  'orderItemId',
]

/**
 * Convert an XLSX date value to ISO date string (YYYY-MM-DD).
 */
function toIsoDate(val: unknown): string {
  if (val instanceof Date) {
    return val.toISOString().split('T')[0]
  }
  if (typeof val === 'number') {
    const excelEpoch = new Date(1899, 11, 30)
    const d = new Date(excelEpoch.getTime() + val * 86400000)
    return d.toISOString().split('T')[0]
  }
  if (typeof val === 'string' && val.trim()) {
    const d = new Date(val.trim())
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
    return val.trim()
  }
  return ''
}

function toNum(val: unknown): number {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const n = parseFloat(val.replace(/,/g, '').trim())
    return isNaN(n) ? 0 : n
  }
  return 0
}

function toStr(val: unknown): string {
  if (val == null) return ''
  return String(val).trim()
}

/**
 * Parse a Flipkart Settlement Report XLSX workbook.
 * Reads the "Orders" sheet. Row 0 = group headers, Row 1 = sub-headers.
 * Data starts at row 2.
 */
export async function parseSettlementXlsx(buffer: ArrayBuffer): Promise<ParsedSettlementRow[]> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })

  const sheetName =
    workbook.SheetNames.find(
      (n) => n.toLowerCase().replace(/[^a-z]/g, '') === 'orders'
    ) ?? workbook.SheetNames[0]

  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error('No sheet found in workbook')

  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  })

  if (raw.length < 3) throw new Error('Sheet has fewer than 3 rows (need header rows + data)')

  const row0 = raw[0].map((c) => toStr(c).toLowerCase().trim())
  const row1 = raw[1].map((c) => toStr(c).toLowerCase().trim())

  // Build column index map
  const colMap: Partial<Record<keyof ParsedSettlementRow, number>> = {}

  for (const def of COLUMN_DEFS) {
    const searchLower = def.search.toLowerCase()
    let found = false

    const rowsToSearch =
      def.preferRow === 1 ? [row1, row0] : [row0, row1]

    for (const row of rowsToSearch) {
      for (let ci = 0; ci < row.length; ci++) {
        if (row[ci].includes(searchLower)) {
          const alreadyClaimed = Object.values(colMap).includes(ci)
          if (alreadyClaimed) continue

          colMap[def.field] = ci
          found = true
          break
        }
      }
      if (found) break
    }
  }

  // Validate required columns
  const missingCols = REQUIRED_FIELDS.filter((f) => colMap[f] === undefined)
  if (missingCols.length > 0) {
    throw new Error(`Missing required columns: ${missingCols.join(', ')}`)
  }

  const get = (row: unknown[], field: keyof ParsedSettlementRow): unknown => {
    const ci = colMap[field]
    if (ci === undefined) return undefined
    return row[ci]
  }

  const results: ParsedSettlementRow[] = []

  for (let ri = 2; ri < raw.length; ri++) {
    const row = raw[ri]
    // Skip empty rows
    const orderId = toStr(get(row, 'platformOrderId'))
    if (!orderId) continue

    const errors: string[] = []

    let orderItemId = toStr(get(row, 'orderItemId'))
    if (!orderItemId) errors.push('Missing order item ID')
    // Strip OI: prefix if present
    if (orderItemId.startsWith('OI:')) {
      orderItemId = orderItemId.slice(3).trim()
    }

    const parsed: ParsedSettlementRow = {
      rowIndex: ri,
      neftId: toStr(get(row, 'neftId')),
      paymentDate: toIsoDate(get(row, 'paymentDate')),
      bankSettlementValue: toNum(get(row, 'bankSettlementValue')),
      platformOrderId: orderId,
      orderItemId,
      saleAmount: toNum(get(row, 'saleAmount')),
      sellerSku: toStr(get(row, 'sellerSku')),
      dispatchDate: toIsoDate(get(row, 'dispatchDate')),
      returnType: toStr(get(row, 'returnType')),
      error: errors.length > 0 ? errors.join('; ') : undefined,
    }

    results.push(parsed)
  }

  return results
}
