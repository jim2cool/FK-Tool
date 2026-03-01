import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')
    const warehouseId = searchParams.get('warehouse_id')
    const platform = searchParams.get('platform')
    const accountId = searchParams.get('account_id')

    // Fetch ALL non-archived SKUs (parents, variants, flat) in one query — no search filter
    // here because search must match variant names too (applied after assembly below)
    const query = supabase
      .from('master_skus')
      .select(`*, sku_mappings(id, platform, platform_sku, marketplace_account_id)`)
      .eq('tenant_id', tenantId)
      .eq('is_archived', false)
      .order('name')

    const { data: allSkus, error } = await query
    if (error) throw error

    // Platform filter: find which SKU IDs have a mapping for this platform
    let platformFilterIds: string[] | null = null
    if (platform) {
      const { data: mapped } = await supabase
        .from('sku_mappings')
        .select('master_sku_id')
        .eq('tenant_id', tenantId)
        .eq('platform', platform)
      platformFilterIds = (mapped ?? []).map(m => m.master_sku_id)
    }

    // Account filter: find which SKU IDs have a mapping for this account
    let accountFilterIds: string[] | null = null
    if (accountId) {
      const { data: mapped } = await supabase
        .from('sku_mappings')
        .select('master_sku_id')
        .eq('tenant_id', tenantId)
        .eq('marketplace_account_id', accountId)
      accountFilterIds = (mapped ?? []).map(m => m.master_sku_id)
    }

    // Build warehouse presence map — just track which warehouses each SKU has purchases in
    let purchaseQuery = supabase
      .from('purchases')
      .select('master_sku_id, warehouse_id, warehouses(id, name, location)')
      .eq('tenant_id', tenantId)
    if (warehouseId) purchaseQuery = purchaseQuery.eq('warehouse_id', warehouseId)
    const { data: purchases } = await purchaseQuery

    type WhSummary = { warehouse_id: string; warehouse_name: string; location: string | null }
    const summaryMap: Record<string, WhSummary[]> = {}
    for (const p of purchases ?? []) {
      const wh = p.warehouses as unknown as { id: string; name: string; location: string | null } | null
      if (!wh) continue
      if (!summaryMap[p.master_sku_id]) summaryMap[p.master_sku_id] = []
      if (!summaryMap[p.master_sku_id].some(s => s.warehouse_id === wh.id)) {
        summaryMap[p.master_sku_id].push({ warehouse_id: wh.id, warehouse_name: wh.name, location: wh.location })
      }
    }

    // Separate variants from top-level rows
    const topLevel = (allSkus ?? []).filter(s => s.parent_id === null)
    const variantRows = (allSkus ?? []).filter(s => s.parent_id !== null)

    // Aggregate warehouse summaries for a parent from its variants (deduplicated)
    function aggregateSummaries(ids: string[]): WhSummary[] {
      const seen = new Set<string>()
      const result: WhSummary[] = []
      for (const id of ids) {
        for (const s of summaryMap[id] ?? []) {
          if (!seen.has(s.warehouse_id)) {
            seen.add(s.warehouse_id)
            result.push(s)
          }
        }
      }
      return result
    }

    // Build enriched result
    let result = topLevel.map(sku => {
      const variants = variantRows
        .filter(v => v.parent_id === sku.id)
        .map(v => ({ ...v, warehouse_summaries: summaryMap[v.id] ?? [] }))

      const warehouseSummaries = variants.length > 0
        ? aggregateSummaries(variants.map(v => v.id))
        : (summaryMap[sku.id] ?? [])

      return { ...sku, variants, warehouse_summaries: warehouseSummaries }
    })

    // Search: match on parent/flat name OR any variant name
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.variants.some((v: { name: string }) => v.name.toLowerCase().includes(q))
      )
    }

    // Apply platform filter: flat SKUs or parents with matching variant
    if (platformFilterIds !== null) {
      const ids = platformFilterIds
      result = result.filter(s =>
        s.variants.length === 0
          ? ids.includes(s.id)
          : s.variants.some((v: { id: string }) => ids.includes(v.id))
      )
    }

    // Apply account filter: flat SKUs or parents with matching variant
    if (accountFilterIds !== null) {
      const ids = accountFilterIds
      result = result.filter(s =>
        s.variants.length === 0
          ? ids.includes(s.id)
          : s.variants.some((v: { id: string }) => ids.includes(v.id))
      )
    }

    // Apply warehouse filter: only keep SKUs with stock in that warehouse
    if (warehouseId) {
      result = result.filter(s =>
        s.warehouse_summaries.some((w: WhSummary) => w.warehouse_id === warehouseId)
      )
    }

    return NextResponse.json(result)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { name, description, parent_id, variant_attributes } = await request.json()

    // If parent_id provided, validate it exists and is itself a top-level row
    if (parent_id) {
      const { data: parent, error: parentErr } = await supabase
        .from('master_skus')
        .select('id, parent_id')
        .eq('id', parent_id)
        .eq('tenant_id', tenantId)
        .single()
      if (parentErr || !parent) {
        return NextResponse.json({ error: 'Parent SKU not found' }, { status: 400 })
      }
      if (parent.parent_id !== null) {
        return NextResponse.json({ error: 'Cannot create a variant of a variant' }, { status: 400 })
      }
    }

    const { data, error } = await supabase
      .from('master_skus')
      .insert({ tenant_id: tenantId, name, description, parent_id: parent_id ?? null, variant_attributes: variant_attributes ?? null })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { id, name, description, variant_attributes } = await request.json()
    const update: Record<string, unknown> = { name, description }
    if (variant_attributes !== undefined) update.variant_attributes = variant_attributes
    const { data, error } = await supabase.from('master_skus')
      .update(update).eq('id', id).eq('tenant_id', tenantId).select().single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { id } = await request.json()
    const { error } = await supabase.from('master_skus')
      .update({ is_archived: true }).eq('id', id).eq('tenant_id', tenantId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
