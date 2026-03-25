import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  try {
    const { ruleId } = await params
    const supabase = await createClient()
    const tenantId = await getTenantId()
    const { enabled } = await req.json()

    const { data, error } = await supabase
      .from('pnl_anomaly_rules')
      .update({ enabled })
      .eq('id', ruleId)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 401 })
  }
}
