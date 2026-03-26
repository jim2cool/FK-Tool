import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { calculateCogsBatch } from '@/lib/cogs/calculate'

export async function GET() {
  const supabase = await createClient()
  const tenantId = await getTenantId()

  // Get unique SKU IDs that have at least one purchase
  const { data: rows } = await supabase
    .from('purchases')
    .select('master_sku_id')
    .eq('tenant_id', tenantId)

  const uniqueIds = [...new Set((rows ?? []).map(r => r.master_sku_id))]
  const cogsMap = await calculateCogsBatch(uniqueIds)
  return NextResponse.json([...cogsMap.values()])
}
