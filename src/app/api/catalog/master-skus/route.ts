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

    // Fetch ALL non-archived SKUs (parents, variants, flat) in one query
    let query = supabase
      .from('master_skus')
      .select(`*, sku_mappings(id, platform, platform_sku, marketplace_account_id)`)
      .eq('tenant_id', tenantId)
      .eq('is_archived', false)
      .order('name')

    // Search only on top-level names (parent or flat SKU)
    if (search) query = query.ilike('name', `%${search}%`)

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

    // Build purchase summaries
    let purchaseQuery = supabase
      .from('purchases')
      .select('master_sku_id, warehouse_id, quantity, total_cogs, warehouses(id, name, location)')
      .eq('tenant_id', tenantId)
    if (warehouseId) purchaseQuery = purchaseQuery.eq('warehouse_id', warehouseId)
    const { data: purchases } = await purchaseQuery

    type WhSummary = {
      warehouse_id: string; warehouse_name: string; location: string | null
      total_qty: number; total_cogs: number; avg_cogs: number
    }
    const summaryMap: Record<string, WhSummary[]> = {}
    for (const p of purchases ?? []) {
      const wh = p.warehouses as unknown as { id: string; name: string; location: string | null } | null
      if (!wh) continue
      if (!summaryMap[p.master_sku_id]) summaryMap[p.master_sku_id] = []
      const existing = summaryMap[p.master_sku_id].find(s => s.warehouse_id === wh.id)
      if (existing) {
        existing.total_qty += p.quantity
        existing.total_cogs += Number(p.total_cogs)
        existing.avg_cogs = existing.total_cogs / existing.total_qty
      } else {
        summaryMap[p.master_sku_id].push({
          warehouse_id: wh.id, warehouse_name: wh.name, location: wh.location,
          total_qty: p.quantity, total_cogs: Number(p.total_cogs),
          avg_cogs: Number(p.total_cogs) / p.quantity,
        })
      }
    }

    // Separate variants from top-level rows
    const topLevel = (allSkus ?? []).filter(s => s.parent_id === null)
    const variantRows = (allSkus ?? []).filter(s => s.parent_id !== null)

    // Aggregate warehouse summaries for a parent from its variants
    function aggregateSummaries(ids: string[]): WhSummary[] {
      const agg: Record<string, WhSummary> = {}
      for (const id of ids) {
        for (const s of summaryMap[id] ?? []) {
          if (!agg[s.warehouse_id]) {
            agg[s.warehouse_id] = { ...s }
          } else {
            agg[s.warehouse_id].total_qty += s.total_qty
            agg[s.warehouse_id].total_cogs += s.total_cogs
            agg[s.warehouse_id].avg_cogs =
              agg[s.warehouse_id].total_cogs / agg[s.warehouse_id].total_qty
          }
        }
      }
      return Object.values(agg)
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

    // Apply platform filter: flat SKUs or parents with matching variant
    if (platformFilterIds !== null) {
      const ids = platformFilterIds
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
    const { name, description } = await request.json()
    const { data, error } = await supabase.from('master_skus')
      .insert({ tenant_id: tenantId, name, description }).select().single()
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
    const { id, name, description } = await request.json()
    const { data, error } = await supabase.from('master_skus')
      .update({ name, description }).eq('id', id).eq('tenant_id', tenantId).select().single()
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
