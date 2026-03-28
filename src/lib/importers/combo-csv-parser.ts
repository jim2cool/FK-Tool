import Papa from 'papaparse'

// ── Fixed column names ────────────────────────────────────────────────────────

export const COL_COMBO_NAME    = 'Combo Name'
export const COL_COMPONENT_SKU = 'Component SKU'
export const COL_QTY           = 'Qty'
export const COL_CHANNEL       = 'Channel'
export const COL_ACCOUNT       = 'Account'
export const COL_PLATFORM_SKU  = 'Platform SKU'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedComboRow {
  rowIndex: number   // 1-based spreadsheet row (header = 1, first data row = 2)
  comboName: string
  componentSku: string
  quantity: number
  channel: string    // empty if no mapping on this row
  account: string
  platformSku: string
  error?: string
}

export interface ParsedComboGroup {
  comboName: string
  components: Array<{ sku: string; quantity: number; rowIndex: number }>
  mappings: Array<{ channel: string; account: string; platformSku: string; rowIndex: number }>
  errors: Array<{ rowIndex: number; reason: string }>
}

export interface ComboImportResult {
  combosCreated: number
  combosSkipped: number
  componentsAdded: number
  mappingsCreated: number
  mappingsUpdated: number
  errors: Array<{ row: number; reason: string }>
}

// ── CLIENT-SIDE parse (row-level) ─────────────────────────────────────────────

export function parseComboCsv(csvText: string): ParsedComboRow[] {
  const { data } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  })

  const rows: ParsedComboRow[] = []

  for (let i = 0; i < data.length; i++) {
    const raw = data[i]
    const rowIndex = i + 2 // header is row 1, first data row is row 2

    // Silently skip comment rows (first value starts with '#')
    const firstValue = Object.values(raw)[0] ?? ''
    if (firstValue.startsWith('#')) continue

    const comboName    = raw[COL_COMBO_NAME]    ?? ''
    const componentSku = raw[COL_COMPONENT_SKU] ?? ''
    const qtyStr       = raw[COL_QTY]           ?? ''
    const channel      = raw[COL_CHANNEL]       ?? ''
    const account      = raw[COL_ACCOUNT]       ?? ''
    const platformSku  = raw[COL_PLATFORM_SKU]  ?? ''

    // Validate required fields
    const missing: string[] = []
    if (!comboName)    missing.push(COL_COMBO_NAME)
    if (!componentSku) missing.push(COL_COMPONENT_SKU)

    if (missing.length > 0) {
      rows.push({
        rowIndex, comboName, componentSku, quantity: 0,
        channel, account, platformSku,
        error: `Missing required: ${missing.join(', ')}`,
      })
      continue
    }

    // Parse quantity (defaults to 1)
    let quantity = 1
    if (qtyStr) {
      const parsed = parseInt(qtyStr, 10)
      if (isNaN(parsed) || parsed < 1) {
        rows.push({
          rowIndex, comboName, componentSku, quantity: 0,
          channel, account, platformSku,
          error: `Qty must be a positive integer, got "${qtyStr}"`,
        })
        continue
      }
      quantity = parsed
    }

    // Validate mapping triplet: all-or-nothing
    const hasMapping = !!(channel || account || platformSku)
    if (hasMapping) {
      const mappingMissing: string[] = []
      if (!channel)     mappingMissing.push(COL_CHANNEL)
      if (!account)     mappingMissing.push(COL_ACCOUNT)
      if (!platformSku) mappingMissing.push(COL_PLATFORM_SKU)
      if (mappingMissing.length > 0) {
        rows.push({
          rowIndex, comboName, componentSku, quantity,
          channel, account, platformSku,
          error: `Partial mapping — also need: ${mappingMissing.join(', ')}`,
        })
        continue
      }
    }

    rows.push({ rowIndex, comboName, componentSku, quantity, channel, account, platformSku })
  }

  return rows
}

// ── Group rows by combo name ──────────────────────────────────────────────────

export function groupComboRows(rows: ParsedComboRow[]): ParsedComboGroup[] {
  const groupMap = new Map<string, ParsedComboGroup>()

  for (const row of rows) {
    const key = row.comboName.toLowerCase()

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        comboName: row.comboName, // preserve original casing from first occurrence
        components: [],
        mappings: [],
        errors: [],
      })
    }

    const group = groupMap.get(key)!

    // Collect errors
    if (row.error) {
      group.errors.push({ rowIndex: row.rowIndex, reason: row.error })
      continue
    }

    // Add component (check for duplicate SKU within this combo)
    const skuKey = row.componentSku.toLowerCase()
    const existingComponent = group.components.find(c => c.sku.toLowerCase() === skuKey)
    if (existingComponent) {
      group.errors.push({
        rowIndex: row.rowIndex,
        reason: `Duplicate component "${row.componentSku}" in combo "${row.comboName}" (already on row ${existingComponent.rowIndex})`,
      })
    } else {
      group.components.push({ sku: row.componentSku, quantity: row.quantity, rowIndex: row.rowIndex })
    }

    // Add mapping if present (dedup by channel+account+platformSku)
    if (row.channel && row.account && row.platformSku) {
      const mappingKey = `${row.channel.toLowerCase()}|${row.account.toLowerCase()}|${row.platformSku.toLowerCase()}`
      const alreadyMapped = group.mappings.some(m =>
        `${m.channel.toLowerCase()}|${m.account.toLowerCase()}|${m.platformSku.toLowerCase()}` === mappingKey
      )
      if (!alreadyMapped) {
        group.mappings.push({
          channel: row.channel,
          account: row.account,
          platformSku: row.platformSku,
          rowIndex: row.rowIndex,
        })
      }
    }
  }

  return Array.from(groupMap.values())
}
