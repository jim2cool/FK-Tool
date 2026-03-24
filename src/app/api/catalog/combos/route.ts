import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()

    // Load combos with components (joined to master_skus for names)
    const { data: combos, error: comboError } = await supabase
      .from('combo_products')
      .select('id, name, is_archived, created_at')
      .eq('tenant_id', tenantId)
      .eq('is_archived', false)
      .order('name')

    if (comboError) throw comboError

    if (!combos?.length) {
      return NextResponse.json([])
    }

    // Load components for all combos
    const comboIds = combos.map(c => c.id)
    const { data: components, error: compError } = await supabase
      .from('combo_product_components')
      .select('id, combo_product_id, master_sku_id, quantity')
      .in('combo_product_id', comboIds)

    if (compError) throw compError

    // Load master SKU names for all referenced SKUs
    const skuIds = [...new Set(components?.map(c => c.master_sku_id) ?? [])]
    const { data: skus, error: skuError } = await supabase
      .from('master_skus')
      .select('id, name')
      .in('id', skuIds.length ? skuIds : ['__none__'])

    if (skuError) throw skuError
    const skuNameMap = new Map(skus?.map(s => [s.id, s.name]) ?? [])

    // Load sku_mappings that point to these combos
    const { data: mappings, error: mapError } = await supabase
      .from('sku_mappings')
      .select('id, combo_product_id, platform, platform_sku, marketplace_account_id')
      .eq('tenant_id', tenantId)
      .in('combo_product_id', comboIds)

    if (mapError) throw mapError

    // Assemble response
    const result = combos.map(combo => ({
      ...combo,
      components: (components ?? [])
        .filter(c => c.combo_product_id === combo.id)
        .map(c => ({
          id: c.id,
          masterSkuId: c.master_sku_id,
          masterSkuName: skuNameMap.get(c.master_sku_id) ?? 'Unknown',
          quantity: c.quantity,
        })),
      skuMappings: (mappings ?? [])
        .filter(m => m.combo_product_id === combo.id)
        .map(m => ({
          id: m.id,
          platform: m.platform,
          platformSku: m.platform_sku,
          marketplaceAccountId: m.marketplace_account_id,
        })),
    }))

    return NextResponse.json(result)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { name, components }: {
      name: string
      components: Array<{ master_sku_id: string; quantity: number }>
    } = await request.json()

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Combo name is required' }, { status: 400 })
    }
    if (!components?.length) {
      return NextResponse.json({ error: 'A combo must have at least 1 component' }, { status: 400 })
    }

    // Check for duplicate name
    const { data: existing } = await supabase
      .from('combo_products')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', name.trim())
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: `A combo named "${name}" already exists` }, { status: 409 })
    }

    // Create combo
    const { data: combo, error: comboError } = await supabase
      .from('combo_products')
      .insert({ tenant_id: tenantId, name: name.trim() })
      .select('id')
      .single()

    if (comboError) throw comboError

    // Insert components
    const { error: compError } = await supabase
      .from('combo_product_components')
      .insert(components.map(c => ({
        combo_product_id: combo.id,
        master_sku_id: c.master_sku_id,
        quantity: c.quantity,
      })))

    if (compError) throw compError

    return NextResponse.json({ id: combo.id, name: name.trim() })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { id, name, components }: {
      id: string
      name?: string
      components?: Array<{ master_sku_id: string; quantity: number }>
    } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'Combo id is required' }, { status: 400 })
    }

    // Verify ownership
    const { data: combo, error: findError } = await supabase
      .from('combo_products')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (findError) throw findError
    if (!combo) {
      return NextResponse.json({ error: 'Combo not found' }, { status: 404 })
    }

    // Update name if provided
    if (name?.trim()) {
      const { error: updateError } = await supabase
        .from('combo_products')
        .update({ name: name.trim() })
        .eq('id', id)
        .eq('tenant_id', tenantId)

      if (updateError) throw updateError
    }

    // Replace components if provided
    if (components) {
      if (!components.length) {
        return NextResponse.json({ error: 'A combo must have at least 1 component' }, { status: 400 })
      }

      // Delete existing components
      const { error: delError } = await supabase
        .from('combo_product_components')
        .delete()
        .eq('combo_product_id', id)

      if (delError) throw delError

      // Insert new components
      const { error: insError } = await supabase
        .from('combo_product_components')
        .insert(components.map(c => ({
          combo_product_id: id,
          master_sku_id: c.master_sku_id,
          quantity: c.quantity,
        })))

      if (insError) throw insError
    }

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { id } = await request.json()

    const { error } = await supabase
      .from('combo_products')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
