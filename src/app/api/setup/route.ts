import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  // Verify the caller is authenticated using the user-scoped client
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check if profile already exists (read — user client is fine)
  const { data: existing } = await supabase
    .from('user_profiles').select('id').eq('id', user.id).single()
  if (existing) return NextResponse.json({ error: 'Already set up' }, { status: 400 })

  const { tenantName, warehouseName } = await request.json()

  // Use service-role client for all inserts to avoid the RLS bootstrap deadlock:
  // a brand-new user has no row in user_profiles yet, so every policy that
  // references user_profiles evaluates to false and blocks the INSERT.
  const admin = createAdminClient()

  const { data: tenant, error: tenantError } = await admin
    .from('tenants').insert({ name: tenantName }).select().single()
  if (tenantError) return NextResponse.json({ error: tenantError.message }, { status: 500 })

  const { error: profileError } = await admin.from('user_profiles').insert({
    id: user.id, tenant_id: tenant.id, email: user.email!, role: 'admin'
  })
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 })

  const { error: warehouseError } = await admin.from('warehouses').insert({
    tenant_id: tenant.id, name: warehouseName
  })
  if (warehouseError) return NextResponse.json({ error: warehouseError.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
