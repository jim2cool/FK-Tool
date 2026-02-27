import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

const LABELS_ROW = [
  'Mandatory', 'Mandatory', 'Optional', 'Mandatory',
  'Optional - Will link to Taxation',
  'Mandatory - Default 18%',
  'Mandatory (Y/N)',
  'Mandatory',
  'Mandatory',
  'Optional',
  'Mandatory',
].join(',')

const HEADERS_ROW = [
  'Receipt Date',
  'Master Product',
  'Variant',
  'Qty.',
  'HSN Code',
  'GST Rate Slab',
  'Tax Paid (Y/N)',
  'Rate Per Unit (without Taxes)',
  'Vendor Name',
  'Invoice Number (Optional)',
  'Warehouse',
].join(',')

const EXAMPLE_ROW = [
  '27/06/2025',
  'Video Making Kit',
  '',
  '10',
  '',
  '18%',
  'Y',
  '200',
  'Rudra Enterprises',
  'RA/25-26/316',
  'GGN 1',
].join(',')

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()

    // Fetch existing master SKUs for reference
    const { data: skus } = await supabase
      .from('master_skus')
      .select('name, parent_id')
      .eq('tenant_id', tenantId)
      .order('name')

    // Fetch warehouses for reference
    const { data: warehouses } = await supabase
      .from('warehouses')
      .select('name')
      .eq('tenant_id', tenantId)
      .order('name')

    const lines: string[] = [LABELS_ROW, HEADERS_ROW, EXAMPLE_ROW, '']

    // Product reference section
    if (skus && skus.length > 0) {
      lines.push('# ── Existing Products (for reference — delete these rows before uploading) ──')
      const seen = new Set<string>()
      for (const s of skus) {
        if (!seen.has(s.name)) {
          seen.add(s.name)
          lines.push(`# ${s.name}`)
        }
      }
    }

    // Warehouse reference section
    if (warehouses && warehouses.length > 0) {
      lines.push('# ── Warehouses ──')
      for (const w of warehouses) {
        lines.push(`# ${w.name}`)
      }
    }

    const csv = lines.join('\r\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="purchases-template.csv"',
      },
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
