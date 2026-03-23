# Catalog Simplification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the multi-step column-mapping CSV import with a fixed-column single-screen importer, and overhaul the catalog page with SKU-ID search, 4 filters, pagination, and full inline editing.

**Architecture:** All changes are in application logic only — no new DB tables, no schema changes. The importer validates (Channel + Account) against `marketplace_accounts` so new channels work automatically. Warehouse data stays read-only from Procurement.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (ANON KEY + RLS), PapaParse, Tailwind v4, shadcn/Radix UI

---

### Task 1: Rewrite `src/lib/importers/sku-mapping-importer.ts`

**Files:**
- Modify: `src/lib/importers/sku-mapping-importer.ts`

**Step 1: Read the existing file to understand the interface surface**

```bash
# Already read — CsvColumnMapping interface + importSkuMappingCsv function
# We will replace the entire file
```

**Step 2: Write the new importer**

Replace the entire file with:

```typescript
import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/client'

// ─── Fixed column names ─────────────────────────────────────────────────────
export const COL_MASTER   = 'Master Product/SKU'
export const COL_VARIANT  = 'Variant Name'
export const COL_CHANNEL  = 'Channel'
export const COL_ACCOUNT  = 'Account'
export const COL_SKU_ID   = 'SKU ID'

export const REQUIRED_COLUMNS = [COL_MASTER, COL_CHANNEL, COL_ACCOUNT, COL_SKU_ID] as const

// ─── Result types ────────────────────────────────────────────────────────────
export interface ParsedRow {
  rowIndex: number        // 1-based (matches spreadsheet row numbers)
  master: string
  variant: string         // empty string if not provided
  channel: string
  account: string
  skuId: string
  error?: string          // present when row is invalid
}

export interface ImportResult {
  created: number
  updated: number
  skipped: number
  errors: Array<{ row: number; reason: string }>
}

// ─── Client-side parse (for preview in dialog) ──────────────────────────────
export function parseCatalogCsv(csvText: string): ParsedRow[] {
  const { data, errors } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  })

  if (errors.length) {
    console.warn('CSV parse warnings:', errors)
  }

  const rows: ParsedRow[] = []
  let rowIndex = 1 // header is row 1; first data row is row 2

  for (const raw of data) {
    rowIndex++

    // Skip comment rows
    const firstVal = Object.values(raw)[0] ?? ''
    if (firstVal.startsWith('#')) continue

    const master  = (raw[COL_MASTER]  ?? '').trim()
    const variant = (raw[COL_VARIANT] ?? '').trim()
    const channel = (raw[COL_CHANNEL] ?? '').trim().toLowerCase()
    const account = (raw[COL_ACCOUNT] ?? '').trim()
    const skuId   = (raw[COL_SKU_ID]  ?? '').trim()

    const missingFields: string[] = []
    if (!master)  missingFields.push(COL_MASTER)
    if (!channel) missingFields.push(COL_CHANNEL)
    if (!account) missingFields.push(COL_ACCOUNT)
    if (!skuId)   missingFields.push(COL_SKU_ID)

    if (missingFields.length) {
      rows.push({
        rowIndex, master, variant, channel, account, skuId,
        error: `Missing required fields: ${missingFields.join(', ')}`,
      })
      continue
    }

    rows.push({ rowIndex, master, variant, channel, account, skuId })
  }

  return rows
}

// ─── Server-side import (called from API route) ──────────────────────────────
export async function importCatalogCsv(
  csvText: string,
  tenantId: string,
): Promise<ImportResult> {
  const supabase = createClient()
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }

  // 1. Load all marketplace_accounts for this tenant → build lookup map
  const { data: accounts, error: acctErr } = await supabase
    .from('marketplace_accounts')
    .select('id, platform, account_name')
    .eq('tenant_id', tenantId)

  if (acctErr) throw new Error(`Failed to load accounts: ${acctErr.message}`)

  // key: "platform|account_name" (both lowercased)
  const accountMap = new Map<string, { id: string; platform: string }>(
    (accounts ?? []).map((a) => [
      `${a.platform.toLowerCase()}|${a.account_name.toLowerCase()}`,
      { id: a.id, platform: a.platform },
    ]),
  )

  // 2. Parse rows
  const rows = parseCatalogCsv(csvText)

  for (const row of rows) {
    // Skip rows with parse-level errors
    if (row.error) {
      result.skipped++
      result.errors.push({ row: row.rowIndex, reason: row.error })
      continue
    }

    // 3. Validate (channel + account) pair
    const acctKey = `${row.channel.toLowerCase()}|${row.account.toLowerCase()}`
    const acctMatch = accountMap.get(acctKey)

    if (!acctMatch) {
      result.skipped++
      result.errors.push({
        row: row.rowIndex,
        reason: `'${row.channel} / ${row.account}' not found in Settings`,
      })
      continue
    }

    // 4. Upsert master_sku
    let masterSkuId: string

    if (row.variant) {
      // Variant: find/create parent first, then find/create variant child
      const { data: parentRows, error: pErr } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', row.master)
        .is('parent_id', null)
        .limit(1)

      if (pErr) {
        result.skipped++
        result.errors.push({ row: row.rowIndex, reason: pErr.message })
        continue
      }

      let parentId: string
      if (parentRows && parentRows.length > 0) {
        parentId = parentRows[0].id
      } else {
        const { data: newParent, error: npErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: row.master, parent_id: null })
          .select('id')
          .single()
        if (npErr || !newParent) {
          result.skipped++
          result.errors.push({ row: row.rowIndex, reason: npErr?.message ?? 'Failed to create parent SKU' })
          continue
        }
        parentId = newParent.id
      }

      // Find/create variant child
      const { data: variantRows, error: vErr } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', row.variant)
        .eq('parent_id', parentId)
        .limit(1)

      if (vErr) {
        result.skipped++
        result.errors.push({ row: row.rowIndex, reason: vErr.message })
        continue
      }

      if (variantRows && variantRows.length > 0) {
        masterSkuId = variantRows[0].id
      } else {
        const { data: newVariant, error: nvErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: row.variant, parent_id: parentId })
          .select('id')
          .single()
        if (nvErr || !newVariant) {
          result.skipped++
          result.errors.push({ row: row.rowIndex, reason: nvErr?.message ?? 'Failed to create variant SKU' })
          continue
        }
        masterSkuId = newVariant.id
      }
    } else {
      // Flat SKU: find/create by name with no parent
      const { data: existing, error: eErr } = await supabase
        .from('master_skus')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', row.master)
        .is('parent_id', null)
        .limit(1)

      if (eErr) {
        result.skipped++
        result.errors.push({ row: row.rowIndex, reason: eErr.message })
        continue
      }

      if (existing && existing.length > 0) {
        masterSkuId = existing[0].id
      } else {
        const { data: newSku, error: nsErr } = await supabase
          .from('master_skus')
          .insert({ tenant_id: tenantId, name: row.master, parent_id: null })
          .select('id')
          .single()
        if (nsErr || !newSku) {
          result.skipped++
          result.errors.push({ row: row.rowIndex, reason: nsErr?.message ?? 'Failed to create SKU' })
          continue
        }
        masterSkuId = newSku.id
      }
    }

    // 5. Upsert sku_mapping — key: (tenant_id, platform, platform_sku)
    const { data: existingMapping } = await supabase
      .from('sku_mappings')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('platform', acctMatch.platform)
      .eq('platform_sku', row.skuId)
      .limit(1)

    if (existingMapping && existingMapping.length > 0) {
      const { error: upErr } = await supabase
        .from('sku_mappings')
        .update({
          master_sku_id: masterSkuId,
          marketplace_account_id: acctMatch.id,
        })
        .eq('id', existingMapping[0].id)

      if (upErr) {
        result.skipped++
        result.errors.push({ row: row.rowIndex, reason: upErr.message })
      } else {
        result.updated++
      }
    } else {
      const { error: insErr } = await supabase
        .from('sku_mappings')
        .insert({
          tenant_id: tenantId,
          master_sku_id: masterSkuId,
          platform: acctMatch.platform,
          platform_sku: row.skuId,
          marketplace_account_id: acctMatch.id,
        })

      if (insErr) {
        result.skipped++
        result.errors.push({ row: row.rowIndex, reason: insErr.message })
      } else {
        result.created++
      }
    }
  }

  return result
}
```

**Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors related to `sku-mapping-importer.ts`

**Step 4: Commit**

```bash
git add src/lib/importers/sku-mapping-importer.ts
git commit -m "feat(catalog): rewrite importer — fixed 5-column format, no mapping step"
```

---

### Task 2: Simplify `src/app/api/catalog/import-csv/route.ts`

**Files:**
- Modify: `src/app/api/catalog/import-csv/route.ts`

**Step 1: Read the existing file**

Current content accepts `{ csv: string, mapping: CsvColumnMapping }`. We simplify to `{ csv: string }` only.

**Step 2: Write the new route**

Replace the entire file with:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { importCatalogCsv } from '@/lib/importers/sku-mapping-importer'

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient()

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get tenant_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 400 })
    }

    const body = await req.json()
    const { csv } = body as { csv: string }

    if (!csv || typeof csv !== 'string') {
      return NextResponse.json({ error: 'csv field is required' }, { status: 400 })
    }

    const result = await importCatalogCsv(csv, profile.tenant_id)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[import-csv] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Import failed' },
      { status: 500 },
    )
  }
}
```

**Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -40
```

**Step 4: Commit**

```bash
git add src/app/api/catalog/import-csv/route.ts
git commit -m "feat(catalog): simplify import-csv route — accept {csv} only, drop mapping param"
```

---

### Task 3: Rewrite `src/app/api/catalog/csv-template/route.ts`

**Files:**
- Modify: `src/app/api/catalog/csv-template/route.ts`

**Step 1: Read the existing file**

Currently generates dynamic per-account columns like `"Flipkart SKU - Buzznest Main"`. Replace with fixed 5-column template plus reference comment rows showing configured accounts.

**Step 2: Write the new route**

Replace the entire file with:

```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { COL_MASTER, COL_VARIANT, COL_CHANNEL, COL_ACCOUNT, COL_SKU_ID } from '@/lib/importers/sku-mapping-importer'

export async function GET() {
  try {
    const supabase = createClient()

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 400 })
    }

    // Load configured accounts for reference rows
    const { data: accounts } = await supabase
      .from('marketplace_accounts')
      .select('platform, account_name')
      .eq('tenant_id', profile.tenant_id)
      .order('platform')
      .order('account_name')

    const header = [COL_MASTER, COL_VARIANT, COL_CHANNEL, COL_ACCOUNT, COL_SKU_ID].join(',')

    // Example data rows
    const exampleRows = [
      `9 in 1 Electric Brush,,flipkart,Buzznest Main,FK9823411`,
      `9 in 1 Electric Brush,,amazon,Buzznest AMZ,B0CXYZ123`,
      `Portable Vacuum Cleaner,White,flipkart,Buzznest Main,FK1122334`,
      `Portable Vacuum Cleaner,Black,flipkart,Buzznest Main,FK1122335`,
    ]

    // Reference comment rows showing valid channel+account combinations
    const accountLines: string[] = []
    if (accounts && accounts.length > 0) {
      accountLines.push(`# --- Configured accounts (use exact values below) ---`)
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
```

**Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -40
```

**Step 4: Commit**

```bash
git add src/app/api/catalog/csv-template/route.ts
git commit -m "feat(catalog): fixed-column CSV template with account reference rows"
```

---

### Task 4: Rewrite `src/components/catalog/CsvImportDialog.tsx`

**Files:**
- Modify: `src/components/catalog/CsvImportDialog.tsx`

**Step 1: Understand the new dialog flow**

Three logical states:
- `idle` — dropzone + "Download Template" button
- `preview` — parsed rows table, valid rows in green, invalid in red with reason, "Import N →" button
- `results` — post-import summary: created / updated / skipped counts + error list

**Step 2: Write the new component**

Replace the entire file with:

```typescript
'use client'

import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Download, Upload, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { parseCatalogCsv, type ParsedRow, type ImportResult } from '@/lib/importers/sku-mapping-importer'

interface CsvImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete: () => void
}

type DialogState = 'idle' | 'preview' | 'importing' | 'results'

export function CsvImportDialog({ open, onOpenChange, onImportComplete }: CsvImportDialogProps) {
  const [state, setState] = useState<DialogState>('idle')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [csvText, setCsvText] = useState('')
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const validRows  = rows.filter((r) => !r.error)
  const invalidRows = rows.filter((r) => r.error)

  const reset = () => {
    setState('idle')
    setRows([])
    setCsvText('')
    setImportResult(null)
    setImportError(null)
  }

  const handleClose = () => {
    reset()
    onOpenChange(false)
  }

  const onDrop = useCallback((accepted: File[]) => {
    const file = accepted[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setCsvText(text)
      const parsed = parseCatalogCsv(text)
      setRows(parsed)
      setState('preview')
    }
    reader.readAsText(file)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
  })

  const handleDownloadTemplate = async () => {
    try {
      const res = await fetch('/api/catalog/csv-template')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'catalog-template.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      console.error('Failed to download template')
    }
  }

  const handleImport = async () => {
    if (!csvText || validRows.length === 0) return

    setState('importing')
    setImportError(null)

    try {
      const res = await fetch('/api/catalog/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText }),
      })

      const data = await res.json()

      if (!res.ok) {
        setImportError(data.error ?? 'Import failed')
        setState('preview')
        return
      }

      setImportResult(data as ImportResult)
      setState('results')
      onImportComplete()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
      setState('preview')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Bulk Import SKU Mappings</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">

          {/* ── IDLE ───────────────────────────────────────────────── */}
          {(state === 'idle') && (
            <>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="gap-2">
                <Download className="h-4 w-4" />
                Download Template
              </Button>

              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
                  isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
                }`}
              >
                <input {...getInputProps()} />
                <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {isDragActive ? 'Drop your CSV here' : 'Drag & drop your CSV here'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
              </div>
            </>
          )}

          {/* ── PREVIEW ────────────────────────────────────────────── */}
          {(state === 'preview' || state === 'importing') && (
            <>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">{rows.length} rows</span>
                {validRows.length > 0 && (
                  <Badge variant="outline" className="text-green-600 border-green-200">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {validRows.length} valid
                  </Badge>
                )}
                {invalidRows.length > 0 && (
                  <Badge variant="outline" className="text-destructive border-destructive/20">
                    <XCircle className="h-3 w-3 mr-1" />
                    {invalidRows.length} errors
                  </Badge>
                )}
              </div>

              {importError && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  {importError}
                </div>
              )}

              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium w-8">#</th>
                      <th className="px-3 py-2 text-left font-medium">Master Product</th>
                      <th className="px-3 py-2 text-left font-medium">Variant</th>
                      <th className="px-3 py-2 text-left font-medium">Channel</th>
                      <th className="px-3 py-2 text-left font-medium">Account</th>
                      <th className="px-3 py-2 text-left font-medium">SKU ID</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((row) => (
                      <tr
                        key={row.rowIndex}
                        className={row.error ? 'bg-destructive/5' : ''}
                      >
                        <td className="px-3 py-1.5 text-muted-foreground">{row.rowIndex}</td>
                        <td className="px-3 py-1.5">{row.master || <span className="text-muted-foreground italic">—</span>}</td>
                        <td className="px-3 py-1.5">{row.variant || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-1.5">{row.channel || <span className="text-muted-foreground italic">—</span>}</td>
                        <td className="px-3 py-1.5">{row.account || <span className="text-muted-foreground italic">—</span>}</td>
                        <td className="px-3 py-1.5">{row.skuId || <span className="text-muted-foreground italic">—</span>}</td>
                        <td className="px-3 py-1.5">
                          {row.error ? (
                            <span className="text-destructive text-xs">{row.error}</span>
                          ) : (
                            <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── RESULTS ────────────────────────────────────────────── */}
          {state === 'results' && importResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                {importResult.created > 0 && (
                  <div className="flex items-center gap-2 text-green-700">
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-medium">{importResult.created} created</span>
                  </div>
                )}
                {importResult.updated > 0 && (
                  <div className="flex items-center gap-2 text-blue-700">
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-medium">{importResult.updated} updated</span>
                  </div>
                )}
                {importResult.skipped > 0 && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <XCircle className="h-5 w-5" />
                    <span className="font-medium">{importResult.skipped} skipped</span>
                  </div>
                )}
              </div>

              {importResult.errors.length > 0 && (
                <div className="rounded-md border">
                  <div className="px-3 py-2 bg-muted/50 text-xs font-medium">Skipped rows</div>
                  <div className="divide-y max-h-48 overflow-y-auto">
                    {importResult.errors.map((e) => (
                      <div key={e.row} className="px-3 py-1.5 text-xs text-destructive">
                        Row {e.row}: {e.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          {state === 'idle' && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}

          {state === 'preview' && (
            <>
              <Button variant="outline" onClick={reset}>Back</Button>
              <Button
                onClick={handleImport}
                disabled={validRows.length === 0}
              >
                Import {validRows.length} row{validRows.length !== 1 ? 's' : ''} →
              </Button>
            </>
          )}

          {state === 'importing' && (
            <Button disabled>Importing…</Button>
          )}

          {state === 'results' && (
            <>
              <Button variant="outline" onClick={reset}>Import Another</Button>
              <Button onClick={handleClose}>View Catalog</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -40
```

**Step 4: Build check**

```bash
npm run build 2>&1 | tail -20
```

**Step 5: Commit**

```bash
git add src/components/catalog/CsvImportDialog.tsx
git commit -m "feat(catalog): rewrite import dialog — single-screen, no mapping step, preview + results"
```

---

### Task 5: Add PATCH to `src/app/api/catalog/sku-mappings/route.ts`

**Files:**
- Modify: `src/app/api/catalog/sku-mappings/route.ts`

**Step 1: Read the existing file to understand POST / DELETE patterns**

(Already read — POST creates, DELETE removes. Add PATCH for inline editing.)

**Step 2: Add the PATCH handler after the POST handler**

Add this function at the end of the file (before the last closing export):

```typescript
export async function PATCH(req: NextRequest) {
  try {
    const supabase = createClient()

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json({ error: 'No tenant found' }, { status: 400 })
    }

    const body = await req.json()
    const { id, platform, platform_sku, marketplace_account_id } = body as {
      id: string
      platform: string
      platform_sku: string
      marketplace_account_id: string
    }

    if (!id || !platform || !platform_sku || !marketplace_account_id) {
      return NextResponse.json({ error: 'id, platform, platform_sku, marketplace_account_id required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('sku_mappings')
      .update({ platform, platform_sku, marketplace_account_id })
      .eq('id', id)
      .eq('tenant_id', profile.tenant_id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('[sku-mappings PATCH] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

**Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -40
```

**Step 4: Commit**

```bash
git add src/app/api/catalog/sku-mappings/route.ts
git commit -m "feat(catalog): add PATCH to sku-mappings route for inline editing"
```

---

### Task 6: Overhaul `src/app/(dashboard)/catalog/page.tsx`

**Files:**
- Modify: `src/app/(dashboard)/catalog/page.tsx`

This is the largest task. The overhauled page must:
1. Fetch ALL non-archived master_skus with nested sku_mappings + warehouse_summaries from existing GET endpoint
2. Flatten into `DisplayRow[]` — one row per sku_mapping (unmapped master SKUs also get one row with no channel/account/skuId)
3. Client-side search (SKU ID substring), filters (Master Product / Channel / Account / Warehouse), pagination 50/page
4. Inline edit dialog: Master Product name, Channel, Account, SKU ID — PATCH to `/api/catalog/sku-mappings` + PATCH to `/api/catalog/master-skus` for name changes
5. Red banner for unmapped stock
6. "Bulk Import" button opening `CsvImportDialog`

**Step 1: Read the current page.tsx**

```bash
# Already read — ~500 line file. We replace in full.
```

**Step 2: Write the overhauled page**

Replace the entire file with:

```typescript
'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Label } from '@/components/ui/label'
import { AlertTriangle, Pencil, Upload, X } from 'lucide-react'
import { CsvImportDialog } from '@/components/catalog/CsvImportDialog'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WarehouseSummary {
  warehouse_id: string
  warehouse_name: string
  quantity: number
}

interface SkuMapping {
  id: string
  platform: string
  platform_sku: string
  marketplace_account_id: string
  marketplace_accounts?: {
    account_name: string
  } | null
}

interface MasterSku {
  id: string
  name: string
  parent_id: string | null
  sku_mappings: SkuMapping[]
  warehouse_summaries: WarehouseSummary[]
}

interface DisplayRow {
  // Master SKU
  masterSkuId: string
  masterSkuName: string
  parentName?: string       // if variant, the parent's name
  // Mapping (may be null for unmapped)
  mappingId?: string
  platform?: string
  platformSku?: string
  marketplaceAccountId?: string
  accountName?: string
  // Warehouse
  warehouseNames: string[]
  // Flags
  isUnmapped: boolean
}

interface Account {
  id: string
  platform: string
  account_name: string
}

const PAGE_SIZE = 50

// ─── Component ────────────────────────────────────────────────────────────────

export default function CatalogPage() {
  const [masterSkus, setMasterSkus] = useState<MasterSku[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [searchSkuId, setSearchSkuId]         = useState('')
  const [filterMaster, setFilterMaster]       = useState('__all__')
  const [filterChannel, setFilterChannel]     = useState('__all__')
  const [filterAccount, setFilterAccount]     = useState('__all__')
  const [filterWarehouse, setFilterWarehouse] = useState('__all__')

  // Pagination
  const [page, setPage] = useState(1)

  // Import dialog
  const [importOpen, setImportOpen] = useState(false)

  // Inline edit
  const [editRow, setEditRow]           = useState<DisplayRow | null>(null)
  const [editMasterName, setEditMasterName]   = useState('')
  const [editChannel, setEditChannel]         = useState('')
  const [editAccount, setEditAccount]         = useState('')
  const [editSkuId, setEditSkuId]             = useState('')
  const [editSaving, setEditSaving]           = useState(false)
  const [editError, setEditError]             = useState<string | null>(null)

  // Banner "show unmapped" filter
  const [showUnmappedOnly, setShowUnmappedOnly] = useState(false)

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [skuRes, acctRes] = await Promise.all([
        fetch('/api/catalog/master-skus'),
        fetch('/api/settings/marketplace-accounts'),
      ])
      const [skuData, acctData] = await Promise.all([skuRes.json(), acctRes.json()])
      setMasterSkus(skuData.masterSkus ?? skuData ?? [])
      setAccounts(acctData.accounts ?? acctData ?? [])
    } catch (err) {
      console.error('Failed to load catalog', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Flatten to DisplayRows ───────────────────────────────────────────────────

  const allDisplayRows = useMemo<DisplayRow[]>(() => {
    const rows: DisplayRow[] = []

    // Build parent name lookup
    const parentNames = new Map<string, string>()
    for (const s of masterSkus) {
      if (!s.parent_id) parentNames.set(s.id, s.name)
    }

    for (const sku of masterSkus) {
      // Skip parent-only entries (they're represented by their children)
      const isParent = masterSkus.some((s) => s.parent_id === sku.id)
      if (isParent) continue

      const warehouseNames = sku.warehouse_summaries
        .filter((w) => w.quantity > 0)
        .map((w) => w.warehouse_name)

      if (sku.sku_mappings.length === 0) {
        // Unmapped row
        rows.push({
          masterSkuId:   sku.id,
          masterSkuName: sku.name,
          parentName:    sku.parent_id ? parentNames.get(sku.parent_id) : undefined,
          warehouseNames,
          isUnmapped: true,
        })
      } else {
        for (const m of sku.sku_mappings) {
          rows.push({
            masterSkuId:          sku.id,
            masterSkuName:        sku.name,
            parentName:           sku.parent_id ? parentNames.get(sku.parent_id) : undefined,
            mappingId:            m.id,
            platform:             m.platform,
            platformSku:          m.platform_sku,
            marketplaceAccountId: m.marketplace_account_id,
            accountName:          m.marketplace_accounts?.account_name,
            warehouseNames,
            isUnmapped: false,
          })
        }
      }
    }

    return rows
  }, [masterSkus])

  // ── Derived filter options ───────────────────────────────────────────────────

  const masterOptions = useMemo(() => {
    const names = Array.from(new Set(
      allDisplayRows.map((r) => r.parentName ?? r.masterSkuName)
    )).sort()
    return names
  }, [allDisplayRows])

  const channelOptions = useMemo(() => {
    const channels = Array.from(new Set(
      allDisplayRows.map((r) => r.platform).filter(Boolean) as string[]
    )).sort()
    return channels
  }, [allDisplayRows])

  const accountOptions = useMemo(() => {
    const accts = Array.from(new Set(
      allDisplayRows.map((r) => r.accountName).filter(Boolean) as string[]
    )).sort()
    return accts
  }, [allDisplayRows])

  const warehouseOptions = useMemo(() => {
    const whs = Array.from(new Set(allDisplayRows.flatMap((r) => r.warehouseNames))).sort()
    return whs
  }, [allDisplayRows])

  // ── Unmapped count for banner ────────────────────────────────────────────────

  const unmappedCount = useMemo(
    () => allDisplayRows.filter((r) => r.isUnmapped && r.warehouseNames.length > 0).length,
    [allDisplayRows],
  )

  // ── Filtered + paginated rows ────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    let rows = allDisplayRows

    if (showUnmappedOnly) {
      rows = rows.filter((r) => r.isUnmapped && r.warehouseNames.length > 0)
    }

    if (searchSkuId) {
      const q = searchSkuId.toLowerCase()
      rows = rows.filter((r) => r.platformSku?.toLowerCase().includes(q))
    }

    if (filterMaster !== '__all__') {
      rows = rows.filter((r) => (r.parentName ?? r.masterSkuName) === filterMaster)
    }

    if (filterChannel !== '__all__') {
      rows = rows.filter((r) => r.platform === filterChannel)
    }

    if (filterAccount !== '__all__') {
      rows = rows.filter((r) => r.accountName === filterAccount)
    }

    if (filterWarehouse !== '__all__') {
      rows = rows.filter((r) => r.warehouseNames.includes(filterWarehouse))
    }

    return rows
  }, [allDisplayRows, showUnmappedOnly, searchSkuId, filterMaster, filterChannel, filterAccount, filterWarehouse])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const pagedRows  = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const hasActiveFilters =
    searchSkuId || filterMaster !== '__all__' || filterChannel !== '__all__' ||
    filterAccount !== '__all__' || filterWarehouse !== '__all__' || showUnmappedOnly

  const clearFilters = () => {
    setSearchSkuId('')
    setFilterMaster('__all__')
    setFilterChannel('__all__')
    setFilterAccount('__all__')
    setFilterWarehouse('__all__')
    setShowUnmappedOnly(false)
    setPage(1)
  }

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [searchSkuId, filterMaster, filterChannel, filterAccount, filterWarehouse, showUnmappedOnly])

  // ── Inline edit helpers ──────────────────────────────────────────────────────

  const openEdit = (row: DisplayRow) => {
    setEditRow(row)
    setEditMasterName(row.parentName ? `${row.parentName} — ${row.masterSkuName}` : row.masterSkuName)
    setEditChannel(row.platform ?? '')
    setEditAccount(row.accountName ?? '')
    setEditSkuId(row.platformSku ?? '')
    setEditError(null)
  }

  const handleEditSave = async () => {
    if (!editRow) return
    setEditSaving(true)
    setEditError(null)

    try {
      // Resolve account id from channel + account name
      const acct = accounts.find(
        (a) => a.platform === editChannel && a.account_name === editAccount
      )

      if (!acct) {
        setEditError(`'${editChannel} / ${editAccount}' not found in Settings`)
        setEditSaving(false)
        return
      }

      // Update master SKU name if it changed (flat name only, not variant label)
      const displayName = editRow.parentName
        ? editRow.masterSkuName  // variant — don't edit the composite display
        : editMasterName

      if (!editRow.parentName && displayName !== editRow.masterSkuName) {
        const res = await fetch(`/api/catalog/master-skus`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editRow.masterSkuId, name: displayName }),
        })
        if (!res.ok) {
          const d = await res.json()
          setEditError(d.error ?? 'Failed to update name')
          setEditSaving(false)
          return
        }
      }

      // Update sku_mapping
      if (editRow.mappingId) {
        const res = await fetch(`/api/catalog/sku-mappings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id:                    editRow.mappingId,
            platform:              editChannel,
            platform_sku:          editSkuId,
            marketplace_account_id: acct.id,
          }),
        })
        if (!res.ok) {
          const d = await res.json()
          setEditError(d.error ?? 'Failed to update mapping')
          setEditSaving(false)
          return
        }
      }

      setEditRow(null)
      await loadData()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setEditSaving(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 p-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Catalog</h1>
        <Button onClick={() => setImportOpen(true)} className="gap-2">
          <Upload className="h-4 w-4" />
          Bulk Import
        </Button>
      </div>

      {/* Unmapped stock banner */}
      {unmappedCount > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span className="text-destructive font-medium">
            {unmappedCount} SKU{unmappedCount !== 1 ? 's are' : ' is'} in stock at a warehouse but not mapped to any channel — this inventory can't be sold.
          </span>
          <Button
            variant="link"
            size="sm"
            className="text-destructive ml-auto px-0"
            onClick={() => setShowUnmappedOnly(!showUnmappedOnly)}
          >
            {showUnmappedOnly ? 'Show all' : 'Show these SKUs ↓'}
          </Button>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search by SKU ID…"
          value={searchSkuId}
          onChange={(e) => setSearchSkuId(e.target.value)}
          className="w-52"
        />

        <Select value={filterMaster} onValueChange={setFilterMaster}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Master Product" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All products</SelectItem>
            {masterOptions.map((n) => (
              <SelectItem key={n} value={n}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterChannel} onValueChange={setFilterChannel}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Channel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All channels</SelectItem>
            {channelOptions.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterAccount} onValueChange={setFilterAccount}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Account" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All accounts</SelectItem>
            {accountOptions.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterWarehouse} onValueChange={setFilterWarehouse}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Warehouse" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All warehouses</SelectItem>
            {warehouseOptions.map((w) => (
              <SelectItem key={w} value={w}>{w}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
            <X className="h-3.5 w-3.5" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading…</div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Master Product / SKU</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>SKU ID</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      No rows match the current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedRows.map((row, i) => (
                    <TableRow key={`${row.masterSkuId}-${row.mappingId ?? i}`}>
                      <TableCell>
                        <div className="font-medium">
                          {row.parentName ?? row.masterSkuName}
                        </div>
                        {row.parentName && (
                          <div className="text-xs text-muted-foreground">{row.masterSkuName}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.platform ? (
                          <Badge variant="outline" className="capitalize">{row.platform}</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">Unmapped</Badge>
                        )}
                      </TableCell>
                      <TableCell>{row.accountName ?? '—'}</TableCell>
                      <TableCell className="font-mono text-sm">{row.platformSku ?? '—'}</TableCell>
                      <TableCell>
                        {row.warehouseNames.length > 0
                          ? row.warehouseNames.join(', ')
                          : <span className="text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell>
                        {!row.isUnmapped && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openEdit(row)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {filteredRows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Inline edit dialog */}
      <Dialog open={!!editRow} onOpenChange={(o) => { if (!o) setEditRow(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Mapping</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Master Product / SKU</Label>
              <Input
                value={editMasterName}
                onChange={(e) => setEditMasterName(e.target.value)}
                disabled={!!editRow?.parentName}
                placeholder="Product name"
              />
              {editRow?.parentName && (
                <p className="text-xs text-muted-foreground">Variant name editing not supported here — edit parent product instead.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select value={editChannel} onValueChange={setEditChannel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(new Set(accounts.map((a) => a.platform))).sort().map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Account</Label>
              <Select value={editAccount} onValueChange={setEditAccount}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    .filter((a) => a.platform === editChannel)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.account_name}>{a.account_name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>SKU ID</Label>
              <Input
                value={editSkuId}
                onChange={(e) => setEditSkuId(e.target.value)}
                placeholder="Platform SKU / listing ID"
                className="font-mono"
              />
            </div>
            {editError && (
              <p className="text-sm text-destructive">{editError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={editSaving}>
              {editSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV Import dialog */}
      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImportComplete={() => { loadData() }}
      />
    </div>
  )
}
```

**Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -60
```

**Step 4: Build check**

```bash
npm run build 2>&1 | tail -30
```

**Step 5: Commit**

```bash
git add src/app/(dashboard)/catalog/page.tsx
git commit -m "feat(catalog): overhaul catalog page — SKU-ID search, 4 filters, pagination, inline edit"
```

---

### Task 7: Fix any TypeScript / build errors and smoke test

**Step 1: Run full TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Fix all type errors before proceeding.

**Step 2: Run build**

```bash
npm run build 2>&1
```

Fix all build errors before proceeding.

**Step 3: Smoke test scenarios**

Start the dev server:

```bash
npm run dev
```

Open `http://localhost:3000/catalog` and manually test each scenario:

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Click "Bulk Import" | Dialog opens with dropzone + "Download Template" |
| 2 | Click "Download Template" | CSV downloads with 5 fixed headers + example rows + account reference rows |
| 3 | Drop a valid CSV (flat SKU rows) | Preview table shows rows with green checkmarks |
| 4 | Drop a CSV with unknown channel/account | Preview shows red error on bad rows; valid rows still green |
| 5 | Click "Import N →" | Import runs; results show created/updated/skipped counts |
| 6 | Re-import same CSV | Rows show "updated" count (upsert on existing platform_sku) |
| 7 | Drop a CSV with missing required fields | Those rows show error in preview; do not block valid rows |
| 8 | After import, close dialog | Catalog table refreshes with new rows |
| 9 | Search by SKU ID substring | Table filters instantly |
| 10 | Filter by Master Product | Shows only rows for that product |
| 11 | Filter by Channel | Shows only that platform's rows |
| 12 | Filter by Account | Shows only that account's rows |
| 13 | Filter by Warehouse | Shows only rows where that warehouse has stock |
| 14 | Combine multiple filters | All apply simultaneously |
| 15 | "Clear filters" button | Resets all filters |
| 16 | Pagination: > 50 rows | Prev/Next buttons work; row count accurate |
| 17 | Click pencil icon | Edit dialog pre-filled with row data |
| 18 | Edit SKU ID + save | Row updates in table |
| 19 | Edit Channel → Account filter narrows | Account dropdown shows only accounts for chosen channel |
| 20 | Unmapped banner | Appears when SKUs have warehouse stock but no mapping |
| 21 | "Show these SKUs ↓" | Filters table to unmapped stock rows only |

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(catalog): smoke test fixes"
```

**Step 5: Build verification**

```bash
npm run build 2>&1 | tail -5
```

Expected: `Route (app) ... compiled successfully`
