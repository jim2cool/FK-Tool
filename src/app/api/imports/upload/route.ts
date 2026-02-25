import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseFile } from '@/lib/parser/reader'
import { detectFileType } from '@/lib/parser/fingerprint'
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
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['csv', 'xlsx', 'xls'].includes(ext ?? '')) {
      return NextResponse.json({ error: 'Unsupported file type. Use CSV, XLSX, or XLS.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // Parse file and detect type
    const parsed = await parseFile(buffer, file.name)
    const detection = detectFileType(parsed.headers)

    // Create import record first to get an ID
    const admin = createAdminClient()
    const filePath = `${tenantId}/${Date.now()}-${file.name}`

    const { data: importRecord, error: importError } = await admin
      .from('imports')
      .insert({
        tenant_id: tenantId,
        file_name: file.name,
        file_path: filePath,
        detected_marketplace: detection.platform,
        detected_report_type: detection.reportType,
        status: 'pending',
        imported_by: user.id,
      })
      .select('id')
      .single()

    if (importError || !importRecord) {
      return NextResponse.json({ error: importError?.message ?? 'Failed to create import record' }, { status: 500 })
    }

    // Upload file to Supabase Storage
    const { error: storageError } = await admin.storage
      .from('imports')
      .upload(filePath, buffer, { contentType: file.type || 'application/octet-stream' })

    if (storageError) {
      // Clean up import record
      await admin.from('imports').delete().eq('id', importRecord.id)
      return NextResponse.json({ error: `Storage upload failed: ${storageError.message}` }, { status: 500 })
    }

    return NextResponse.json({
      importId: importRecord.id,
      detection,
      preview: parsed.rawPreview,
      totalRows: parsed.rows.length,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
