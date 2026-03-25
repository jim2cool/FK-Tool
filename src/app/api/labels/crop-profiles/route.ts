import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

// ── GET — list all profiles for tenant ────────────────────────────

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('crop_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })

    if (error) throw error

    // Map snake_case DB → camelCase frontend
    const profiles = (data ?? []).map(row => ({
      id: row.id,
      name: row.name,
      labelSize: row.label_size,
      crop: row.crop,
      includeInvoice: row.include_invoice,
      invoiceCrop: row.invoice_crop,
      invoiceSize: row.invoice_size,
    }))

    return NextResponse.json(profiles)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

// ── POST — create a new profile ───────────────────────────────────

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { name, labelSize, crop, includeInvoice, invoiceCrop, invoiceSize } = await request.json()

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Profile name is required' }, { status: 400 })
    }
    if (!labelSize || !crop) {
      return NextResponse.json({ error: 'Label size and crop are required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('crop_profiles')
      .insert({
        tenant_id: tenantId,
        name: name.trim(),
        label_size: labelSize,
        crop,
        include_invoice: includeInvoice ?? false,
        invoice_crop: invoiceCrop ?? null,
        invoice_size: invoiceSize ?? null,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: `A profile named "${name.trim()}" already exists` }, { status: 409 })
      }
      throw error
    }

    return NextResponse.json({
      id: data.id,
      name: data.name,
      labelSize: data.label_size,
      crop: data.crop,
      includeInvoice: data.include_invoice,
      invoiceCrop: data.invoice_crop,
      invoiceSize: data.invoice_size,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

// ── PATCH — update an existing profile ────────────────────────────

export async function PATCH(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { id, name, labelSize, crop, includeInvoice, invoiceCrop, invoiceSize } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'Profile id is required' }, { status: 400 })
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updateData.name = name.trim()
    if (labelSize !== undefined) updateData.label_size = labelSize
    if (crop !== undefined) updateData.crop = crop
    if (includeInvoice !== undefined) updateData.include_invoice = includeInvoice
    if (invoiceCrop !== undefined) updateData.invoice_crop = invoiceCrop
    if (invoiceSize !== undefined) updateData.invoice_size = invoiceSize

    const { data, error } = await supabase
      .from('crop_profiles')
      .update(updateData)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: `A profile named "${name?.trim()}" already exists` }, { status: 409 })
      }
      throw error
    }

    return NextResponse.json({
      id: data.id,
      name: data.name,
      labelSize: data.label_size,
      crop: data.crop,
      includeInvoice: data.include_invoice,
      invoiceCrop: data.invoice_crop,
      invoiceSize: data.invoice_size,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

// ── DELETE — remove a profile ─────────────────────────────────────

export async function DELETE(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { id } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'Profile id is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('crop_profiles')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
