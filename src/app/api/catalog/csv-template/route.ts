import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

const PLATFORM_LABEL: Record<string, string> = {
  flipkart: 'Flipkart',
  amazon: 'Amazon',
  d2c: 'D2C',
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const tenantId = await getTenantId()

    // Fetch configured marketplace accounts and warehouses
    const [{ data: accounts }, { data: warehouses }] = await Promise.all([
      supabase
        .from('marketplace_accounts')
        .select('id, platform, account_name')
        .eq('tenant_id', tenantId)
        .order('platform')
        .order('account_name'),
      supabase
        .from('warehouses')
        .select('id, name, location')
        .eq('tenant_id', tenantId)
        .order('name'),
    ])

    // ─── Build column headers ────────────────────────────────────────────────
    const fixedHeaders = ['Master SKU Name', 'Parent Product']

    // One column per account: "Flipkart SKU - Buzznest Main"
    // Fall back to generic platform columns if no accounts configured
    const accountHeaders: string[] = accounts && accounts.length > 0
      ? accounts.map(a => `${PLATFORM_LABEL[a.platform] ?? a.platform} SKU - ${a.account_name}`)
      : ['Flipkart SKU', 'Amazon SKU', 'D2C SKU']

    const headers = [...fixedHeaders, ...accountHeaders]

    // ─── Build sample data rows ──────────────────────────────────────────────
    const row1: Record<string, string> = { 'Master SKU Name': 'Example-SKU-001', 'Parent Product': '' }
    const row2: Record<string, string> = { 'Master SKU Name': 'Example-Variant-White-L', 'Parent Product': 'Example-Parent-Product' }
    const row3: Record<string, string> = { 'Master SKU Name': 'Example-Variant-White-M', 'Parent Product': 'Example-Parent-Product' }

    accountHeaders.forEach((col, i) => {
      row1[col] = `SAMPLE-SKU-${String(i + 1).padStart(3, '0')}`
      row2[col] = i === 0 ? 'VARIANT-SKU-001' : ''
      row3[col] = i === 0 ? 'VARIANT-SKU-002' : ''
    })

    // ─── Build reference section (rows starting with # are skipped on import) ─
    const refRows: Record<string, string>[] = [
      // Spacer + section header
      makeRef('# ─── REFERENCE: Valid values for your setup (these rows are auto-skipped on import) ───'),
      makeRef('#'),
      // Channels
      makeRef('# CHANNELS (fixed): Flipkart | Amazon | D2C'),
      makeRef('#'),
    ]

    // Accounts grouped by platform
    if (accounts && accounts.length > 0) {
      const byPlatform: Record<string, string[]> = {}
      for (const a of accounts) {
        if (!byPlatform[a.platform]) byPlatform[a.platform] = []
        byPlatform[a.platform].push(a.account_name)
      }
      refRows.push(makeRef('# ACCOUNTS (use exact name in column header):'))
      for (const [platform, names] of Object.entries(byPlatform)) {
        refRows.push(makeRef(`#   ${PLATFORM_LABEL[platform] ?? platform}: ${names.join(' | ')}`))
      }
      refRows.push(makeRef('#'))
    } else {
      refRows.push(makeRef('# ACCOUNTS: No accounts configured yet — go to Settings → Marketplace Accounts'))
      refRows.push(makeRef('#'))
    }

    // Warehouses
    if (warehouses && warehouses.length > 0) {
      const whList = warehouses.map(w => w.location ? `${w.name} (${w.location})` : w.name).join(' | ')
      refRows.push(makeRef('# WAREHOUSES (configured in your system):'))
      refRows.push(makeRef(`#   ${whList}`))
      refRows.push(makeRef('#   Note: warehouse is assigned via Purchases, not this CSV'))
    } else {
      refRows.push(makeRef('# WAREHOUSES: No warehouses configured yet — go to Settings → Warehouses'))
    }

    // ─── Serialize to CSV ────────────────────────────────────────────────────
    function serializeRow(rowData: Record<string, string>): string {
      return headers.map(h => escapeCell(rowData[h] ?? '')).join(',')
    }

    const csvLines = [
      headers.map(escapeCell).join(','),         // header row
      serializeRow(row1),
      serializeRow(row2),
      serializeRow(row3),
      headers.map(() => '').join(','),             // blank separator
      ...refRows.map(serializeRow),
    ]

    const csv = csvLines.join('\r\n')

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sku-import-template.csv"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

/** Creates a reference row: first column gets the comment text, rest are empty */
function makeRef(comment: string): Record<string, string> {
  return { 'Master SKU Name': comment }
}

function escapeCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
