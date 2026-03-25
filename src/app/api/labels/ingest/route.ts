import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

interface IngestLabel {
  orderId: string
  masterSkuId: string
  marketplaceAccountId: string | null
  quantity: number
  salePrice: number | null
  paymentType: 'COD' | 'PREPAID' | 'UNKNOWN'
  platformSku: string
  dispatchDate: string
  courier: string
  awbNumber: string
  isCombo?: boolean
  components?: Array<{ masterSkuId: string; quantity: number }>
}

interface IngestRequest {
  warehouseId: string
  labels: IngestLabel[]
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const body: IngestRequest = await request.json()

    if (!body.warehouseId || !body.labels?.length) {
      return NextResponse.json(
        { error: 'warehouseId and labels array are required' },
        { status: 400 }
      )
    }

    // Check for existing orders to avoid duplicates (by platform_order_id)
    const orderIds = body.labels.map(l => l.orderId)
    const { data: existingOrders } = await supabase
      .from('orders')
      .select('platform_order_id')
      .eq('tenant_id', tenantId)
      .in('platform_order_id', orderIds)

    const existingSet = new Set(existingOrders?.map(o => o.platform_order_id) ?? [])

    let created = 0
    let skipped = 0

    for (const label of body.labels) {
      if (existingSet.has(label.orderId)) {
        skipped++
        continue
      }

      if (label.isCombo && label.components?.length) {
        // Combo: create one order + dispatch per component
        let comboSuccess = true
        for (const comp of label.components) {
          const itemId = `${label.orderId}_c${label.components!.indexOf(comp)}`
          const { data: order, error: orderError } = await supabase
            .from('orders')
            .insert({
              tenant_id: tenantId,
              platform_order_id: label.orderId,
              order_item_id: itemId,
              master_sku_id: comp.masterSkuId,
              marketplace_account_id: label.marketplaceAccountId,
              quantity: comp.quantity,
              sale_price: label.salePrice ?? 0,
              order_date: label.dispatchDate,
              status: 'dispatched',
            })
            .select('id')
            .single()

          if (orderError) {
            console.error(`[labels/ingest] combo order error for ${label.orderId} (sku ${comp.masterSkuId}):`, orderError)
            comboSuccess = false
            continue
          }

          const { error: dispatchError } = await supabase
            .from('dispatches')
            .insert({
              tenant_id: tenantId,
              master_sku_id: comp.masterSkuId,
              warehouse_id: body.warehouseId,
              marketplace_account_id: label.marketplaceAccountId,
              order_id: order.id,
              platform_sku: label.platformSku,
              quantity: comp.quantity,
              dispatch_date: label.dispatchDate,
            })

          if (dispatchError) {
            console.error(`[labels/ingest] combo dispatch error for ${label.orderId}:`, dispatchError)
          }
        }

        if (comboSuccess) created++
        else skipped++

        // Add to existing set to prevent re-processing if same orderId appears again
        existingSet.add(label.orderId)
      } else {
        // Simple: one order + one dispatch
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .insert({
            tenant_id: tenantId,
            platform_order_id: label.orderId,
            order_item_id: label.orderId,
            master_sku_id: label.masterSkuId,
            marketplace_account_id: label.marketplaceAccountId,
            quantity: label.quantity || 1,
            sale_price: label.salePrice ?? 0,
            order_date: label.dispatchDate,
            status: 'dispatched',
          })
          .select('id')
          .single()

        if (orderError) {
          console.error(`[labels/ingest] order error for ${label.orderId}:`, orderError)
          skipped++
          continue
        }

        const { error: dispatchError } = await supabase
          .from('dispatches')
          .insert({
            tenant_id: tenantId,
            master_sku_id: label.masterSkuId,
            warehouse_id: body.warehouseId,
            marketplace_account_id: label.marketplaceAccountId,
            order_id: order.id,
            platform_sku: label.platformSku,
            quantity: label.quantity || 1,
            dispatch_date: label.dispatchDate,
          })

        if (dispatchError) {
          console.error(`[labels/ingest] dispatch error for ${label.orderId}:`, dispatchError)
        }

        created++
      }
    }

    return NextResponse.json({ created, skipped, total: body.labels.length })
  } catch (e: unknown) {
    console.error('[labels/ingest] error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
