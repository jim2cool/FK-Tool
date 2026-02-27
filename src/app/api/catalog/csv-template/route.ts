import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = await getTenantId()

    const { data: accounts } = await supabase
      .from('marketplace_accounts')
      .select('platform, account_name')
      .eq('tenant_id', tenantId)
      .order('platform')
      .order('account_name')

    const header = 'Master Product/SKU,Variant Name,Channel,Account,SKU ID'

    const exampleRows = [
      '9 in 1 Electric Brush,,flipkart,Buzznest Main,FK9823411',
      '9 in 1 Electric Brush,,amazon,Buzznest AMZ,B0CXYZ123',
      'Portable Vacuum Cleaner,White,flipkart,Buzznest Main,FK1122334',
      'Portable Vacuum Cleaner,Black,flipkart,Buzznest Main,FK1122335',
    ]

    const accountLines: string[] = []
    if (accounts && accounts.length > 0) {
      accountLines.push('# --- Configured accounts (use exact values below) ---')
      for (const a of accounts) {
        accountLines.push(`# Channel: ${a.platform}  |  Account: ${a.account_name}`)
      }
    }

    const lines = [header, ...exampleRows, ...(accountLines.length ? ['', ...accountLines] : [])]
    const csv = lines.join('\n')

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="catalog-template.csv"',
      },
    })
  } catch (err) {
    console.error('[csv-template] error:', err)
    return NextResponse.json({ error: 'Failed to generate template' }, { status: 500 })
  }
}
