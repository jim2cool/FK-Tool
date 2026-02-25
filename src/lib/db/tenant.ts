import { createClient } from '@/lib/supabase/server'

export async function getTenantId(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data } = await supabase.from('user_profiles')
    .select('tenant_id').eq('id', user.id).single()
  if (!data) throw new Error('Profile not found')
  return data.tenant_id
}
