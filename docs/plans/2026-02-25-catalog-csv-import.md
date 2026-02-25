# Catalog CSV Import — Smart Column Mapping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the brittle hardcoded-header CSV import with a smart column-mapping dialog that handles any CSV structure without silent failures.

**Architecture:** Client-side CSV parsing (Papa Parse, already installed) extracts headers and 5-row preview before any server call. A dialog shows auto-detected column mappings (fuzzy match) the user can override. On confirm, raw CSV text + the mapping object are POSTed to the API, which runs the importer using user-specified column names.

**Tech Stack:** Next.js App Router, TypeScript, Papa Parse (`papaparse`), Radix UI / shadcn (`Dialog`, `Select`, `Table`, `Badge`), Tailwind CSS v4, Supabase (server-side only in importer)

**Design doc:** `docs/plans/2026-02-25-catalog-csv-import-design.md`

---

## Task 1: Update the importer to accept a column mapping

**Files:**
- Modify: `src/lib/importers/sku-mapping-importer.ts`

The current importer reads hardcoded column names (`row['master_sku_name']`). We need it to accept a mapping object so the caller can pass any column names from the user's actual CSV.

**Step 1: Replace the entire file with the updated version**

```typescript
// src/lib/importers/sku-mapping-importer.ts
import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'

/** Maps our internal field names to the user's actual CSV column headers.
 *  null means "skip this field". */
export interface CsvColumnMapping {
  master_sku_name: string        // required — never null
  flipkart_sku: string | null
  amazon_sku: string | null
  d2c_sku: string | null
  description: string | null
}

export interface ImportResult {
  created: number
  updated: number
  failed: number
  errors: Array<{ row: number; sku: string; message: string }>
}

export async function importSkuMappingCsv(
  csvText: string,
  mapping: CsvColumnMapping
): Promise<ImportResult> {
  const tenantId = await getTenantId()
  const supabase = await createClient()
  const { data } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  let created = 0
  let updated = 0
  let failed = 0
  const errors: ImportResult['errors'] = []

  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    const rowNum = i + 2 // 1-indexed, +1 for header row

    const masterSkuName = row[mapping.master_sku_name]?.trim()
    if (!masterSkuName) {
      failed++
      errors.push({ row: rowNum, sku: '(blank)', message: 'Master SKU Name is empty' })
      continue
    }

    const description = mapping.description ? row[mapping.description]?.trim() || null : null

    // Check if SKU already exists
    const { data: existing } = await supabase
      .from('master_skus')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', masterSkuName)
      .single()

    let skuId: string

    if (existing) {
      // Update description if provided
      if (description !== null) {
        await supabase
          .from('master_skus')
          .update({ description })
          .eq('id', existing.id)
      }
      skuId = existing.id
      updated++
    } else {
      // Insert new SKU
      const { data: inserted, error: insertError } = await supabase
        .from('master_skus')
        .insert({ tenant_id: tenantId, name: masterSkuName, description })
        .select('id')
        .single()

      if (insertError || !inserted) {
        failed++
        errors.push({ row: rowNum, sku: masterSkuName, message: insertError?.message ?? 'Insert failed' })
        continue
      }
      skuId = inserted.id
      created++
    }

    // Upsert platform mappings for non-null mapping fields
    const platforms = [
      { platform: 'flipkart' as const, col: mapping.flipkart_sku },
      { platform: 'amazon' as const, col: mapping.amazon_sku },
      { platform: 'd2c' as const, col: mapping.d2c_sku },
    ]

    for (const { platform, col } of platforms) {
      if (!col) continue
      const platformSku = row[col]?.trim()
      if (!platformSku) continue

      const { error } = await supabase.from('sku_mappings').upsert(
        { tenant_id: tenantId, master_sku_id: skuId, platform, platform_sku: platformSku },
        { onConflict: 'tenant_id,platform,platform_sku' }
      )
      if (error) {
        errors.push({ row: rowNum, sku: masterSkuName, message: `${platform} mapping: ${error.message}` })
      }
    }
  }

  return { created, updated, failed, errors }
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd /path/to/FK-Tool && npx tsc --noEmit 2>&1 | grep -v "^$"
```
Expected: no errors (or only pre-existing unrelated errors)

**Step 3: Commit**

```bash
git add src/lib/importers/sku-mapping-importer.ts
git commit -m "feat(catalog): update SKU importer to accept column mapping + track created/updated"
```

---

## Task 2: Update the API route to accept JSON

**Files:**
- Modify: `src/app/api/catalog/import-csv/route.ts`

The current route reads a `multipart/form-data` file. We need it to accept `application/json` with `{ csv: string, mapping: CsvColumnMapping }`.

**Step 1: Replace the route file**

```typescript
// src/app/api/catalog/import-csv/route.ts
import { createClient } from '@/lib/supabase/server'
import { importSkuMappingCsv, type CsvColumnMapping } from '@/lib/importers/sku-mapping-importer'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json() as { csv?: string; mapping?: CsvColumnMapping }

    if (!body.csv || typeof body.csv !== 'string') {
      return NextResponse.json({ error: 'Missing csv field' }, { status: 400 })
    }
    if (!body.mapping?.master_sku_name) {
      return NextResponse.json({ error: 'Missing or invalid mapping' }, { status: 400 })
    }

    const result = await importSkuMappingCsv(body.csv, body.mapping)
    return NextResponse.json(result)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "^$"
```
Expected: no errors

**Step 3: Commit**

```bash
git add src/app/api/catalog/import-csv/route.ts
git commit -m "feat(catalog): CSV import route accepts JSON {csv, mapping} instead of multipart"
```

---

## Task 3: Create the CsvImportDialog component

**Files:**
- Create: `src/components/catalog/CsvImportDialog.tsx`

This is the main UI work. The component has 4 internal states: `idle` (file picker), `mapping` (column mapping table + preview), `importing` (spinner), `results` (summary + errors).

**Step 1: Create the file with the complete implementation**

```typescript
// src/components/catalog/CsvImportDialog.tsx
'use client'
import { useRef, useState } from 'react'
import Papa from 'papaparse'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { Upload, CheckCircle2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import type { CsvColumnMapping } from '@/lib/importers/sku-mapping-importer'

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'idle' | 'mapping' | 'importing' | 'results'

interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]  // first 5 rows for preview
  totalRows: number
  rawText: string
}

interface ImportResults {
  created: number
  updated: number
  failed: number
  errors: Array<{ row: number; sku: string; message: string }>
}

interface MappingField {
  key: keyof CsvColumnMapping
  label: string
  required: boolean
}

const MAPPING_FIELDS: MappingField[] = [
  { key: 'master_sku_name', label: 'Master SKU Name', required: true },
  { key: 'flipkart_sku',    label: 'Flipkart SKU',    required: false },
  { key: 'amazon_sku',      label: 'Amazon SKU',      required: false },
  { key: 'd2c_sku',         label: 'D2C SKU',         required: false },
  { key: 'description',     label: 'Description',     required: false },
]

// ─── Fuzzy auto-detection ─────────────────────────────────────────────────────

const SYNONYMS: Record<keyof CsvColumnMapping, string[]> = {
  master_sku_name: ['mastersku', 'masterskuname', 'skuname', 'productname', 'itemname', 'title', 'name', 'sku', 'product', 'skuid'],
  flipkart_sku:    ['flipkart', 'fksku', 'fklisting', 'fkid', 'flipkartsku', 'flipkartlisting', 'fklistingid'],
  amazon_sku:      ['amazon', 'amazonsku', 'asin', 'amz', 'amzsku', 'amazonasin', 'amazonlisting'],
  d2c_sku:         ['d2c', 'd2csku', 'websitesku', 'directsku', 'ownsite', 'shopifysku', 'websiteid'],
  description:     ['description', 'desc', 'details', 'productdescription', 'itemdescription', 'skudescription'],
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function autoDetect(headers: string[]): CsvColumnMapping {
  const mapping: CsvColumnMapping = {
    master_sku_name: '',
    flipkart_sku: null,
    amazon_sku: null,
    d2c_sku: null,
    description: null,
  }

  for (const field of Object.keys(SYNONYMS) as Array<keyof CsvColumnMapping>) {
    const synonyms = SYNONYMS[field]
    const match = headers.find(h => synonyms.includes(normalise(h)))
    if (match) {
      // CsvColumnMapping allows string | null for optional fields, string for master_sku_name
      ;(mapping as Record<string, string | null>)[field] = match
    }
  }

  return mapping
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

const SKIP = '__skip__'

export function CsvImportDialog({ open, onOpenChange, onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('idle')
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = useState<CsvColumnMapping>({ master_sku_name: '', flipkart_sku: null, amazon_sku: null, d2c_sku: null, description: null })
  const [results, setResults] = useState<ImportResults | null>(null)
  const [showErrors, setShowErrors] = useState(false)

  function handleClose() {
    if (step === 'importing') return  // don't allow close while importing
    setStep('idle')
    setParsed(null)
    setResults(null)
    setShowErrors(false)
    onOpenChange(false)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.csv')) {
      toast.error('Please select a CSV file')
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      const rawText = ev.target?.result as string
      const { data, meta } = Papa.parse<Record<string, string>>(rawText, {
        header: true,
        skipEmptyLines: true,
        preview: 5,  // only need first 5 for preview
      })
      const headers = meta.fields ?? []

      // Re-parse to get total row count
      const { data: allData } = Papa.parse<Record<string, string>>(rawText, {
        header: true,
        skipEmptyLines: true,
      })

      setParsed({ headers, rows: data, totalRows: allData.length, rawText })
      setMapping(autoDetect(headers))
      setStep('mapping')
    }
    reader.readAsText(file)
    // Reset so same file can be re-picked
    e.target.value = ''
  }

  function setField(key: keyof CsvColumnMapping, value: string) {
    setMapping(prev => ({
      ...prev,
      [key]: value === SKIP ? null : value,
    }))
  }

  function getSelectValue(key: keyof CsvColumnMapping): string {
    const v = mapping[key]
    return v ?? SKIP
  }

  const canImport = !!mapping.master_sku_name

  async function handleImport() {
    if (!parsed || !canImport) return
    setStep('importing')

    try {
      const res = await fetch('/api/catalog/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: parsed.rawText, mapping }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Import failed')
        setStep('mapping')
        return
      }
      setResults(data as ImportResults)
      setStep('results')
      if (data.created > 0 || data.updated > 0) onImported()
    } catch {
      toast.error('Network error during import')
      setStep('mapping')
    }
  }

  // ─── Render helpers ──────────────────────────────────────────────────────────

  function renderIdle() {
    return (
      <div
        className="flex flex-col items-center justify-center gap-4 py-12 border-2 border-dashed border-muted rounded-lg cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-10 w-10 text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium">Click to select a CSV file</p>
          <p className="text-xs text-muted-foreground mt-1">Any column headers — you'll map them next</p>
        </div>
        <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
      </div>
    )
  }

  function renderMapping() {
    if (!parsed) return null
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{parsed.headers.length} columns</span> detected in your file.
          Map each field below — unneeded fields can be skipped.
        </p>

        {/* Mapping table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Target Field</TableHead>
              <TableHead>Your Column</TableHead>
              <TableHead className="w-52">Sample Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MAPPING_FIELDS.map(field => {
              const selectedCol = mapping[field.key]
              const sampleVal = selectedCol && parsed.rows[0]
                ? parsed.rows[0][selectedCol]?.trim() || '—'
                : '—'
              const isAutoDetected = selectedCol !== null && selectedCol !== ''

              return (
                <TableRow key={field.key}>
                  <TableCell className="font-medium text-sm">
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                    {isAutoDetected && (
                      <Badge variant="secondary" className="ml-2 text-xs py-0 px-1.5 bg-green-100 text-green-700 border-green-200">
                        auto
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={getSelectValue(field.key)}
                      onValueChange={v => setField(field.key, v)}
                    >
                      <SelectTrigger className="w-52 h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {!field.required && (
                          <SelectItem value={SKIP}>
                            <span className="text-muted-foreground italic">— skip this field —</span>
                          </SelectItem>
                        )}
                        {parsed.headers.map(h => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono truncate max-w-[200px]">
                    {sampleVal}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        {/* Row preview */}
        {parsed.rows.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Preview — first {Math.min(parsed.rows.length, 5)} rows
              </p>
              <div className="overflow-x-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {MAPPING_FIELDS
                        .filter(f => mapping[f.key])
                        .map(f => <TableHead key={f.key} className="text-xs whitespace-nowrap">{f.label}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.rows.map((row, i) => (
                      <TableRow key={i}>
                        {MAPPING_FIELDS
                          .filter(f => mapping[f.key])
                          .map(f => {
                            const col = mapping[f.key]!
                            return (
                              <TableCell key={f.key} className="text-xs font-mono whitespace-nowrap max-w-[160px] truncate">
                                {row[col]?.trim() || <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            )
                          })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}

        {!canImport && (
          <p className="text-sm text-destructive">
            ⚠ You must map the &ldquo;Master SKU Name&rdquo; field before importing.
          </p>
        )}
      </div>
    )
  }

  function renderImporting() {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <div className="h-10 w-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">Importing {parsed?.totalRows} rows…</p>
      </div>
    )
  }

  function renderResults() {
    if (!results) return null
    const hasErrors = results.errors.length > 0
    const total = results.created + results.updated

    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          {total > 0
            ? <CheckCircle2 className="h-6 w-6 text-green-600 mt-0.5 shrink-0" />
            : <AlertCircle className="h-6 w-6 text-destructive mt-0.5 shrink-0" />}
          <div>
            <p className="font-medium">
              {total > 0
                ? `${total} row${total !== 1 ? 's' : ''} imported`
                : 'No rows imported'}
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {results.created} created · {results.updated} updated
              {results.failed > 0 && ` · ${results.failed} failed`}
            </p>
          </div>
        </div>

        {hasErrors && (
          <div className="border rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium bg-destructive/5 hover:bg-destructive/10 transition-colors"
              onClick={() => setShowErrors(v => !v)}
            >
              <span className="text-destructive">{results.errors.length} error{results.errors.length !== 1 ? 's' : ''}</span>
              {showErrors ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {showErrors && (
              <div className="max-h-48 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Row</TableHead>
                      <TableHead className="w-40">SKU</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.errors.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs tabular-nums">{e.row}</TableCell>
                        <TableCell className="text-xs font-mono truncate max-w-[160px]">{e.sku}</TableCell>
                        <TableCell className="text-xs text-destructive">{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ─── Dialog layout ───────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'results' ? 'Import Complete' : 'Import Master SKUs from CSV'}
          </DialogTitle>
        </DialogHeader>

        <div className="py-2">
          {step === 'idle'      && renderIdle()}
          {step === 'mapping'   && renderMapping()}
          {step === 'importing' && renderImporting()}
          {step === 'results'   && renderResults()}
        </div>

        <DialogFooter>
          {step === 'idle' && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {step === 'mapping' && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleImport} disabled={!canImport}>
                Import {parsed?.totalRows ?? ''} rows →
              </Button>
            </>
          )}
          {step === 'results' && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "^$"
```
Expected: no errors

**Step 3: Commit**

```bash
git add src/components/catalog/CsvImportDialog.tsx
git commit -m "feat(catalog): CsvImportDialog with auto-detect column mapping and results view"
```

---

## Task 4: Wire up the dialog in catalog/page.tsx

**Files:**
- Modify: `src/app/(dashboard)/catalog/page.tsx`

Remove the old hidden-input approach and replace with the new dialog.

**Step 1: Update the import line at the top of the file**

Change:
```typescript
import { useEffect, useState, useCallback, useRef } from 'react'
```
To:
```typescript
import { useEffect, useState, useCallback } from 'react'
```

And add the new dialog import alongside the existing component imports:
```typescript
import { CsvImportDialog } from '@/components/catalog/CsvImportDialog'
```

Also remove `Upload` from the lucide-react import (it's now used only inside `CsvImportDialog`):
```typescript
import { Plus, Search, Edit2, Map, X } from 'lucide-react'
```

**Step 2: Replace CSV-related state and handler in the component body**

Remove these lines (around line 95–100):
```typescript
// Bulk CSV import
const csvInputRef = useRef<HTMLInputElement>(null)
const [csvUploading, setCsvUploading] = useState(false)
```

Add in their place:
```typescript
// CSV Import dialog
const [csvImportOpen, setCsvImportOpen] = useState(false)
```

Remove the entire `handleCsvImport` function (lines 192–211):
```typescript
async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
  // ... delete this whole function
}
```

**Step 3: Update the header button and remove the hidden input**

Find the two elements in the JSX (around line 224–229):
```tsx
<input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
<Button variant="outline" onClick={() => csvInputRef.current?.click()} disabled={csvUploading}>
  <Upload className="h-4 w-4 mr-2" />
  {csvUploading ? 'Importing…' : 'Bulk Import CSV'}
</Button>
```

Replace with:
```tsx
<Button variant="outline" onClick={() => setCsvImportOpen(true)}>
  <Upload className="h-4 w-4 mr-2" />
  Bulk Import CSV
</Button>
```

And add the `Upload` import back — actually keep it in the page's lucide import since the button still uses it:
```typescript
import { Plus, Search, Edit2, Map, Upload, X } from 'lucide-react'
```

**Step 4: Add the dialog to the JSX at the bottom of the return block**

Find the closing `</div>` of the main return (after `SkuMappingDialog`) and add before it:
```tsx
{/* CSV Import Dialog */}
<CsvImportDialog
  open={csvImportOpen}
  onOpenChange={setCsvImportOpen}
  onImported={fetchSkus}
/>
```

**Step 5: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit 2>&1 | grep -v "^$"
```
Expected: no errors

**Step 6: Run a build to confirm all pages compile**

```bash
npm run build 2>&1 | tail -20
```
Expected: all 21 routes green, no type errors

**Step 7: Commit**

```bash
git add src/app/(dashboard)/catalog/page.tsx
git commit -m "feat(catalog): wire up CsvImportDialog, remove old hidden-input import flow"
```

---

## Task 5: Push and update PR

**Step 1: Push the branch**

```bash
git push origin feat/phase-4-imports
```

**Step 2: Verify the PR at https://github.com/jim2cool/FK-Tool/pull/2 shows the new commits**

Done. The CSV import now handles any column structure without silent failures.

---

## Manual Smoke Test Checklist

After implementing, verify these manually:

1. **Happy path:** Upload a CSV with different column names (e.g. `"Product"`, `"FK ID"`) → dialog opens → correct auto-detections → preview shows right data → import succeeds → catalog table refreshes
2. **Missing master SKU col:** Don't map "Master SKU Name" → Import button stays disabled
3. **Skip optional fields:** Map only master_sku_name → import creates SKUs with no platform mappings
4. **Row-level error:** Import a CSV where one row has a blank SKU name → that row appears in the error list, others succeed
5. **Re-upload:** After results, click Done → re-click Bulk Import CSV → fresh dialog opens
