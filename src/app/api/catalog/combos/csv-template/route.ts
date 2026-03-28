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

    // Load master SKUs for reference comments
    const { data: skus } = await supabase
      .from('master_skus')
      .select('name')
      .eq('tenant_id', tenantId)
      .order('name')

    // Load marketplace accounts for reference comments
    const { data: accounts } = await supabase
      .from('marketplace_accounts')
      .select('platform, account_name')
      .eq('tenant_id', tenantId)
      .order('platform')
      .order('account_name')

    const header = 'Combo Name,Component SKU,Qty,Channel,Account,Platform SKU'

    const exampleRows = [
      'Soap 3-Pack,Neem Soap,3,Flipkart,NuvioCentral,FK-SOAP3PK',
      'Gift Box,Neem Soap,1,Flipkart,NuvioCentral,FK-GIFTBOX',
      'Gift Box,Tulsi Soap,1,,,',
      'Gift Box,Shampoo,1,Amazon,Nuvio,AMZ-GIFTBOX',
    ]

    const refLines: string[] = ['']

    // List existing products
    if (skus && skus.length > 0) {
      refLines.push('# --- Existing Products (use exact names for Component SKU) ---')
      for (const s of skus) {
        refLines.push(`# ${s.name}`)
      }
      refLines.push('')
    }

    // List configured accounts
    if (accounts && accounts.length > 0) {
      refLines.push('# --- Configured Accounts (use exact values) ---')
      for (const a of accounts) {
        refLines.push(`# Channel: ${a.platform}  |  Account: ${a.account_name}`)
      }
    }

    const lines = [header, ...exampleRows, ...refLines]
    const csv = lines.join('\n')

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="combo-import-template.csv"',
      },
    })
  } catch (err) {
    console.error('[combos/csv-template] error:', err)
    return NextResponse.json({ error: 'Failed to generate template' }, { status: 500 })
  }
}
