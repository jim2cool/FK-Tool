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

function stripLabelsRow(csv: string): { text: string; rowOffset: number } {
  // The template's first row is a labels row ("Mandatory, Optional, …").
  // Papa.parse(header:true) would consume it as column keys, breaking all lookups.
  // Strip it so Papa uses the real header row (Receipt Date, Master Product, …).
  const lines = csv.split(/\r?\n/)
  if (lines.length > 0) {
    const first = lines[0].trim()
    if (first.startsWith('Mandatory') || first.startsWith('Optional')) {
      return { text: lines.slice(1).join('\n'), rowOffset: 3 }
    }
  }
  return { text: csv, rowOffset: 2 }
}

export function parsePurchasesCsv(csvText: string): ParsedPurchaseRow[] {
  const { text, rowOffset } = stripLabelsRow(csvText)
  const { data } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  })

  const rows: ParsedPurchaseRow[] = []

  for (let i = 0; i < data.length; i++) {
    const raw = data[i]
    const rowIndex = i + rowOffset // 1-based line number in original file

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

    // Parse date: supports DD/MM/YYYY, M/DD/YYYY, and YYYY-MM-DD.
    // Auto-detect: if parts[1] > 12 it can't be a month → first part is month (M/DD/YYYY).
    //              otherwise assume DD/MM/YYYY as Indian standard.
    let date = dateRaw
    if (dateRaw.includes('/')) {
      const parts = dateRaw.split('/')
      if (parts.length === 3) {
        const p1 = parseInt(parts[1], 10)
        let day: string, month: string
        if (p1 > 12) {
          // M/DD/YYYY  (e.g. 6/27/2025)
          month = parts[0]; day = parts[1]
        } else {
          // DD/MM/YYYY (e.g. 27/06/2025) — Indian standard
          day = parts[0]; month = parts[1]
        }
        date = `${parts[2]}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
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
