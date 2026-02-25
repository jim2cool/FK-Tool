import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'
import type { Platform } from '@/types'

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { data } = await supabase.from('marketplace_accounts')
      .select('*').eq('tenant_id', tenantId).order('platform')
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 })
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { platform, account_name }: { platform: Platform; account_name: string } = await request.json()
    const { data, error } = await supabase.from('marketplace_accounts')
      .insert({ tenant_id: tenantId, platform, account_name, mode: 'csv' })
      .select().single()
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
    await supabase.from('marketplace_accounts').delete().eq('id', id).eq('tenant_id', tenantId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
