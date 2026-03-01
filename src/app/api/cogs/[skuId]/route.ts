import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { calculateCogs } from '@/lib/cogs/calculate'

export async function GET(
  _: Request,
  { params }: { params: Promise<{ skuId: string }> }
) {
  const { skuId } = await params
  const result = await calculateCogs(skuId)
  if (!result)
    return NextResponse.json(
      { error: 'No purchases found for this SKU' },
      { status: 404 }
    )
  return NextResponse.json(result)
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ skuId: string }> }
) {
  const { skuId } = await params
  const supabase = await createClient()
  const tenantId = await getTenantId()
  const body = await req.json()

  const updates: Record<string, number> = {}
  if (body.shrinkage_rate !== undefined)
    updates.shrinkage_rate = Number(body.shrinkage_rate)
  if (body.delivery_rate !== undefined)
    updates.delivery_rate = Number(body.delivery_rate)

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('master_skus')
    .update(updates)
    .eq('id', skuId)
    .eq('tenant_id', tenantId)

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(await calculateCogs(skuId))
}
