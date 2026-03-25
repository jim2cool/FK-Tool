import { getTenantId } from '@/lib/db/tenant'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { insight_key } = (await req.json()) as { insight_key: string }

    if (!insight_key) {
      return NextResponse.json({ error: 'insight_key is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('dismissed_insights')
      .upsert(
        { tenant_id: tenantId, insight_key, dismissed_at: new Date().toISOString() },
        { onConflict: 'tenant_id,insight_key' },
      )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    console.error('[pnl/insights/dismiss]', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
