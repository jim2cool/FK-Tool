import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'

export async function GET(req: Request) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const { searchParams } = new URL(req.url)
  const skuId = searchParams.get('sku_id')

  let query = supabase
    .from('sku_packaging_config')
    .select('*, packaging_materials(id, name, unit, unit_cost)')
    .eq('tenant_id', tenantId)

  if (skuId) query = query.eq('master_sku_id', skuId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const body = await req.json()
  const { data, error } = await supabase
    .from('sku_packaging_config')
    .insert({ ...body, tenant_id: tenantId })
    .select('*, packaging_materials(id, name, unit, unit_cost)')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const { id, qty_per_dispatch } = await req.json()
  const { data, error } = await supabase
    .from('sku_packaging_config')
    .update({ qty_per_dispatch })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('*, packaging_materials(id, name, unit, unit_cost)')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: Request) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const { id } = await req.json()
  const { error } = await supabase
    .from('sku_packaging_config')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
