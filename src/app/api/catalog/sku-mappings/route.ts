import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'
import type { Platform } from '@/types'

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { master_sku_id, combo_product_id, platform, platform_sku, marketplace_account_id }:
      { master_sku_id?: string; combo_product_id?: string; platform: Platform; platform_sku: string; marketplace_account_id?: string } =
      await request.json()

    if (!master_sku_id && !combo_product_id) {
      return NextResponse.json({ error: 'Either master_sku_id or combo_product_id is required' }, { status: 400 })
    }
    if (master_sku_id && combo_product_id) {
      return NextResponse.json({ error: 'Cannot set both master_sku_id and combo_product_id' }, { status: 400 })
    }

    const { data, error } = await supabase.from('sku_mappings')
      .insert({
        tenant_id: tenantId,
        master_sku_id: master_sku_id ?? null,
        combo_product_id: combo_product_id ?? null,
        platform,
        platform_sku,
        marketplace_account_id,
      })
      .select().single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { id } = await request.json()
    const { error } = await supabase.from('sku_mappings')
      .delete().eq('id', id).eq('tenant_id', tenantId)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { id, platform, platform_sku, marketplace_account_id, master_sku_id, combo_product_id }:
      { id: string; platform: string; platform_sku: string; marketplace_account_id: string; master_sku_id?: string; combo_product_id?: string } =
      await request.json()

    if (!id || !platform || !platform_sku) {
      return NextResponse.json(
        { error: 'id, platform, platform_sku required' },
        { status: 400 },
      )
    }

    const updateData: Record<string, unknown> = { platform, platform_sku, marketplace_account_id }

    // If switching between simple and combo
    if (master_sku_id) {
      updateData.master_sku_id = master_sku_id
      updateData.combo_product_id = null
    } else if (combo_product_id) {
      updateData.master_sku_id = null
      updateData.combo_product_id = combo_product_id
    }

    const { data, error } = await supabase
      .from('sku_mappings')
      .update(updateData)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
