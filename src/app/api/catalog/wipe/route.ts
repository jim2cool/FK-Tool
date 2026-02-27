import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

// Deletion order matters — leaf tables first, then tables they reference.
// All of these reference master_skus directly or indirectly.
const TABLES_IN_ORDER = [
  'sku_financial_profiles', // → master_skus
  'order_financials',        // → orders
  'returns',                 // → orders, master_skus
  'dispatches',              // → master_skus
  'orders',                  // → master_skus
  'purchases',               // → master_skus
  'sku_mappings',            // → master_skus
  'master_skus',
] as const

export async function DELETE() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()

    for (const table of TABLES_IN_ORDER) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('tenant_id', tenantId)

      if (error) throw new Error(`Failed to wipe ${table}: ${error.message}`)
    }

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
