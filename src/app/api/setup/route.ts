import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check if profile already exists
  const { data: existing } = await supabase
    .from('user_profiles').select('id').eq('id', user.id).single()
  if (existing) return NextResponse.json({ error: 'Already set up' }, { status: 400 })

  const { tenantName, warehouseName } = await request.json()

  // Create tenant
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants').insert({ name: tenantName }).select().single()
  if (tenantError) return NextResponse.json({ error: tenantError.message }, { status: 500 })

  // Create user profile
  const { error: profileError } = await supabase.from('user_profiles').insert({
    id: user.id, tenant_id: tenant.id, email: user.email!, role: 'admin'
  })
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 })

  // Create first warehouse
  await supabase.from('warehouses').insert({
    tenant_id: tenant.id, name: warehouseName
  })

  return NextResponse.json({ success: true })
}
