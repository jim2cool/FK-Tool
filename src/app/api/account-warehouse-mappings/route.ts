import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('account_warehouse_mappings')
      .select('*')
      .eq('tenant_id', tenantId)
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
    const { marketplace_account_id, warehouse_id } = await request.json()
    if (!marketplace_account_id || !warehouse_id) {
      return NextResponse.json({ error: 'marketplace_account_id and warehouse_id are required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('account_warehouse_mappings')
      .insert({ tenant_id: tenantId, marketplace_account_id, warehouse_id })
      .select()
      .single()
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json({ error: 'Mapping already exists' }, { status: 409 })
      }
      throw error
    }
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { marketplace_account_id, warehouse_id } = await request.json()
    if (!marketplace_account_id || !warehouse_id) {
      return NextResponse.json({ error: 'marketplace_account_id and warehouse_id are required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('account_warehouse_mappings')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('marketplace_account_id', marketplace_account_id)
      .eq('warehouse_id', warehouse_id)
    if (error) throw error
    return NextResponse.json({ deleted: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
