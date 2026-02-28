import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'

export async function GET() {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const { data, error } = await supabase
    .from('packaging_materials')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const body = await req.json()
  const { data, error } = await supabase
    .from('packaging_materials')
    .insert({ ...body, tenant_id: tenantId })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const { id, ...updates } = await req.json()
  const { data, error } = await supabase
    .from('packaging_materials')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: Request) {
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const { id } = await req.json()
  const { error } = await supabase
    .from('packaging_materials')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
