import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/db/tenant'
import { createClient } from '@/lib/supabase/server'
import type { ParsedPurchaseRow } from '@/lib/importers/purchases-csv-parser'

function fingerprint(
  skuId: string,
  warehouseId: string,
  date: string,
  qty: number,
  rate: number,
  supplier: string,
) {
  return `${skuId}|${warehouseId}|${date}|${qty}|${rate}|${(supplier ?? '').toLowerCase().trim()}`
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = await getTenantId()
    const { rows } = (await req.json()) as { rows: ParsedPurchaseRow[] }

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ duplicateRowIndices: [] })
    }

    const supabase = await createClient()

    // Warehouse name → id map
    const { data: warehouses } = await supabase
      .from('warehouses')
      .select('id, name')
      .eq('tenant_id', tenantId)

    const warehouseMap = new Map<string, string>()
    for (const w of warehouses ?? []) warehouseMap.set(w.name.toLowerCase(), w.id)

    // SKU name + parent_id → sku id map
    const { data: allSkus } = await supabase
      .from('master_skus')
      .select('id, name, parent_id')
      .eq('tenant_id', tenantId)

    const skuMap = new Map<string, string>() // `${name_lc}|${parentId ?? 'null'}` → id
    for (const s of allSkus ?? []) {
      skuMap.set(`${s.name.toLowerCase()}|${s.parent_id ?? 'null'}`, s.id)
    }

    // Resolve each valid row to a fingerprint
    type FpEntry = { rowIndex: number; fp: string | null }
    const fpEntries: FpEntry[] = []

    for (const row of rows) {
      if (row.error) { fpEntries.push({ rowIndex: row.rowIndex, fp: null }); continue }

      const warehouseId = warehouseMap.get(row.warehouseName.toLowerCase())
      if (!warehouseId) { fpEntries.push({ rowIndex: row.rowIndex, fp: null }); continue }

      let skuId: string | undefined
      if (row.variant) {
        const parentId = skuMap.get(`${row.master.toLowerCase()}|null`)
        if (!parentId) { fpEntries.push({ rowIndex: row.rowIndex, fp: null }); continue }
        skuId = skuMap.get(`${row.variant.toLowerCase()}|${parentId}`)
      } else {
        skuId = skuMap.get(`${row.master.toLowerCase()}|null`)
      }

      if (!skuId) { fpEntries.push({ rowIndex: row.rowIndex, fp: null }); continue }

      fpEntries.push({
        rowIndex: row.rowIndex,
        fp: fingerprint(skuId, warehouseId, row.date, row.qty, row.ratePerUnit, row.vendorName),
      })
    }

    // Collect unique SKU IDs + dates to narrow the DB query
    const resolvedEntries = fpEntries.filter((e) => e.fp !== null)
    if (resolvedEntries.length === 0) {
      return NextResponse.json({ duplicateRowIndices: [] })
    }

    const skuIds = [...new Set(resolvedEntries.map((e) => e.fp!.split('|')[0]))]
    const dates  = [...new Set(resolvedEntries.map((e) => e.fp!.split('|')[2]))]

    // Fetch existing purchases matching those SKUs + dates
    const { data: existing } = await supabase
      .from('purchases')
      .select('master_sku_id, warehouse_id, purchase_date, quantity, unit_purchase_price, supplier')
      .eq('tenant_id', tenantId)
      .in('master_sku_id', skuIds)
      .in('purchase_date', dates)

    const existingFps = new Set<string>()
    for (const p of existing ?? []) {
      existingFps.add(
        fingerprint(p.master_sku_id, p.warehouse_id, p.purchase_date, p.quantity, p.unit_purchase_price, p.supplier ?? '')
      )
    }

    // Mark duplicates: DB matches + within-file repeated rows
    const duplicateRowIndices: number[] = []
    const seenFps = new Set<string>()

    for (const { rowIndex, fp } of fpEntries) {
      if (!fp) continue
      if (existingFps.has(fp) || seenFps.has(fp)) {
        duplicateRowIndices.push(rowIndex)
      }
      seenFps.add(fp)
    }

    return NextResponse.json({ duplicateRowIndices })
  } catch (e: unknown) {
    const msg = (e as Error).message
    if (msg === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('[purchases/check-duplicates]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
