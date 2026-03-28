/**
 * Server-only combo importer.
 * Uses the server Supabase client (next/headers) — do NOT import this from client components.
 * The client-safe parser stays in combo-csv-parser.ts.
 */
import { createClient } from '@/lib/supabase/server'
import { parseComboCsv, groupComboRows } from './combo-csv-parser'
import type { ComboImportResult } from './combo-csv-parser'

export async function importComboCsv(
  csvText: string,
  tenantId: string
): Promise<ComboImportResult> {
  const supabase = await createClient()

  // ── Phase 0: Pre-load reference data ────────────────────────────────────────

  // Load all master SKUs → Map<name_lowercase, id>
  const { data: masterSkus, error: skuErr } = await supabase
    .from('master_skus')
    .select('id, name')
    .eq('tenant_id', tenantId)

  if (skuErr) {
    return emptyResult(`Failed to load master SKUs: ${skuErr.message}`)
  }

  const skuMap = new Map<string, string>()
  for (const sku of masterSkus ?? []) {
    skuMap.set(sku.name.toLowerCase(), sku.id)
  }

  // Load all marketplace accounts → Map<"platform_lc|account_lc", { id, platform }>
  const { data: accounts, error: acctErr } = await supabase
    .from('marketplace_accounts')
    .select('id, platform, account_name')
    .eq('tenant_id', tenantId)

  if (acctErr) {
    return emptyResult(`Failed to load accounts: ${acctErr.message}`)
  }

  const accountMap = new Map<string, { id: string; platform: string }>()
  for (const acct of accounts ?? []) {
    const key = `${acct.platform.toLowerCase()}|${acct.account_name.toLowerCase()}`
    accountMap.set(key, { id: acct.id, platform: acct.platform })
  }

  // Load existing combos → Map<name_lowercase, id>
  const { data: existingCombos, error: comboErr } = await supabase
    .from('combo_products')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('is_archived', false)

  if (comboErr) {
    return emptyResult(`Failed to load existing combos: ${comboErr.message}`)
  }

  const comboMap = new Map<string, string>()
  for (const c of existingCombos ?? []) {
    comboMap.set(c.name.toLowerCase(), c.id)
  }

  // ── Phase 1: Parse + group ──────────────────────────────────────────────────

  const rows = parseComboCsv(csvText)
  const groups = groupComboRows(rows)

  let combosCreated = 0
  let combosSkipped = 0
  let componentsAdded = 0
  let mappingsCreated = 0
  let mappingsUpdated = 0
  const errors: ComboImportResult['errors'] = []

  // ── Phase 2: Process each combo group ───────────────────────────────────────

  for (const group of groups) {
    // Collect parse-level errors
    for (const e of group.errors) {
      errors.push({ row: e.rowIndex, reason: e.reason })
    }

    // Skip combo if it has no valid components
    if (group.components.length === 0) {
      continue
    }

    // ── a) Resolve or create combo ────────────────────────────────────────────
    let comboId: string
    const existingComboId = comboMap.get(group.comboName.toLowerCase())

    if (existingComboId) {
      comboId = existingComboId
      combosSkipped++
    } else {
      const { data: newCombo, error: createErr } = await supabase
        .from('combo_products')
        .insert({ tenant_id: tenantId, name: group.comboName })
        .select('id')
        .single()

      if (createErr || !newCombo) {
        errors.push({
          row: group.components[0].rowIndex,
          reason: `Failed to create combo "${group.comboName}": ${createErr?.message ?? 'unknown'}`,
        })
        continue
      }
      comboId = newCombo.id
      comboMap.set(group.comboName.toLowerCase(), comboId)
      combosCreated++
    }

    // ── b) Insert components ──────────────────────────────────────────────────

    // Load existing components for this combo to avoid duplicates
    const { data: existingComponents } = await supabase
      .from('combo_product_components')
      .select('master_sku_id')
      .eq('combo_product_id', comboId)

    const existingComponentIds = new Set(
      (existingComponents ?? []).map(c => c.master_sku_id)
    )

    for (const comp of group.components) {
      const skuId = skuMap.get(comp.sku.toLowerCase())
      if (!skuId) {
        errors.push({
          row: comp.rowIndex,
          reason: `Component SKU "${comp.sku}" not found in Master Catalog`,
        })
        continue
      }

      // Skip if this component already exists on the combo
      if (existingComponentIds.has(skuId)) {
        continue
      }

      const { error: compErr } = await supabase
        .from('combo_product_components')
        .insert({
          combo_product_id: comboId,
          master_sku_id: skuId,
          quantity: comp.quantity,
        })

      if (compErr) {
        errors.push({
          row: comp.rowIndex,
          reason: `Failed to add component "${comp.sku}": ${compErr.message}`,
        })
        continue
      }

      existingComponentIds.add(skuId)
      componentsAdded++
    }

    // ── c) Upsert mappings ────────────────────────────────────────────────────

    for (const mapping of group.mappings) {
      const accountKey = `${mapping.channel.toLowerCase()}|${mapping.account.toLowerCase()}`
      const accountEntry = accountMap.get(accountKey)

      if (!accountEntry) {
        errors.push({
          row: mapping.rowIndex,
          reason: `'${mapping.channel} / ${mapping.account}' not found in Settings`,
        })
        continue
      }

      const { id: marketplaceAccountId, platform } = accountEntry

      // Check if mapping already exists
      const { data: existingMapping } = await supabase
        .from('sku_mappings')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('platform', platform)
        .eq('platform_sku', mapping.platformSku)
        .maybeSingle()

      if (existingMapping) {
        const { error: updateErr } = await supabase
          .from('sku_mappings')
          .update({
            combo_product_id: comboId,
            master_sku_id: null,
            marketplace_account_id: marketplaceAccountId,
          })
          .eq('id', existingMapping.id)

        if (updateErr) {
          errors.push({ row: mapping.rowIndex, reason: `Mapping update failed: ${updateErr.message}` })
          continue
        }
        mappingsUpdated++
      } else {
        const { error: insertErr } = await supabase
          .from('sku_mappings')
          .insert({
            tenant_id: tenantId,
            combo_product_id: comboId,
            master_sku_id: null,
            platform,
            platform_sku: mapping.platformSku,
            marketplace_account_id: marketplaceAccountId,
          })

        if (insertErr) {
          errors.push({ row: mapping.rowIndex, reason: `Mapping insert failed: ${insertErr.message}` })
          continue
        }
        mappingsCreated++
      }
    }
  }

  return { combosCreated, combosSkipped, componentsAdded, mappingsCreated, mappingsUpdated, errors }
}

function emptyResult(errorMsg: string): ComboImportResult {
  return {
    combosCreated: 0,
    combosSkipped: 0,
    componentsAdded: 0,
    mappingsCreated: 0,
    mappingsUpdated: 0,
    errors: [{ row: 0, reason: errorMsg }],
  }
}
