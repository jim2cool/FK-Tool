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

    // Base SKU query
    let query = supabase.from('master_skus').select(`
      *, sku_mappings(id, platform, platform_sku, marketplace_account_id)
    `).eq('tenant_id', tenantId).eq('is_archived', false).order('name')
    if (search) query = query.ilike('name', `%${search}%`)
    // Platform filter: only return SKUs that have a mapping for the given platform
    if (platform) {
      const { data: mapped } = await supabase
        .from('sku_mappings')
        .select('master_sku_id')
        .eq('tenant_id', tenantId)
        .eq('platform', platform)
      const ids = (mapped ?? []).map(m => m.master_sku_id)
      if (ids.length === 0) return NextResponse.json([])
      query = query.in('id', ids)
    }

    const { data: skus, error } = await query
    if (error) throw error

    // Pull purchase summaries: group by master_sku_id + warehouse_id
    let purchaseQuery = supabase
      .from('purchases')
      .select('master_sku_id, warehouse_id, quantity, total_cogs, warehouses(id, name, location)')
      .eq('tenant_id', tenantId)
    if (warehouseId) purchaseQuery = purchaseQuery.eq('warehouse_id', warehouseId)

    const { data: purchases } = await purchaseQuery

    // Aggregate: { [skuId]: { [warehouseId]: { name, location, totalQty, totalCogs, avgCogs } } }
    type WhSummary = { warehouse_id: string; warehouse_name: string; location: string | null; total_qty: number; total_cogs: number; avg_cogs: number }
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
          warehouse_id: wh.id,
          warehouse_name: wh.name,
          location: wh.location,
          total_qty: p.quantity,
          total_cogs: Number(p.total_cogs),
          avg_cogs: Number(p.total_cogs) / p.quantity,
        })
      }
    }

    // Filter SKUs: if warehouse filter active, only return SKUs that have purchases in that warehouse
    let result = skus ?? []
    if (warehouseId) {
      result = result.filter(s => summaryMap[s.id]?.some(w => w.warehouse_id === warehouseId))
    }

    const enriched = result.map(s => ({
      ...s,
      warehouse_summaries: summaryMap[s.id] ?? [],
    }))

    return NextResponse.json(enriched)
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
