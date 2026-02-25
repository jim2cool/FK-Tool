import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('imports')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
