import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'
import type { Platform } from '@/types'
import { normalizeAccountName } from '@/lib/marketplace-accounts/normalize'

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { data } = await supabase.from('marketplace_accounts')
      .select('*').eq('tenant_id', tenantId).order('platform')
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 })
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { platform, account_name }: { platform: Platform; account_name: string } = await request.json()

    const normalized = normalizeAccountName(account_name)
    if (!normalized) {
      return NextResponse.json(
        { error: 'account_name is required and must be 1–100 characters' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase.from('marketplace_accounts')
      .insert({ tenant_id: tenantId, platform, account_name: normalized, mode: 'csv' })
      .select().single()
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'name_already_in_use', account_name: normalized },
          { status: 409 },
        )
      }
      throw error
    }
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
    const { error, count } = await supabase
      .from('marketplace_accounts')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('tenant_id', tenantId)
    if (error) {
      // Postgres FK violation = 23503 (linked dispatches / orders / sku_mappings)
      if ((error as { code?: string }).code === '23503') {
        return NextResponse.json(
          {
            error: 'has_linked_data',
            message: 'This account has linked orders, dispatches, or SKU mappings and cannot be deleted. Archive support is coming in a future release.',
          },
          { status: 409 },
        )
      }
      throw error
    }
    if (count === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

interface PatchBody {
  id?: string
  account_name?: string
  expected_current_name?: string
  force_recycle?: boolean
}

export async function PATCH(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const body = (await request.json()) as PatchBody

    // Validation
    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }
    const normalizedNew = normalizeAccountName(body.account_name)
    if (!normalizedNew) {
      return NextResponse.json(
        { error: 'account_name is required and must be 1–100 characters after normalization' },
        { status: 400 },
      )
    }
    const normalizedExpected = normalizeAccountName(body.expected_current_name)
    if (!normalizedExpected) {
      return NextResponse.json(
        { error: 'expected_current_name is required for stale-write detection' },
        { status: 400 },
      )
    }

    // Read current row, scoped to tenant
    const { data: current, error: readErr } = await supabase
      .from('marketplace_accounts')
      .select('id, tenant_id, platform, account_name, previous_names')
      .eq('id', body.id)
      .eq('tenant_id', tenantId)
      .single()

    if (readErr || !current) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Stale-write check
    const currentName = current.account_name as string
    if (normalizeAccountName(currentName) !== normalizedExpected) {
      return NextResponse.json(
        { error: 'stale_edit', current_name: currentName },
        { status: 409 },
      )
    }

    // Idempotent: if normalized new name == current, just return current row
    if (normalizedNew === normalizeAccountName(currentName)) {
      return NextResponse.json(current)
    }

    // Recycle-name warning (skip if force_recycle)
    if (!body.force_recycle) {
      const { data: recycleConflicts } = await supabase
        .from('marketplace_accounts')
        .select('id, account_name, previous_names')
        .eq('tenant_id', tenantId)
        .eq('platform', current.platform)
        .neq('id', body.id)

      type Row = { id: string; account_name: string; previous_names: { name: string; changed_at: string }[] }
      const conflict = (recycleConflicts as Row[] | null)?.find(r =>
        (r.previous_names ?? []).some(prev =>
          normalizeAccountName(prev.name) === normalizedNew,
        ),
      )
      if (conflict) {
        return NextResponse.json(
          {
            warning: 'name_recently_used_by_another_account',
            conflicting_account_name: conflict.account_name,
            expected_current_name: currentName,
          },
          { status: 200 },
        )
      }
    }

    // Append old name + update; the unique index enforces concurrency safety
    const previousNamesArr = (current.previous_names as { name: string; changed_at: string }[] | null) ?? []
    const newPreviousNames = [
      ...previousNamesArr,
      { name: currentName, changed_at: new Date().toISOString() },
    ]

    const { data: updated, error: updateErr } = await supabase
      .from('marketplace_accounts')
      .update({ account_name: normalizedNew, previous_names: newPreviousNames })
      .eq('id', body.id)
      .eq('tenant_id', tenantId)
      .select()
      .single()

    if (updateErr) {
      // Postgres unique-violation = 23505
      if ((updateErr as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'name_already_in_use', account_name: normalizedNew },
          { status: 409 },
        )
      }
      throw updateErr
    }

    return NextResponse.json(updated)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
