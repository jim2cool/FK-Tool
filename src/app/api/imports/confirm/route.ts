import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseFile } from '@/lib/parser/reader'
import { processDispatchReport } from '@/lib/importers/dispatch-importer'
import { processListingsSettlement } from '@/lib/importers/listings-importer'
import { processHistoricalOrders } from '@/lib/importers/historical-orders-importer'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles').select('tenant_id').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
  const tenantId = profile.tenant_id

  try {
    const { importId, marketplace, reportType, marketplaceAccountId } = await request.json()
    if (!importId || !marketplace || !reportType) {
      return NextResponse.json({ error: 'importId, marketplace, and reportType are required' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Fetch the import record
    const { data: importRecord, error: fetchError } = await admin
      .from('imports')
      .select('*')
      .eq('id', importId)
      .eq('tenant_id', tenantId)
      .single()

    if (fetchError || !importRecord) {
      return NextResponse.json({ error: 'Import record not found' }, { status: 404 })
    }

    // Update to processing
    await admin.from('imports').update({
      confirmed_marketplace: marketplace,
      confirmed_report_type: reportType,
      status: 'processing',
    }).eq('id', importId)

    // Download file from Storage
    const { data: fileData, error: downloadError } = await admin.storage
      .from('imports')
      .download(importRecord.file_path)

    if (downloadError || !fileData) {
      await admin.from('imports').update({ status: 'failed', error_log: downloadError?.message }).eq('id', importId)
      return NextResponse.json({ error: 'Failed to download file from storage' }, { status: 500 })
    }

    const buffer = Buffer.from(await fileData.arrayBuffer())
    const parsed = await parseFile(buffer, importRecord.file_name)

    // Run appropriate importer
    let result = { processed: 0, failed: 0, errors: [] as string[] }
    if (reportType === 'dispatch_report') {
      result = await processDispatchReport(parsed.rows, importId, tenantId, marketplaceAccountId ?? '')
    } else if (reportType === 'listings_settlement') {
      result = await processListingsSettlement(parsed.rows, importId, tenantId, marketplaceAccountId ?? '')
    } else if (reportType === 'historical_orders') {
      result = await processHistoricalOrders(parsed.rows, importId, tenantId, marketplaceAccountId ?? '')
    } else {
      await admin.from('imports').update({ status: 'failed', error_log: `Unknown report type: ${reportType}` }).eq('id', importId)
      return NextResponse.json({ error: `Unsupported report type: ${reportType}` }, { status: 400 })
    }

    // Update import record
    await admin.from('imports').update({
      status: result.failed > 0 && result.processed === 0 ? 'failed' : 'complete',
      rows_processed: result.processed,
      rows_failed: result.failed,
      error_log: result.errors.length > 0 ? result.errors.slice(0, 20).join('\n') : null,
    }).eq('id', importId)

    return NextResponse.json({
      importId,
      processed: result.processed,
      failed: result.failed,
      errors: result.errors.slice(0, 10),
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
