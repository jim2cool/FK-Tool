import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'
import type { Platform } from '@/types'
import { normalizeAccountName } from '@/lib/marketplace-accounts/normalize'

export async function GET(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const includeArchived = searchParams.get('include_archived') === 'true'

    let q = supabase.from('marketplace_accounts')
      .select('*').eq('tenant_id', tenantId)
    if (!includeArchived) q = q.is('archived_at', null)

    const { data } = await q.order('platform')
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
    const { id, force } = await request.json()
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    // === Force-delete branch (archived accounts only) ===
    if (force === true) {
      // 1. Verify the account exists, belongs to tenant, and is archived
      const { data: acct, error: acctErr } = await supabase
        .from('marketplace_accounts')
        .select('id, archived_at')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single()
      if (acctErr || !acct) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      }
      if (!acct.archived_at) {
        return NextResponse.json(
          { error: 'Only archived accounts can be permanently deleted. Archive the account first.' },
          { status: 400 },
        )
      }

      // 2. Fetch order IDs so we can delete their dependents first
      const { data: orderRows } = await supabase
        .from('orders')
        .select('id')
        .eq('marketplace_account_id', id)
        .eq('tenant_id', tenantId)
      const orderIds = (orderRows ?? []).map((o: { id: string }) => o.id)

      // Step A: delete leaf tables that FK → orders (NO ACTION rules)
      if (orderIds.length > 0) {
        const { error: retErr } = await supabase
          .from('returns')
          .delete()
          .in('order_id', orderIds)
        if (retErr) throw retErr

        // order_financials has CASCADE on order_id but we delete it explicitly to be safe
        const { error: ofErr } = await supabase
          .from('order_financials')
          .delete()
          .in('order_id', orderIds)
        if (ofErr) throw ofErr
      }

      // Step B: delete dispatches (FK → marketplace_accounts, NO ACTION)
      const { error: dispErr } = await supabase
        .from('dispatches')
        .delete()
        .eq('marketplace_account_id', id)
      if (dispErr) throw dispErr

      // Step C: delete orders (FK → marketplace_accounts, NO ACTION)
      const { error: ordErr } = await supabase
        .from('orders')
        .delete()
        .eq('marketplace_account_id', id)
        .eq('tenant_id', tenantId)
      if (ordErr) throw ordErr

      // Step D: delete sku_mappings (FK → marketplace_accounts, NO ACTION)
      const { error: mapErr } = await supabase
        .from('sku_mappings')
        .delete()
        .eq('marketplace_account_id', id)
        .eq('tenant_id', tenantId)
      if (mapErr) throw mapErr

      // Step E: delete the account itself
      // dp_orders, dp_listing, dp_cogs, dp_pnl_history, dp_upload_log all have
      // CASCADE on marketplace_account_id and will be removed automatically.
      const { error: finalDelErr } = await supabase
        .from('marketplace_accounts')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId)
      if (finalDelErr) throw finalDelErr

      return NextResponse.json({ force_deleted: true })
    }

    // Try the hard delete first
    const { error: delErr, count } = await supabase
      .from('marketplace_accounts')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (!delErr && (count ?? 0) > 0) {
      return NextResponse.json({ deleted: true })
    }

    if (delErr && (delErr as { code?: string }).code === '23503') {
      // FK violation — archive instead
      const archivedAt = new Date().toISOString()
      const { error: updErr } = await supabase
        .from('marketplace_accounts')
        .update({ archived_at: archivedAt })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .is('archived_at', null)   // don't re-archive an already-archived row
      if (updErr) throw updErr
      return NextResponse.json({ archived: true, archived_at: archivedAt })
    }

    if ((count ?? 0) === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    if (delErr) throw delErr
    return NextResponse.json({ deleted: true })   // defensive default
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

interface PatchBody {
  id?: string
  action?: 'restore' | 'set_default_warehouse'
  warehouse_id?: string | null
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

    // === Restore branch ===
    if (body.action === 'restore') {
      // Read current row scoped to tenant
      const { data: current, error: readErr } = await supabase
        .from('marketplace_accounts')
        .select('id, platform, account_name, archived_at')
        .eq('id', body.id)
        .eq('tenant_id', tenantId)
        .single()
      if (readErr || !current) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      }
      if (!current.archived_at) {
        return NextResponse.json({ error: 'Account is not archived' }, { status: 400 })
      }

      // Check name-collision against active accounts
      const normalizedName = normalizeAccountName(current.account_name)
      if (!normalizedName) {
        return NextResponse.json({ error: 'Account name is invalid (cannot restore)' }, { status: 400 })
      }
      const { data: collision } = await supabase
        .from('marketplace_accounts')
        .select('id, account_name')
        .eq('tenant_id', tenantId)
        .eq('platform', current.platform)
        .is('archived_at', null)
        .neq('id', body.id)
      type Row = { id: string; account_name: string }
      const conflict = (collision as Row[] | null)?.find(r =>
        normalizeAccountName(r.account_name) === normalizedName,
      )
      if (conflict) {
        return NextResponse.json(
          {
            error: 'name_in_use_by_active_account',
            conflicting_account_name: conflict.account_name,
          },
          { status: 409 },
        )
      }

      // Restore
      const { data: updated, error: updErr } = await supabase
        .from('marketplace_accounts')
        .update({ archived_at: null })
        .eq('id', body.id)
        .eq('tenant_id', tenantId)
        .select()
        .single()
      if (updErr) throw updErr
      return NextResponse.json(updated)
    }

    // === Set default warehouse branch ===
    if (body.action === 'set_default_warehouse') {
      const warehouseId = body.warehouse_id ?? null

      if (warehouseId !== null) {
        const { data: wh } = await supabase
          .from('warehouses')
          .select('id')
          .eq('id', warehouseId)
          .eq('tenant_id', tenantId)
          .single()
        if (!wh) {
          return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 })
        }
      }

      const { data: updated, error: updErr } = await supabase
        .from('marketplace_accounts')
        .update({ default_warehouse_id: warehouseId })
        .eq('id', body.id)
        .eq('tenant_id', tenantId)
        .select()
        .single()
      if (updErr) throw updErr
      return NextResponse.json(updated)
    }

    // === (existing rename logic continues below) ===
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
