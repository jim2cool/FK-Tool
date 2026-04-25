import * as XLSX from 'xlsx'
import type { ParsedOrder, ParsedListing, ParsedCogs, ParsedPnlHistory } from './types'

// Convert Excel serial date or string to "YYYY-MM-DD"
function toDate(v: unknown): string | null {
  if (!v && v !== 0) return null
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(v).trim()
  if (!s) return null
  // "YYYY-MM-DD HH:MM:SS" → strip time
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  // DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  return null
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function stripSku(v: unknown): string {
  // Flipkart Orders export wraps SKUs as """SKU:value""" — strip all leading/trailing quotes then the prefix
  return String(v ?? '').replace(/^["']+|["']+$/g, '').replace(/^SKU:/i, '').trim()
}

// Read a file (CSV or XLSX) as a 2D array of raw cell values.
// sheetName: preferred sheet to read; falls back to first sheet if not found.
function fileToRows(file: File, sheetName?: string): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target!.result, { type: 'array', cellDates: false })
        const wsName = sheetName && wb.SheetNames.includes(sheetName)
          ? sheetName
          : wb.SheetNames[0]
        const ws = wb.Sheets[wsName]
        resolve(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true }))
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// Find a column index by searching for a substring in a header row (case-insensitive)
function findCol(headerRow: unknown[], ...needles: string[]): number {
  for (const needle of needles) {
    const idx = headerRow.findIndex(
      h => typeof h === 'string' && h.toLowerCase().includes(needle.toLowerCase())
    )
    if (idx >= 0) return idx
  }
  return -1
}

// ──────────────────────────────────────────────
// A. Orders
// ──────────────────────────────────────────────
export async function parseOrdersFile(file: File): Promise<ParsedOrder[]> {
  // Flipkart order export has two sheets: "Help" and "Orders" — read the correct one
  const rows = await fileToRows(file, 'Orders')
  if (rows.length < 2) return []

  const header = rows[0]
  const colId       = findCol(header, 'order_item_id', 'order item id')
  const colOrderId  = findCol(header, 'order_id', 'order id')
  const colSku      = findCol(header, 'sku')
  const colQty      = findCol(header, 'quantity')
  const colDisp     = findCol(header, 'dispatched_date', 'dispatched date', 'dispatched on')
  const colTracking = findCol(header, 'delivery_tracking_id', 'delivery tracking')
  const colStatus   = findCol(header, 'order_item_status', 'order item status')

  if (colId < 0 || colSku < 0 || colStatus < 0) {
    return [{ order_item_id: '', order_id: '', sku: '', quantity: 1,
      dispatched_date: null, delivery_tracking_id: '', order_item_status: '', _row: 0,
      error: 'Missing required columns: order_item_id, sku, order_item_status' }]
  }

  return rows.slice(1).flatMap((row, i): ParsedOrder[] => {
    const order_item_id = String(row[colId] ?? '').trim()
    if (!order_item_id) return []
    return [{
      order_item_id,
      order_id: String(row[colOrderId >= 0 ? colOrderId : 0] ?? '').trim(),
      sku: stripSku(row[colSku]),
      quantity: colQty >= 0 ? Math.max(1, toNum(row[colQty])) : 1,
      dispatched_date: colDisp >= 0 ? toDate(row[colDisp]) : null,
      delivery_tracking_id: colTracking >= 0 ? String(row[colTracking] ?? '').trim() : '',
      order_item_status: String(row[colStatus] ?? '').trim(),
      _row: i + 2,
    }]
  })
}

// ──────────────────────────────────────────────
// B. Listing  (Row 0 = headers, Row 1 = descriptions, Row 2+ = data)
// ──────────────────────────────────────────────
export async function parseListingFile(file: File): Promise<ParsedListing[]> {
  const rows = await fileToRows(file)
  if (rows.length < 3) return []

  const header    = rows[0]
  const colSku    = findCol(header, 'seller sku id', 'seller_sku_id')
  const colMrp    = findCol(header, 'mrp')
  const colBank   = findCol(header, 'bank settlement')
  const colSell   = findCol(header, 'your selling price', 'selling price')
  const colBench  = findCol(header, 'benchmark price')

  if (colSku < 0) {
    return [{ seller_sku_id: '', mrp: null, bank_settlement: null,
      selling_price: null, benchmark_price: null, _row: 0,
      error: 'Column "Seller SKU Id" not found' }]
  }

  return rows.slice(2).flatMap((row, i): ParsedListing[] => {
    const seller_sku_id = stripSku(row[colSku])
    if (!seller_sku_id) return []
    return [{
      seller_sku_id,
      mrp:             colMrp   >= 0 ? (toNum(row[colMrp])   || null) : null,
      bank_settlement: colBank  >= 0 ? (toNum(row[colBank])  || null) : null,
      selling_price:   colSell  >= 0 ? (toNum(row[colSell])  || null) : null,
      benchmark_price: colBench >= 0 ? (toNum(row[colBench]) || null) : null,
      _row: i + 3,
    }]
  })
}

// ──────────────────────────────────────────────
// C. COGS  (columns: Account?, SKU, Master Product, COGS)
// ──────────────────────────────────────────────
export async function parseCogsFile(file: File): Promise<ParsedCogs[]> {
  const rows = await fileToRows(file)
  if (rows.length < 2) return []

  const header   = rows[0]
  const colSku   = findCol(header, 'sku')
  const colMstr  = findCol(header, 'master product', 'master')
  const colCogs  = findCol(header, 'cogs')

  if (colSku < 0 || colMstr < 0 || colCogs < 0) {
    return [{ sku: '', master_product: '', cogs: 0, _row: 0,
      error: 'Required columns missing: SKU, Master Product, COGS' }]
  }

  return rows.slice(1).flatMap((row, i): ParsedCogs[] => {
    const sku            = stripSku(row[colSku])
    const master_product = String(row[colMstr] ?? '').trim()
    if (!sku || !master_product) return []
    return [{ sku, master_product, cogs: toNum(row[colCogs]), _row: i + 2 }]
  })
}

// ──────────────────────────────────────────────
// D. P&L History  (2-row header: row 0 = main, row 1 = breakup sub-headers, row 2+ = data)
// ──────────────────────────────────────────────
export async function parsePnlHistoryFile(file: File): Promise<ParsedPnlHistory[]> {
  // Flipkart P&L report has multiple sheets — "Orders P&L" is the order-level detail
  const rows = await fileToRows(file, 'Orders P&L')
  if (rows.length < 3) return []

  const mainHdr = rows[0]
  const subHdr  = rows[1]

  const colDate    = findCol(mainHdr, 'order date')
  const colId      = findCol(mainHdr, 'order item id')
  const colSku     = findCol(mainHdr, 'sku name')
  const colStatus  = findCol(mainHdr, 'order status')
  const colGross   = findCol(mainHdr, 'gross units')
  const colExpense = findCol(mainHdr, 'total expenses')

  // RTO/RVP/Cancelled appear in the sub-header row (breakup columns)
  const colRto      = findCol(subHdr, 'rto', 'logistics return')
  const colRvp      = findCol(subHdr, 'rvp', 'customer return')
  const colCancelled = findCol(subHdr, 'cancelled units', 'cancelled')

  if (colDate < 0 || colId < 0 || colGross < 0) {
    return [{ order_date: null, order_item_id: '', sku_name: '', order_status: '',
      gross_units: 0, rto_units: 0, rvp_units: 0, cancelled_units: 0,
      total_expenses: 0, _row: 0,
      error: 'P&L History: missing required columns (Order Date, Order Item ID, Gross Units)' }]
  }

  return rows.slice(2).flatMap((row, i): ParsedPnlHistory[] => {
    const order_item_id = String(row[colId] ?? '').trim()
    if (!order_item_id) return []
    return [{
      order_date:      toDate(row[colDate]),
      order_item_id,
      sku_name:        colSku    >= 0 ? stripSku(row[colSku])                  : '',
      order_status:    colStatus >= 0 ? String(row[colStatus] ?? '').trim()    : '',
      gross_units:     toNum(row[colGross]),
      rto_units:       colRto       >= 0 ? toNum(row[colRto])       : 0,
      rvp_units:       colRvp       >= 0 ? toNum(row[colRvp])       : 0,
      cancelled_units: colCancelled >= 0 ? toNum(row[colCancelled]) : 0,
      total_expenses:  colExpense   >= 0 ? toNum(row[colExpense])   : 0,
      _row: i + 3,
    }]
  })
}
