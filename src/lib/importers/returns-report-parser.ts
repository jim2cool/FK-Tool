/**
 * Client-safe parser for Flipkart Returns Report XLSX.
 * Dynamically imports `xlsx` to avoid SSR issues.
 */

export interface ParsedReturnRow {
  rowIndex: number
  platformOrderId: string
  orderItemId: string
  returnType: 'rto' | 'rvp'
  returnRequestDate: string | null
  returnCompleteDate: string | null
  returnStatus: string
  completionStatus: string
  returnReason: string | null
  returnSubReason: string | null
  skuName: string
  totalPrice: number
  quantity: number
  error?: string
}

const RETURN_TYPE_MAP: Record<string, 'rto' | 'rvp'> = {
  courier_return: 'rto',
  customer_return: 'rvp',
}

// Column header search text -> field name
const COLUMN_DEFS: Array<{ search: string; field: keyof ParsedReturnRow }> = [
  { search: 'order id', field: 'platformOrderId' },
  { search: 'order item id', field: 'orderItemId' },
  { search: 'return type', field: 'returnType' },
  { search: 'return requested date', field: 'returnRequestDate' },
  { search: 'completed date', field: 'returnCompleteDate' },
  { search: 'return status', field: 'returnStatus' },
  { search: 'completion status', field: 'completionStatus' },
  { search: 'return reason', field: 'returnReason' },
  { search: 'return sub-reason', field: 'returnSubReason' },
  { search: 'sku', field: 'skuName' },
  { search: 'total price', field: 'totalPrice' },
  { search: 'quantity', field: 'quantity' },
]

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
 * Convert an XLSX date value to ISO date string (YYYY-MM-DD).
 * Returns null if value is empty/invalid.
 */
function toIsoDate(val: unknown): string | null {
  if (val instanceof Date) {
    return val.toISOString().split('T')[0]
  }
  if (typeof val === 'number') {
    // Excel date serial: days since 1900-01-01 (with the 1900 leap year bug)
    const excelEpoch = new Date(1899, 11, 30) // Dec 30, 1899
    const d = new Date(excelEpoch.getTime() + val * 86400000)
    return d.toISOString().split('T')[0]
  }
  if (typeof val === 'string' && val.trim()) {
    const d = new Date(val.trim())
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  }
  return null
}

/**
 * Parse a Flipkart Returns Report XLSX workbook.
 * Row 0 = headers, data from row 1.
 */
export async function parseReturnsReport(
  buffer: ArrayBuffer,
): Promise<ParsedReturnRow[]> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })

  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('No sheet found in workbook')

  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  })

  if (raw.length < 2)
    throw new Error('Sheet has fewer than 2 rows (need header + data)')

  const headerRow = raw[0].map((c) => toStr(c).toLowerCase().trim())

  // Build column index map
  const colMap: Partial<Record<keyof ParsedReturnRow, number>> = {}

  for (const def of COLUMN_DEFS) {
    for (let ci = 0; ci < headerRow.length; ci++) {
      if (headerRow[ci].includes(def.search)) {
        colMap[def.field] = ci
        break
      }
    }
  }

  // Validate required columns
  const requiredCols: Array<keyof ParsedReturnRow> = [
    'platformOrderId',
    'returnType',
  ]
  const missingCols = requiredCols.filter((f) => colMap[f] === undefined)
  if (missingCols.length > 0) {
    throw new Error(`Missing required columns: ${missingCols.join(', ')}`)
  }

  const get = (row: unknown[], field: keyof ParsedReturnRow): unknown => {
    const ci = colMap[field]
    if (ci === undefined) return undefined
    return row[ci]
  }

  const results: ParsedReturnRow[] = []

  for (let ri = 1; ri < raw.length; ri++) {
    const row = raw[ri]
    const errors: string[] = []

    const orderId = toStr(get(row, 'platformOrderId'))
    if (!orderId) continue // skip empty rows

    const rawReturnType = toStr(get(row, 'returnType')).toLowerCase()
    const returnType = RETURN_TYPE_MAP[rawReturnType]
    if (!returnType) {
      errors.push(`Unknown return type: ${rawReturnType}`)
    }

    const orderItemId = toStr(get(row, 'orderItemId'))

    const parsed: ParsedReturnRow = {
      rowIndex: ri,
      platformOrderId: orderId,
      orderItemId,
      returnType: returnType ?? 'rto',
      returnRequestDate: toIsoDate(get(row, 'returnRequestDate')),
      returnCompleteDate: toIsoDate(get(row, 'returnCompleteDate')),
      returnStatus: toStr(get(row, 'returnStatus')),
      completionStatus: toStr(get(row, 'completionStatus')),
      returnReason: toStr(get(row, 'returnReason')) || null,
      returnSubReason: toStr(get(row, 'returnSubReason')) || null,
      skuName: toStr(get(row, 'skuName')),
      totalPrice: toNum(get(row, 'totalPrice')),
      quantity: toNum(get(row, 'quantity')),
      error: errors.length > 0 ? errors.join('; ') : undefined,
    }

    results.push(parsed)
  }

  return results
}
