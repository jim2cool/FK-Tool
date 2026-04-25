import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'
import type { ReportType, ParsedOrder, ParsedListing, ParsedCogs, ParsedPnlHistory } from '@/lib/daily-pnl/types'

function stripSku(v: string | undefined | null): string {
  return (v ?? '').replace(/^["']+|["']+$/g, '').replace(/^SKU:/i, '').trim()
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()

    const body = await request.json() as {
      marketplace_account_id: string
      report_type: ReportType
      rows: unknown[]
    }
    const { marketplace_account_id, report_type, rows } = body

    if (!marketplace_account_id || !report_type || !Array.isArray(rows)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Verify account belongs to this tenant
    const { data: account } = await supabase
      .from('marketplace_accounts')
      .select('id')
      .eq('id', marketplace_account_id)
      .eq('tenant_id', tenantId)
      .single()
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    let inserted = 0

    if (report_type === 'orders') {
      const valid = (rows as ParsedOrder[]).filter(r => !r.error && r.order_item_id)
      if (valid.length > 0) {
        const { error } = await supabase
          .from('dp_orders')
          .upsert(
            valid.map(r => ({
              marketplace_account_id,
              order_item_id:        r.order_item_id,
              order_id:             r.order_id,
              sku:                  stripSku(r.sku),
              quantity:             r.quantity,
              dispatched_date:      r.dispatched_date,
              delivery_tracking_id: r.delivery_tracking_id,
              order_item_status:    r.order_item_status,
            })),
            { onConflict: 'marketplace_account_id,order_item_id' }
          )
        if (error) throw error
        inserted = valid.length
      }
    }

    else if (report_type === 'listing') {
      // Replace: delete current listing, then insert fresh
      await supabase.from('dp_listing').delete().eq('marketplace_account_id', marketplace_account_id)
      const valid = (rows as ParsedListing[]).filter(r => !r.error && r.seller_sku_id)
      if (valid.length > 0) {
        const { error } = await supabase.from('dp_listing').insert(
          valid.map(r => ({
            marketplace_account_id,
            seller_sku_id:   stripSku(r.seller_sku_id),
            mrp:             r.mrp,
            bank_settlement: r.bank_settlement,
            selling_price:   r.selling_price,
            benchmark_price: r.benchmark_price,
          }))
        )
        if (error) throw error
        inserted = valid.length
      }
    }

    else if (report_type === 'cogs') {
      // Replace: delete current COGS, then insert fresh
      await supabase.from('dp_cogs').delete().eq('marketplace_account_id', marketplace_account_id)
      const valid = (rows as ParsedCogs[]).filter(r => !r.error && r.sku)
      if (valid.length > 0) {
        const { error } = await supabase.from('dp_cogs').insert(
          valid.map(r => ({
            marketplace_account_id,
            sku:            stripSku(r.sku),
            master_product: r.master_product,
            cogs:           r.cogs,
          }))
        )
        if (error) throw error
        inserted = valid.length
      }
    }

    else if (report_type === 'pnl_history') {
      // Append + dedup on (account_id, order_item_id, order_date)
      const valid = (rows as ParsedPnlHistory[]).filter(r => !r.error && r.order_item_id)
      if (valid.length > 0) {
        const { error } = await supabase
          .from('dp_pnl_history')
          .upsert(
            valid.map(r => ({
              marketplace_account_id,
              order_date:      r.order_date,
              order_item_id:   r.order_item_id,
              sku_name:        stripSku(r.sku_name),
              order_status:    r.order_status,
              gross_units:     r.gross_units,
              rto_units:       r.rto_units,
              rvp_units:       r.rvp_units,
              cancelled_units: r.cancelled_units,
              total_expenses:  r.total_expenses,
            })),
            { onConflict: 'marketplace_account_id,order_item_id,order_date' }
          )
        if (error) throw error
        inserted = valid.length
      }
    }

    // Log the upload
    await supabase.from('dp_upload_log').insert({ marketplace_account_id, report_type, row_count: inserted })

    return NextResponse.json({ inserted })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
