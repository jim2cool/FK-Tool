import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const warehouseId = searchParams.get('warehouse_id')
    const masterSkuId = searchParams.get('master_sku_id')
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    let query = supabase
      .from('purchases')
      .select(`
        *,
        master_skus(id, name),
        warehouses(id, name)
      `)
      .eq('tenant_id', tenantId)
      .order('purchase_date', { ascending: false })

    if (warehouseId) query = query.eq('warehouse_id', warehouseId)
    if (masterSkuId) query = query.eq('master_sku_id', masterSkuId)
    if (from) query = query.gte('purchase_date', from)
    if (to) query = query.lte('purchase_date', to)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const body = await request.json()
    const {
      master_sku_id,
      warehouse_id,
      quantity,
      unit_cost,
      packaging_cost,
      other_cost,
      supplier,
      purchase_date,
      received_date,
    } = body

    if (!quantity || quantity <= 0) throw new Error('Quantity must be greater than 0')
    if (unit_cost < 0) throw new Error('Unit cost cannot be negative')

    const { data, error } = await supabase
      .from('purchases')
      .insert({
        tenant_id: tenantId,
        master_sku_id,
        warehouse_id,
        quantity,
        unit_cost: unit_cost ?? 0,
        packaging_cost: packaging_cost ?? 0,
        other_cost: other_cost ?? 0,
        supplier: supplier || null,
        purchase_date,
        received_date: received_date || null,
      })
      .select(`
        *,
        master_skus(id, name),
        warehouses(id, name)
      `)
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
    const body = await request.json()
    const {
      id,
      master_sku_id,
      warehouse_id,
      quantity,
      unit_cost,
      packaging_cost,
      other_cost,
      supplier,
      purchase_date,
      received_date,
    } = body

    if (!quantity || quantity <= 0) throw new Error('Quantity must be greater than 0')

    const { data, error } = await supabase
      .from('purchases')
      .update({
        master_sku_id,
        warehouse_id,
        quantity,
        unit_cost: unit_cost ?? 0,
        packaging_cost: packaging_cost ?? 0,
        other_cost: other_cost ?? 0,
        supplier: supplier || null,
        purchase_date,
        received_date: received_date || null,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(`
        *,
        master_skus(id, name),
        warehouses(id, name)
      `)
      .single()

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
    const { error } = await supabase
      .from('purchases')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
