import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function DELETE() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()

    const { error } = await supabase
      .from('purchases')
      .delete()
      .eq('tenant_id', tenantId)

    if (error) throw new Error(`Failed to wipe purchases: ${error.message}`)

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
