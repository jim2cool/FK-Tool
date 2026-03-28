import { NextResponse } from 'next/server'
import { getUserProfile } from '@/lib/db/tenant'

export async function GET() {
  try {
    const profile = await getUserProfile()
    return NextResponse.json({
      id: profile.id,
      email: profile.email,
      role: profile.role,
      allowed_pages: profile.allowedPages,
      tenant_id: profile.tenantId,
    })
  } catch (e: unknown) {
    const msg = (e as Error).message
    if (msg === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
