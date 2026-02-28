import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'

export async function GET() {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const { data, error } = await supabase
    .from('packaging_purchases')
    .select('*, packaging_materials(id, name, unit)')
    .eq('tenant_id', tenantId)
    .order('purchase_date', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const body = await req.json()

  const { data, error } = await supabase
    .from('packaging_purchases')
    .insert({ ...body, tenant_id: tenantId })
    .select('*, packaging_materials(id, name, unit)')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Update material's unit_cost to latest purchase price
  await supabase
    .from('packaging_materials')
    .update({ unit_cost: body.unit_cost, updated_at: new Date().toISOString() })
    .eq('id', body.packaging_material_id)
    .eq('tenant_id', tenantId)

  return NextResponse.json(data)
}

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const { id, ...updates } = await req.json()
  const { data, error } = await supabase
    .from('packaging_purchases')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('*, packaging_materials(id, name, unit)')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: Request) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const { id } = await req.json()
  const { error } = await supabase
    .from('packaging_purchases')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
