import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

interface ResolveRequest {
  items: Array<{
    platformSku: string
    gstin: string
  }>
}

interface ResolvedItem {
  platformSku: string
  masterSkuId: string | null
  masterSkuName: string | null
  marketplaceAccountId: string | null
  organizationId: string | null
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const body: ResolveRequest = await request.json()

    if (!body.items?.length) {
      return NextResponse.json({ error: 'items array is required' }, { status: 400 })
    }

    // Load all sku_mappings for this tenant
    const { data: mappings, error: mappingError } = await supabase
      .from('sku_mappings')
      .select('platform_sku, master_sku_id, marketplace_account_id')
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

    // Build platform_sku → mapping lookup (case-insensitive)
    const skuLookup = new Map<string, { master_sku_id: string; marketplace_account_id: string | null }>()
    for (const m of mappings ?? []) {
      skuLookup.set(m.platform_sku.toLowerCase(), {
        master_sku_id: m.master_sku_id,
        marketplace_account_id: m.marketplace_account_id,
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
        }
      }

      return {
        platformSku: item.platformSku,
        masterSkuId: mapping.master_sku_id,
        masterSkuName: skuNameMap.get(mapping.master_sku_id) ?? null,
        marketplaceAccountId: mapping.marketplace_account_id,
        organizationId: orgId ?? (mapping.marketplace_account_id
          ? accountOrgMap.get(mapping.marketplace_account_id) ?? null
          : null),
      }
    })

    return NextResponse.json({ resolved })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
