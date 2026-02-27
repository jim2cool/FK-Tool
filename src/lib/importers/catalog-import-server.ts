/**
 * Server-only catalog importer.
 * Uses the server Supabase client (next/headers) — do NOT import this from client components.
 * The client-safe parser (parseCatalogCsv) stays in sku-mapping-importer.ts.
 */
import { createClient } from '@/lib/supabase/server'
import { parseCatalogCsv } from './sku-mapping-importer'
import type { ImportResult } from './sku-mapping-importer'

export async function importCatalogCsv(
  csvText: string,
  tenantId: string
): Promise<ImportResult> {
  const supabase = await createClient()

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
