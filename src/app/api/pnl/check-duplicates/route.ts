import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/db/tenant'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const { orderItemIds } = (await req.json()) as {
      orderItemIds: string[]
    }

    if (!Array.isArray(orderItemIds) || orderItemIds.length === 0) {
      return NextResponse.json({ existingItemIds: [] })
    }

    const supabase = await createClient()

    // Query orders that already have these order_item_ids
    const { data: existing, error } = await supabase
      .from('orders')
      .select('order_item_id')
      .eq('tenant_id', tenantId)
      .in('order_item_id', orderItemIds)

    if (error) {
      console.error('[pnl/check-duplicates]', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      )
    }

    const existingItemIds = (existing ?? []).map(
      (o) => o.order_item_id as string,
    )

    return NextResponse.json({ existingItemIds })
  } catch (e: unknown) {
    const msg = (e as Error).message
    if (msg === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[pnl/check-duplicates]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
