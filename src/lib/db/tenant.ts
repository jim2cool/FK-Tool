import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types/database'

export async function getTenantId(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data } = await supabase.from('user_profiles')
    .select('tenant_id').eq('id', user.id).single()
  if (!data) throw new Error('Profile not found')
  return data.tenant_id
}

export interface CurrentUser {
  id: string
  tenantId: string
  email: string
  role: UserRole
  allowedPages: string[] | null
}

export async function getUserProfile(): Promise<CurrentUser> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data } = await supabase.from('user_profiles')
    .select('id, tenant_id, email, role, allowed_pages')
    .eq('id', user.id).single()
  if (!data) throw new Error('Profile not found')
  return {
    id: data.id,
    tenantId: data.tenant_id,
    email: data.email,
    role: data.role,
    allowedPages: data.allowed_pages,
  }
}
