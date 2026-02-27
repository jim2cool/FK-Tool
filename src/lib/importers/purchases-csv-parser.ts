/**
 * Client-safe purchases CSV parser.
 * Pure parse logic — no server imports, no next/headers.
 * Safe to import from client components.
 */
import Papa from 'papaparse'

// ── Fixed column names (must match template exactly) ──────────────────────────

const COL_DATE      = 'Receipt Date'
const COL_MASTER    = 'Master Product'
const COL_VARIANT   = 'Variant'
const COL_QTY       = 'Qty.'
const COL_HSN       = 'HSN Code'
const COL_GST_RATE  = 'GST Rate Slab'
const COL_TAX_PAID  = 'Tax Paid (Y/N)'
const COL_RATE      = 'Rate Per Unit (without Taxes)'
const COL_VENDOR    = 'Vendor Name'
const COL_INVOICE   = 'Invoice Number (Optional)'
const COL_WAREHOUSE = 'Warehouse'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedPurchaseRow {
  rowIndex: number
  date: string
  master: string
  variant: string
  qty: number
  hsnCode: string
  gstRateSlab: string
  taxPaid: boolean
  ratePerUnit: number
  vendorName: string
  invoiceNumber: string
  warehouseName: string
  error?: string
}

export interface PurchaseImportResult {
  created: number
  skipped: number
  errors: Array<{ row: number; reason: string }>
}

// ── Parse ─────────────────────────────────────────────────────────────────────

export function parsePurchasesCsv(csvText: string): ParsedPurchaseRow[] {
  const { data } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  })

  const rows: ParsedPurchaseRow[] = []

  for (let i = 0; i < data.length; i++) {
    const raw = data[i]
    const rowIndex = i + 2 // header row = 1

    // Skip comment/reference rows and the labels row
    const firstVal = Object.values(raw)[0] ?? ''
    if (
      firstVal.startsWith('#') ||
      firstVal.startsWith('Mandatory') ||
      firstVal.startsWith('Optional')
    ) continue

    const master        = raw[COL_MASTER]    ?? ''
    const variant       = raw[COL_VARIANT]   ?? ''
    const dateRaw       = raw[COL_DATE]      ?? ''
    const qtyRaw        = raw[COL_QTY]       ?? ''
    const hsnCode       = raw[COL_HSN]       ?? ''
    const gstRateSlab   = raw[COL_GST_RATE]  ?? '18%'
    const taxPaidRaw    = (raw[COL_TAX_PAID] ?? '').toUpperCase()
    const rateRaw       = raw[COL_RATE]      ?? ''
    const vendorName    = raw[COL_VENDOR]    ?? ''
    const invoiceNumber = raw[COL_INVOICE]   ?? ''
    const warehouseName = raw[COL_WAREHOUSE] ?? ''

    // Validate mandatory fields
    const missing: string[] = []
    if (!master)        missing.push(COL_MASTER)
    if (!dateRaw)       missing.push(COL_DATE)
    if (!qtyRaw)        missing.push(COL_QTY)
    if (!rateRaw)       missing.push(COL_RATE)
    if (!warehouseName) missing.push(COL_WAREHOUSE)

    if (missing.length > 0) {
      rows.push({
        rowIndex, date: dateRaw, master, variant,
        qty: 0, hsnCode, gstRateSlab, taxPaid: false,
        ratePerUnit: 0, vendorName, invoiceNumber, warehouseName,
        error: `Missing: ${missing.join(', ')}`,
      })
      continue
    }

    const qty = parseInt(qtyRaw, 10)
    if (isNaN(qty) || qty <= 0) {
      rows.push({
        rowIndex, date: dateRaw, master, variant,
        qty: 0, hsnCode, gstRateSlab, taxPaid: false,
        ratePerUnit: 0, vendorName, invoiceNumber, warehouseName,
        error: `Qty. must be a positive number, got "${qtyRaw}"`,
      })
      continue
    }

    const ratePerUnit = parseFloat(rateRaw)
    if (isNaN(ratePerUnit) || ratePerUnit < 0) {
      rows.push({
        rowIndex, date: dateRaw, master, variant,
        qty, hsnCode, gstRateSlab, taxPaid: false,
        ratePerUnit: 0, vendorName, invoiceNumber, warehouseName,
        error: `Rate Per Unit must be a number, got "${rateRaw}"`,
      })
      continue
    }

    // Parse date: supports DD/MM/YYYY and YYYY-MM-DD
    let date = dateRaw
    if (dateRaw.includes('/')) {
      const parts = dateRaw.split('/')
      if (parts.length === 3) {
        // Assume DD/MM/YYYY per Indian standard
        date = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
      }
    }

    const taxPaid = taxPaidRaw === 'Y' || taxPaidRaw === 'YES'

    rows.push({
      rowIndex, date, master, variant, qty, hsnCode,
      gstRateSlab: gstRateSlab || '18%',
      taxPaid, ratePerUnit, vendorName, invoiceNumber, warehouseName,
    })
  }

  return rows
}
