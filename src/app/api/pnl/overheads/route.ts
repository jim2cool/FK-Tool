import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const tenantId = await getTenantId()
    const month = request.nextUrl.searchParams.get('month')
    if (!month) {
      return NextResponse.json({ error: 'month query param is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('monthly_overheads')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .order('category')
      .order('name')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const total = (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0)
    return NextResponse.json({ overheads: data ?? [], total })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message === 'Unauthorized') return NextResponse.json({ error: message }, { status: 401 })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const tenantId = await getTenantId()
    const { month, items } = await request.json() as {
      month: string
      items: Array<{ id?: string; category: string; name: string; amount: number }>
    }

    if (!month || !items) {
      return NextResponse.json({ error: 'month and items are required' }, { status: 400 })
    }

    // Collect IDs from incoming items that already have an id (updates)
    const incomingIds = items.filter(i => i.id).map(i => i.id!)

    // Delete items for this month that are NOT in the incoming set
    const { error: deleteError } = await supabase
      .from('monthly_overheads')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .not('id', 'in', `(${incomingIds.length > 0 ? incomingIds.join(',') : '00000000-0000-0000-0000-000000000000'})`)

    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

    // Upsert all items
    const rows = items.map(item => ({
      ...(item.id ? { id: item.id } : {}),
      tenant_id: tenantId,
      month,
      category: item.category,
      name: item.name,
      amount: item.amount,
    }))

    const { data, error } = await supabase
      .from('monthly_overheads')
      .upsert(rows, { onConflict: 'id' })
      .select()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const total = (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0)
    return NextResponse.json({ overheads: data ?? [], total })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message === 'Unauthorized') return NextResponse.json({ error: message }, { status: 401 })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
