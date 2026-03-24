import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

interface ResolveRequest {
  items: Array<{
    platformSku: string
    gstin: string
  }>
}

interface ComboComponentResult {
  masterSkuId: string
  masterSkuName: string
  quantity: number
}

interface ResolvedItem {
  platformSku: string
  masterSkuId: string | null
  masterSkuName: string | null
  marketplaceAccountId: string | null
  organizationId: string | null
  isCombo: boolean
  comboProductId: string | null
  comboProductName: string | null
  components: ComboComponentResult[] | null
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const body: ResolveRequest = await request.json()

    if (!body.items?.length) {
      return NextResponse.json({ error: 'items array is required' }, { status: 400 })
    }

    // Load all sku_mappings for this tenant (including combo_product_id)
    const { data: mappings, error: mappingError } = await supabase
      .from('sku_mappings')
      .select('platform_sku, master_sku_id, marketplace_account_id, combo_product_id')
      .eq('tenant_id', tenantId)

    if (mappingError) throw mappingError

    // Load master SKU names
    const { data: skus, error: skuError } = await supabase
      .from('master_skus')
      .select('id, name')
      .eq('tenant_id', tenantId)

    if (skuError) throw skuError
    const skuNameMap = new Map(skus?.map(s => [s.id, s.name]) ?? [])

    // Load marketplace accounts with org links
    const { data: accounts, error: accountError } = await supabase
      .from('marketplace_accounts')
      .select('id, organization_id')
      .eq('tenant_id', tenantId)

    if (accountError) throw accountError
    const accountOrgMap = new Map(accounts?.map(a => [a.id, a.organization_id]) ?? [])

    // Load organizations by GSTIN for org resolution
    const { data: orgs, error: orgError } = await supabase
      .from('organizations')
      .select('id, gst_number')
      .eq('tenant_id', tenantId)

    if (orgError) throw orgError
    const gstinOrgMap = new Map(
      orgs?.filter(o => o.gst_number).map(o => [o.gst_number!, o.id]) ?? []
    )

    // Identify combo mappings and load their components + combo names
    const comboMappings = (mappings ?? []).filter(m => m.combo_product_id)
    const comboIds = [...new Set(comboMappings.map(m => m.combo_product_id!))]

    let comboNameMap = new Map<string, string>()
    let comboComponentsMap = new Map<string, ComboComponentResult[]>()

    if (comboIds.length > 0) {
      // Load combo names
      const { data: combos, error: comboError } = await supabase
        .from('combo_products')
        .select('id, name')
        .in('id', comboIds)

      if (comboError) throw comboError
      comboNameMap = new Map(combos?.map(c => [c.id, c.name]) ?? [])

      // Load combo components
      const { data: components, error: compError } = await supabase
        .from('combo_product_components')
        .select('combo_product_id, master_sku_id, quantity')
        .in('combo_product_id', comboIds)

      if (compError) throw compError

      // Group components by combo_product_id
      for (const comp of components ?? []) {
        const existing = comboComponentsMap.get(comp.combo_product_id) ?? []
        existing.push({
          masterSkuId: comp.master_sku_id,
          masterSkuName: skuNameMap.get(comp.master_sku_id) ?? 'Unknown',
          quantity: comp.quantity,
        })
        comboComponentsMap.set(comp.combo_product_id, existing)
      }
    }

    // Build platform_sku → mapping lookup (case-insensitive)
    const skuLookup = new Map<string, {
      master_sku_id: string | null
      marketplace_account_id: string | null
      combo_product_id: string | null
    }>()
    for (const m of mappings ?? []) {
      skuLookup.set(m.platform_sku.toLowerCase(), {
        master_sku_id: m.master_sku_id,
        marketplace_account_id: m.marketplace_account_id,
        combo_product_id: m.combo_product_id,
      })
    }

    // Resolve each item
    const resolved: ResolvedItem[] = body.items.map(item => {
      const mapping = skuLookup.get(item.platformSku.toLowerCase())
      const orgId = gstinOrgMap.get(item.gstin) ?? null

      if (!mapping) {
        return {
          platformSku: item.platformSku,
          masterSkuId: null,
          masterSkuName: null,
          marketplaceAccountId: null,
          organizationId: orgId,
          isCombo: false,
          comboProductId: null,
          comboProductName: null,
          components: null,
        }
      }

      const resolvedOrgId = orgId ?? (mapping.marketplace_account_id
        ? accountOrgMap.get(mapping.marketplace_account_id) ?? null
        : null)

      // Combo mapping
      if (mapping.combo_product_id) {
        return {
          platformSku: item.platformSku,
          masterSkuId: null,
          masterSkuName: null,
          marketplaceAccountId: mapping.marketplace_account_id,
          organizationId: resolvedOrgId,
          isCombo: true,
          comboProductId: mapping.combo_product_id,
          comboProductName: comboNameMap.get(mapping.combo_product_id) ?? null,
          components: comboComponentsMap.get(mapping.combo_product_id) ?? [],
        }
      }

      // Simple mapping
      return {
        platformSku: item.platformSku,
        masterSkuId: mapping.master_sku_id,
        masterSkuName: mapping.master_sku_id ? skuNameMap.get(mapping.master_sku_id) ?? null : null,
        marketplaceAccountId: mapping.marketplace_account_id,
        organizationId: resolvedOrgId,
        isCombo: false,
        comboProductId: null,
        comboProductName: null,
        components: null,
      }
    })

    return NextResponse.json({ resolved })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
