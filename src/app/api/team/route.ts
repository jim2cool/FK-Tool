import { NextRequest, NextResponse } from 'next/server'
import { getUserProfile } from '@/lib/db/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { ALL_PAGES } from '@/lib/auth/page-access'

function forbidden() {
  return NextResponse.json({ error: 'Forbidden — owner/admin only' }, { status: 403 })
}

function validatePages(pages: string[] | null): string | null {
  if (pages === null) return null
  for (const p of pages) {
    if (!(ALL_PAGES as readonly string[]).includes(p)) {
      return `Invalid page: "${p}"`
    }
  }
  return null
}

// ── GET: List all members in the tenant ───────────────────────────────────────

export async function GET() {
  try {
    const caller = await getUserProfile()
    // Use admin client to bypass RLS (user_profiles RLS is id = auth.uid())
    const admin = createAdminClient()

    const { data, error } = await admin
      .from('user_profiles')
      .select('id, email, role, allowed_pages, created_at')
      .eq('tenant_id', caller.tenantId)
      .order('created_at')

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    const msg = (e as Error).message
    if (msg === 'Unauthorized') return NextResponse.json({ error: msg }, { status: 401 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── POST: Add a new member ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const caller = await getUserProfile()
    if (caller.role !== 'owner' && caller.role !== 'admin') return forbidden()

    const body = await req.json()
    const { email, password, role, allowed_pages } = body as {
      email: string
      password: string
      role: string
      allowed_pages: string[] | null
    }

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }
    if (role === 'owner') {
      return NextResponse.json({ error: 'Cannot create another owner' }, { status: 400 })
    }
    const pageErr = validatePages(allowed_pages)
    if (pageErr) {
      return NextResponse.json({ error: pageErr }, { status: 400 })
    }

    const admin = createAdminClient()

    // Create auth user
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 400 })
    }

    // Create user_profiles row in the same tenant
    const { error: profileErr } = await admin
      .from('user_profiles')
      .insert({
        id: authData.user.id,
        tenant_id: caller.tenantId,
        email,
        role: role || 'staff',
        allowed_pages: allowed_pages ?? null,
      })

    if (profileErr) {
      // Rollback: delete the auth user we just created
      await admin.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: profileErr.message }, { status: 500 })
    }

    return NextResponse.json({ id: authData.user.id, email, role, allowed_pages })
  } catch (e: unknown) {
    const msg = (e as Error).message
    if (msg === 'Unauthorized') return NextResponse.json({ error: msg }, { status: 401 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── PATCH: Update a member's role / allowed_pages ─────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const caller = await getUserProfile()
    if (caller.role !== 'owner' && caller.role !== 'admin') return forbidden()

    const body = await req.json()
    const { user_id, role, allowed_pages } = body as {
      user_id: string
      role?: string
      allowed_pages?: string[] | null
    }

    if (!user_id) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
    }
    if (user_id === caller.id) {
      return NextResponse.json({ error: 'Cannot modify your own role' }, { status: 400 })
    }
    if (role === 'owner') {
      return NextResponse.json({ error: 'Cannot set role to owner' }, { status: 400 })
    }
    if (allowed_pages !== undefined) {
      const pageErr = validatePages(allowed_pages)
      if (pageErr) {
        return NextResponse.json({ error: pageErr }, { status: 400 })
      }
    }

    const admin = createAdminClient()

    // Verify target is in the same tenant and check their role
    const { data: target } = await admin
      .from('user_profiles')
      .select('tenant_id, role')
      .eq('id', user_id)
      .single()

    if (!target || target.tenant_id !== caller.tenantId) {
      return NextResponse.json({ error: 'User not found in your workspace' }, { status: 404 })
    }
    if (target.role === 'owner') {
      return NextResponse.json({ error: 'Cannot modify an owner' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {}
    if (role !== undefined) updates.role = role
    if (allowed_pages !== undefined) updates.allowed_pages = allowed_pages

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const { error: updateErr } = await admin
      .from('user_profiles')
      .update(updates)
      .eq('id', user_id)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    const msg = (e as Error).message
    if (msg === 'Unauthorized') return NextResponse.json({ error: msg }, { status: 401 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── DELETE: Remove a member ───────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const caller = await getUserProfile()
    if (caller.role !== 'owner') return forbidden()

    const body = await req.json()
    const { user_id } = body as { user_id: string }

    if (!user_id) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
    }
    if (user_id === caller.id) {
      return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Verify target is in the same tenant
    const { data: target } = await admin
      .from('user_profiles')
      .select('tenant_id, role')
      .eq('id', user_id)
      .single()

    if (!target || target.tenant_id !== caller.tenantId) {
      return NextResponse.json({ error: 'User not found in your workspace' }, { status: 404 })
    }
    if (target.role === 'owner') {
      return NextResponse.json({ error: 'Cannot remove an owner' }, { status: 400 })
    }

    // Delete profile first, then auth user
    await admin.from('user_profiles').delete().eq('id', user_id)
    await admin.auth.admin.deleteUser(user_id)

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    const msg = (e as Error).message
    if (msg === 'Unauthorized') return NextResponse.json({ error: msg }, { status: 401 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
