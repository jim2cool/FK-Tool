import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { data } = await supabase.from('warehouses')
      .select('*').eq('tenant_id', tenantId).order('created_at')
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 })
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { name, location } = await request.json()
    const { data, error } = await supabase.from('warehouses')
      .insert({ tenant_id: tenantId, name, location }).select().single()
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
    await supabase.from('warehouses').delete().eq('id', id).eq('tenant_id', tenantId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
