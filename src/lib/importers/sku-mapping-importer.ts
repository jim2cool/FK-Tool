import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/client'

// ── Fixed column names ────────────────────────────────────────────────────────

export const COL_MASTER   = 'Master Product/SKU'
export const COL_VARIANT  = 'Variant Name'
export const COL_CHANNEL  = 'Channel'
export const COL_ACCOUNT  = 'Account'
export const COL_SKU_ID   = 'SKU ID'

export const REQUIRED_COLUMNS = [COL_MASTER, COL_CHANNEL, COL_ACCOUNT, COL_SKU_ID] as const

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedRow {
  rowIndex: number   // 1-based spreadsheet row (header = 1, first data row = 2)
  master: string
  variant: string    // empty string if not provided
  channel: string
  account: string
  skuId: string
  error?: string     // present when row is invalid
}

export interface ImportResult {
  created: number
  updated: number
  skipped: number
  errors: Array<{ row: number; reason: string }>
}

// ── CLIENT-SIDE parse ─────────────────────────────────────────────────────────

export function parseCatalogCsv(csvText: string): ParsedRow[] {
  const { data } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  })

  const rows: ParsedRow[] = []

  for (let i = 0; i < data.length; i++) {
    const raw = data[i]
    const rowIndex = i + 2 // header is row 1, first data row is row 2

    // Silently skip comment rows (first value starts with '#')
    const firstValue = Object.values(raw)[0] ?? ''
    if (firstValue.startsWith('#')) continue

    const master  = raw[COL_MASTER]  ?? ''
    const variant = raw[COL_VARIANT] ?? ''
    const channel = raw[COL_CHANNEL] ?? ''
    const account = raw[COL_ACCOUNT] ?? ''
    const skuId   = raw[COL_SKU_ID]  ?? ''

    // Validate required fields
    const missing: string[] = []
    if (!master)  missing.push(COL_MASTER)
    if (!channel) missing.push(COL_CHANNEL)
    if (!account) missing.push(COL_ACCOUNT)
    if (!skuId)   missing.push(COL_SKU_ID)

    if (missing.length > 0) {
      rows.push({
        rowIndex,
        master,
        variant,
        channel,
        account,
        skuId,
        error: `Missing required fields: ${missing.join(', ')}`,
      })
      continue
    }

    rows.push({ rowIndex, master, variant, channel, account, skuId })
  }

  return rows
}

// ── SERVER-SIDE import ────────────────────────────────────────────────────────

export async function importCatalogCsv(
  csvText: string,
  tenantId: string
): Promise<ImportResult> {
  const supabase = createClient()

  // Load all marketplace accounts for this tenant
  const { data: accounts, error: accountsErr } = await supabase
    .from('marketplace_accounts')
    .select('id, platform, account_name')
    .eq('tenant_id', tenantId)

  if (accountsErr) {
    return {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [{ row: 0, reason: `Failed to load accounts: ${accountsErr.message}` }],
    }
  }

  // Build lookup map: "platform_lowercase|account_name_lowercase" → { id, platform }
  const accountMap = new Map<string, { id: string; platform: string }>()
  for (const acct of accounts ?? []) {
    const key = `${acct.platform.toLowerCase()}|${acct.account_name.toLowerCase()}`
    accountMap.set(key, { id: acct.id, platform: acct.platform })
  }

  const rows = parseCatalogCsv(csvText)

  let created = 0
  let updated = 0
  let skipped = 0
  const errors: ImportResult['errors'] = []

  for (const row of rows) {
    // Skip rows that failed parse validation
    if (row.error) {
      skipped++
      errors.push({ row: row.rowIndex, reason: row.error })
      continue
    }

    // Validate channel / account pair
    const accountKey = `${row.channel.toLowerCase()}|${row.account.toLowerCase()}`
    const accountEntry = accountMap.get(accountKey)
    if (!accountEntry) {
      skipped++
      errors.push({
        row: row.rowIndex,
        reason: `'${row.channel} / ${row.account}' not found in Settings`,
      })
      continue
    }

    const { id: marketplaceAccountId, platform } = accountEntry

    // ── Upsert master_sku ──────────────────────────────────────────────────
    let masterSkuId: string

    if (row.variant) {
      // Has a variant: upsert parent first, then upsert variant under it
      const { data: existingParent } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', row.master)
        .is('parent_id', null)
        .maybeSingle()

      let parentId: string

      if (existingParent) {
        parentId = existingParent.id
      } else {
        const { data: newParent, error: parentErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: row.master })
          .select('id')
          .single()

        if (parentErr || !newParent) {
          skipped++
          errors.push({
            row: row.rowIndex,
            reason: `Failed to create parent "${row.master}": ${parentErr?.message ?? 'unknown error'}`,
          })
          continue
        }
        parentId = newParent.id
      }

      // Upsert variant
      const { data: existingVariant } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', row.variant)
        .eq('parent_id', parentId)
        .maybeSingle()

      if (existingVariant) {
        masterSkuId = existingVariant.id
      } else {
        const { data: newVariant, error: variantErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: row.variant, parent_id: parentId })
          .select('id')
          .single()

        if (variantErr || !newVariant) {
          skipped++
          errors.push({
            row: row.rowIndex,
            reason: `Failed to create variant "${row.variant}": ${variantErr?.message ?? 'unknown error'}`,
          })
          continue
        }
        masterSkuId = newVariant.id
      }
    } else {
      // Flat master SKU (no variant)
      const { data: existingMaster } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', row.master)
        .is('parent_id', null)
        .maybeSingle()

      if (existingMaster) {
        masterSkuId = existingMaster.id
      } else {
        const { data: newMaster, error: masterErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: row.master })
          .select('id')
          .single()

        if (masterErr || !newMaster) {
          skipped++
          errors.push({
            row: row.rowIndex,
            reason: `Failed to create master SKU "${row.master}": ${masterErr?.message ?? 'unknown error'}`,
          })
          continue
        }
        masterSkuId = newMaster.id
      }
    }

    // ── Upsert sku_mapping ─────────────────────────────────────────────────
    const { data: existingMapping } = await supabase
      .from('sku_mappings')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('platform', platform)
      .eq('platform_sku', row.skuId)
      .maybeSingle()

    if (existingMapping) {
      const { error: updateErr } = await supabase
        .from('sku_mappings')
        .update({ master_sku_id: masterSkuId, marketplace_account_id: marketplaceAccountId })
        .eq('id', existingMapping.id)

      if (updateErr) {
        skipped++
        errors.push({ row: row.rowIndex, reason: `Mapping update failed: ${updateErr.message}` })
        continue
      }
      updated++
    } else {
      const { error: insertErr } = await supabase
        .from('sku_mappings')
        .insert({
          tenant_id: tenantId,
          master_sku_id: masterSkuId,
          platform,
          platform_sku: row.skuId,
          marketplace_account_id: marketplaceAccountId,
        })

      if (insertErr) {
        skipped++
        errors.push({ row: row.rowIndex, reason: `Mapping insert failed: ${insertErr.message}` })
        continue
      }
      created++
    }
  }

  return { created, updated, skipped, errors }
}
