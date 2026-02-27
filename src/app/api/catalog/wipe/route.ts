import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function DELETE() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()

    // Delete sku_mappings first (references master_skus)
    const { error: mappingsErr } = await supabase
      .from('sku_mappings')
      .delete()
      .eq('tenant_id', tenantId)

    if (mappingsErr) throw mappingsErr

    // Delete all master_skus (variants and parents)
    const { error: skusErr } = await supabase
      .from('master_skus')
      .delete()
      .eq('tenant_id', tenantId)

    if (skusErr) throw skusErr

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
