import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

type ReportType = 'orders' | 'returns' | 'pnl' | 'settlement'

interface FileSpec {
  fileKey: string
  marketplaceAccountId: string | null
  dateRange: { from: string; to: string }
}

interface RequestBody {
  reportType: ReportType
  files: FileSpec[]
}

interface OverlapResult {
  fileKey: string
  existingRowCount: number
  sampleExistingDate?: string
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const body = (await request.json()) as RequestBody

    if (!body || !body.reportType || !Array.isArray(body.files)) {
      return NextResponse.json({ error: 'reportType and files are required' }, { status: 400 })
    }

    const overlaps: OverlapResult[] = []

    for (const file of body.files) {
      const { fileKey, marketplaceAccountId, dateRange } = file
      if (!dateRange?.from || !dateRange?.to) {
        overlaps.push({ fileKey, existingRowCount: 0 })
        continue
      }

      let count = 0
      let sampleDate: string | undefined

      if (body.reportType === 'orders') {
        if (!marketplaceAccountId) {
          overlaps.push({ fileKey, existingRowCount: 0 })
          continue
        }
        const { data, count: c } = await supabase
          .from('orders')
          .select('order_date', { count: 'exact', head: false })
          .eq('tenant_id', tenantId)
          .eq('marketplace_account_id', marketplaceAccountId)
          .gte('order_date', dateRange.from)
          .lte('order_date', dateRange.to)
          .order('order_date', { ascending: true })
          .limit(1)
        count = c ?? 0
        sampleDate = (data?.[0] as { order_date?: string } | undefined)?.order_date
      } else if (body.reportType === 'pnl') {
        if (!marketplaceAccountId) {
          overlaps.push({ fileKey, existingRowCount: 0 })
          continue
        }
        // Count order_financials rows linked to orders in this account+range
        const { data: orderIds } = await supabase
          .from('orders')
          .select('id, order_date')
          .eq('tenant_id', tenantId)
          .eq('marketplace_account_id', marketplaceAccountId)
          .gte('order_date', dateRange.from)
          .lte('order_date', dateRange.to)
          .order('order_date', { ascending: true })
          .limit(1000)
        const ids = (orderIds ?? []).map((o: { id: string }) => o.id)
        if (ids.length === 0) {
          overlaps.push({ fileKey, existingRowCount: 0 })
          continue
        }
        const { count: c } = await supabase
          .from('order_financials')
          .select('order_id', { count: 'exact', head: true })
          .in('order_id', ids)
        count = c ?? 0
        sampleDate = (orderIds?.[0] as { order_date?: string } | undefined)?.order_date
      } else if (body.reportType === 'returns') {
        const { data, count: c } = await supabase
          .from('orders')
          .select('return_request_date', { count: 'exact', head: false })
          .eq('tenant_id', tenantId)
          .not('return_request_date', 'is', null)
          .gte('return_request_date', dateRange.from)
          .lte('return_request_date', dateRange.to)
          .order('return_request_date', { ascending: true })
          .limit(1)
        count = c ?? 0
        sampleDate = (data?.[0] as { return_request_date?: string } | undefined)?.return_request_date
      } else if (body.reportType === 'settlement') {
        const { data, count: c } = await supabase
          .from('orders')
          .select('settlement_date', { count: 'exact', head: false })
          .eq('tenant_id', tenantId)
          .not('settlement_date', 'is', null)
          .gte('settlement_date', dateRange.from)
          .lte('settlement_date', dateRange.to)
          .order('settlement_date', { ascending: true })
          .limit(1)
        count = c ?? 0
        sampleDate = (data?.[0] as { settlement_date?: string } | undefined)?.settlement_date
      }

      overlaps.push({ fileKey, existingRowCount: count, sampleExistingDate: sampleDate })
    }

    return NextResponse.json({ overlaps })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('[pnl/bulk-overlap-check]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
