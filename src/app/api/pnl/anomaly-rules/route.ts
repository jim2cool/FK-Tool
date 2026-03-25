import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { DEFAULT_ANOMALY_RULES } from '@/lib/pnl/anomaly-rules'

export async function GET() {
  try {
    const supabase = await createClient()
    const tenantId = await getTenantId()

    const { data, error } = await supabase
      .from('pnl_anomaly_rules')
      .select('*')
      .eq('tenant_id', tenantId)

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 })

    // If no rules exist yet, seed the defaults
    if (!data || data.length === 0) {
      const toInsert = DEFAULT_ANOMALY_RULES.map((rule) => ({
        tenant_id: tenantId,
        rule_key: rule.rule_key,
        name: rule.name,
        description: rule.description,
        enabled: true,
      }))

      const { data: seeded, error: seedError } = await supabase
        .from('pnl_anomaly_rules')
        .insert(toInsert)
        .select()

      if (seedError)
        return NextResponse.json(
          { error: seedError.message },
          { status: 500 }
        )

      return NextResponse.json(seeded)
    }

    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 401 })
  }
}
