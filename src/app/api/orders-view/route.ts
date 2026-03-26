import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const params = request.nextUrl.searchParams

    const page = Math.max(1, parseInt(params.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(params.get('pageSize') ?? '50')))
    const search = params.get('search')?.trim() ?? ''
    const status = params.get('status') ?? ''
    const from = params.get('from') ?? ''
    const to = params.get('to') ?? ''
    const accountId = params.get('accountId') ?? ''

    let query = supabase
      .from('orders')
      .select(`
        id, platform_order_id, order_item_id, order_date, status, quantity,
        sale_price, final_selling_price, channel, fulfillment_type, payment_mode,
        gross_units, net_units, rto_units, rvp_units, cancelled_units,
        dispatch_date, delivery_date, cancellation_date, cancellation_reason,
        return_request_date, return_complete_date, return_type, return_status,
        return_reason, return_sub_reason, settlement_date, neft_id,
        master_sku_id, marketplace_account_id, combo_product_id,
        master_skus(id, name),
        marketplace_accounts(id, account_name, platform),
        order_financials(
          accounted_net_sales, sale_amount, seller_offer_burn,
          commission_fee, collection_fee, fixed_fee,
          pick_pack_fee, forward_shipping_fee, reverse_shipping_fee,
          projected_settlement, amount_settled, amount_pending
        )
      `, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('order_date', { ascending: false })

    if (search) {
      query = query.or(`platform_order_id.ilike.%${search}%,order_item_id.ilike.%${search}%`)
    }
    if (status) {
      query = query.eq('status', status)
    }
    if (from) {
      query = query.gte('order_date', from)
    }
    if (to) {
      query = query.lte('order_date', to)
    }
    if (accountId) {
      query = query.eq('marketplace_account_id', accountId)
    }

    const rangeFrom = (page - 1) * pageSize
    const rangeTo = rangeFrom + pageSize - 1
    query = query.range(rangeFrom, rangeTo)

    const { data, error, count } = await query
    if (error) throw error

    return NextResponse.json({
      orders: data ?? [],
      total: count ?? 0,
      page,
      pageSize,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
