import type { OrderStatus } from '@/types/database'

export interface ParsedPnlRow {
  rowIndex: number
  orderDate: string
  platformOrderId: string
  orderItemId: string
  skuName: string
  fulfillmentType: string
  channel: string
  paymentMode: string
  orderStatus: OrderStatus
  grossUnits: number
  rtoUnits: number
  rvpUnits: number
  cancelledUnits: number
  netUnits: number
  finalSellingPrice: number
  accountedNetSales: number
  saleAmount: number
  sellerOfferBurn: number
  totalExpenses: number
  commissionFee: number
  collectionFee: number
  fixedFee: number
  pickPackFee: number
  forwardShippingFee: number
  reverseShippingFee: number
  offerAdjustments: number
  taxGst: number
  taxTcs: number
  taxTds: number
  rewards: number
  spfPayout: number
  projectedSettlement: number
  amountSettled: number
  amountPending: number
  error?: string
}

// Flipkart status → internal OrderStatus
const STATUS_MAP: Record<string, OrderStatus> = {
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  RETURNED: 'returned',
  RETURN_REQUESTED: 'returned',
  RETURN_CANCELLED: 'delivered',
  IN_TRANSIT: 'dispatched',
}

// Column header patterns mapped to ParsedPnlRow keys
// Each entry: [searchText, fieldName, preferredRow]
// preferredRow: 0 = search row 0 first, 1 = search row 1 first, null = either
const COLUMN_DEFS: Array<{
  search: string
  field: keyof ParsedPnlRow
  preferRow: 0 | 1 | null
  firstOnly?: boolean
}> = [
  { search: 'order date', field: 'orderDate', preferRow: null },
  { search: 'order id', field: 'platformOrderId', preferRow: null },
  { search: 'order item id', field: 'orderItemId', preferRow: null },
  { search: 'sku name', field: 'skuName', preferRow: null },
  { search: 'fulfillment type', field: 'fulfillmentType', preferRow: null },
  { search: 'channel of sale', field: 'channel', preferRow: null },
  { search: 'mode of payment', field: 'paymentMode', preferRow: null },
  { search: 'order status', field: 'orderStatus', preferRow: null },
  { search: 'gross units', field: 'grossUnits', preferRow: null },
  { search: 'rto', field: 'rtoUnits', preferRow: 1 },
  { search: 'rvp', field: 'rvpUnits', preferRow: 1 },
  { search: 'cancelled units', field: 'cancelledUnits', preferRow: 1 },
  { search: 'net units', field: 'netUnits', preferRow: 0 },
  { search: 'final selling price', field: 'finalSellingPrice', preferRow: null },
  { search: 'accounted net sales', field: 'accountedNetSales', preferRow: 0, firstOnly: true },
  { search: 'sale amount', field: 'saleAmount', preferRow: 1 },
  { search: 'seller burn', field: 'sellerOfferBurn', preferRow: 1 },
  { search: 'total expenses', field: 'totalExpenses', preferRow: 0 },
  { search: 'commission fee', field: 'commissionFee', preferRow: 1 },
  { search: 'collection fee', field: 'collectionFee', preferRow: 1 },
  { search: 'fixed fee', field: 'fixedFee', preferRow: 1 },
  { search: 'pick and pack', field: 'pickPackFee', preferRow: 1 },
  { search: 'forward shipping', field: 'forwardShippingFee', preferRow: 1 },
  { search: 'reverse shipping', field: 'reverseShippingFee', preferRow: 1 },
  { search: 'offer adjustments', field: 'offerAdjustments', preferRow: 1 },
  { search: 'taxes (gst)', field: 'taxGst', preferRow: 1 },
  { search: 'taxes (tcs)', field: 'taxTcs', preferRow: 1 },
  { search: 'taxes (tds)', field: 'taxTds', preferRow: 1 },
  { search: 'rewards', field: 'rewards', preferRow: 1 },
  { search: 'spf payout', field: 'spfPayout', preferRow: 1 },
  { search: 'bank settlement', field: 'projectedSettlement', preferRow: 0, firstOnly: true },
  { search: 'amount settled', field: 'amountSettled', preferRow: 0 },
  { search: 'amount pending', field: 'amountPending', preferRow: 0 },
]

const REQUIRED_FIELDS: Array<keyof ParsedPnlRow> = [
  'orderDate',
  'platformOrderId',
  'orderItemId',
  'skuName',
  'orderStatus',
]

/**
 * Convert an XLSX date value to ISO date string (YYYY-MM-DD).
 * xlsx library may return JS Date objects, date serial numbers, or strings.
 */
function toIsoDate(val: unknown): string {
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
    // Try parsing as date string
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
 * Parse a Flipkart P&L XLSX workbook.
 * Reads the "Orders P&L" sheet. Row 0 = group headers, Row 1 = sub-headers.
 * Data starts at row 2.
 */
export async function parsePnlXlsx(buffer: ArrayBuffer): Promise<ParsedPnlRow[]> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })

  const sheetName =
    workbook.SheetNames.find(
      (n) => n.toLowerCase().replace(/[^a-z]/g, '') === 'orderspl'
    ) ?? workbook.SheetNames[0]

  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error('No sheet found in workbook')

  // Convert sheet to 2D array (raw values, preserve dates)
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    dateNF: 'yyyy-mm-dd',
  })

  if (raw.length < 3) throw new Error('Sheet has fewer than 3 rows (need header rows + data)')

  const row0 = raw[0].map((c) => toStr(c).toLowerCase().trim())
  const row1 = raw[1].map((c) => toStr(c).toLowerCase().trim())

  // Build column index map: field → column index
  const colMap: Partial<Record<keyof ParsedPnlRow, number>> = {}

  for (const def of COLUMN_DEFS) {
    const searchLower = def.search.toLowerCase()
    let found = false

    // Determine search order based on preferRow
    const rowsToSearch =
      def.preferRow === 1 ? [row1, row0] : [row0, row1]

    for (const row of rowsToSearch) {
      for (let ci = 0; ci < row.length; ci++) {
        if (row[ci].includes(searchLower)) {
          // Skip if this column is already claimed by another field
          const alreadyClaimed = Object.values(colMap).includes(ci)
          if (alreadyClaimed && !def.firstOnly) continue

          colMap[def.field] = ci
          found = true
          break
        }
      }
      if (found) break
    }
  }

  // Validate required columns exist
  const missingCols = REQUIRED_FIELDS.filter((f) => colMap[f] === undefined)
  if (missingCols.length > 0) {
    throw new Error(`Missing required columns: ${missingCols.join(', ')}`)
  }

  const get = (row: unknown[], field: keyof ParsedPnlRow): unknown => {
    const ci = colMap[field]
    if (ci === undefined) return undefined
    return row[ci]
  }

  const results: ParsedPnlRow[] = []

  for (let ri = 2; ri < raw.length; ri++) {
    const row = raw[ri]
    // Skip empty rows
    const orderId = toStr(get(row, 'platformOrderId'))
    if (!orderId) continue

    const errors: string[] = []

    const orderDate = toIsoDate(get(row, 'orderDate'))
    if (!orderDate) errors.push('Missing order date')

    const orderItemId = toStr(get(row, 'orderItemId'))
    if (!orderItemId) errors.push('Missing order item ID')

    const skuName = toStr(get(row, 'skuName'))
    if (!skuName) errors.push('Missing SKU name')

    const rawStatus = toStr(get(row, 'orderStatus')).toUpperCase().replace(/\s+/g, '_')
    const orderStatus = STATUS_MAP[rawStatus]
    if (!orderStatus) errors.push(`Unknown status: ${rawStatus}`)

    const parsed: ParsedPnlRow = {
      rowIndex: ri,
      orderDate,
      platformOrderId: orderId,
      orderItemId,
      skuName,
      fulfillmentType: toStr(get(row, 'fulfillmentType')),
      channel: toStr(get(row, 'channel')),
      paymentMode: toStr(get(row, 'paymentMode')),
      orderStatus: orderStatus ?? 'pending',
      grossUnits: toNum(get(row, 'grossUnits')),
      rtoUnits: toNum(get(row, 'rtoUnits')),
      rvpUnits: toNum(get(row, 'rvpUnits')),
      cancelledUnits: toNum(get(row, 'cancelledUnits')),
      netUnits: toNum(get(row, 'netUnits')),
      finalSellingPrice: toNum(get(row, 'finalSellingPrice')),
      accountedNetSales: toNum(get(row, 'accountedNetSales')),
      saleAmount: toNum(get(row, 'saleAmount')),
      sellerOfferBurn: toNum(get(row, 'sellerOfferBurn')),
      totalExpenses: toNum(get(row, 'totalExpenses')),
      commissionFee: toNum(get(row, 'commissionFee')),
      collectionFee: toNum(get(row, 'collectionFee')),
      fixedFee: toNum(get(row, 'fixedFee')),
      pickPackFee: toNum(get(row, 'pickPackFee')),
      forwardShippingFee: toNum(get(row, 'forwardShippingFee')),
      reverseShippingFee: toNum(get(row, 'reverseShippingFee')),
      offerAdjustments: toNum(get(row, 'offerAdjustments')),
      taxGst: toNum(get(row, 'taxGst')),
      taxTcs: toNum(get(row, 'taxTcs')),
      taxTds: toNum(get(row, 'taxTds')),
      rewards: toNum(get(row, 'rewards')),
      spfPayout: toNum(get(row, 'spfPayout')),
      projectedSettlement: toNum(get(row, 'projectedSettlement')),
      amountSettled: toNum(get(row, 'amountSettled')),
      amountPending: toNum(get(row, 'amountPending')),
      error: errors.length > 0 ? errors.join('; ') : undefined,
    }

    results.push(parsed)
  }

  return results
}
