import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')
    let query = supabase.from('master_skus').select(`
      *, sku_mappings(id, platform, platform_sku, marketplace_account_id)
    `).eq('tenant_id', tenantId).eq('is_archived', false).order('name')
    if (search) query = query.ilike('name', `%${search}%`)
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
