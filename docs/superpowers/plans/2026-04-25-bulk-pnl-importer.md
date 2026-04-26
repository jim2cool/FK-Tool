# Bulk P&L Importer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Bulk Import" affordance on `/pnl` that walks a user through importing many Flipkart reports of one type at a time, with per-file account assignment, overlap warnings, sequential import, and a forced verification step before write.

**Architecture:** New `BulkImportDialog` wrapper component with a 6-step state machine. Each step is its own focused subcomponent. Reuses ALL existing parsers (`pnl-xlsx-parser`, `orders-report-parser`, etc.) and import APIs (`/api/pnl/import`, `/api/pnl/import-orders`, etc.) — no rewrites. One new server endpoint (`/api/pnl/bulk-overlap-check`) for the pre-import warning. Server-side enrichment-path is hardened to refuse silent account-mismatches.

**Tech Stack:** Next.js 16 App Router, TypeScript, react-dropzone, sonner toasts, shadcn/ui (Dialog, Table, Checkbox, Select, Progress). No new dependencies.

**Spec source of truth:** `docs/superpowers/specs/2026-04-25-bulk-pnl-importer-design.md`

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/app/api/pnl/bulk-overlap-check/route.ts` | POST endpoint: per-file existing-row counts |
| `src/components/pnl/BulkImportDialog.tsx` | Top-level wrapper; owns state machine; swaps step components |
| `src/components/pnl/bulk-import/types.ts` | Shared types for the bulk flow (FileEntry, ReportType, step state) |
| `src/components/pnl/bulk-import/bulk-import-state.ts` | Pure reducer for state transitions + helpers |
| `src/components/pnl/bulk-import/StepReportType.tsx` | Step 1: pick one of 4 report types |
| `src/components/pnl/bulk-import/StepDropFiles.tsx` | Step 2: drop zone with `.xlsx`-only accept |
| `src/components/pnl/bulk-import/StepFileTable.tsx` | Step 3: editable file table + skipped-files panel + multi-select bulk-assign |
| `src/components/pnl/bulk-import/StepConfirm.tsx` | Step 4: pre-import confirmation modal with per-account summary + verification checkbox |
| `src/components/pnl/bulk-import/StepProgress.tsx` | Step 5: live progress bar + per-file status with `beforeunload` guard |
| `src/components/pnl/bulk-import/StepResults.tsx` | Step 6: aggregated results screen |
| `src/components/pnl/bulk-import/EmptyAccountsState.tsx` | Pre-flight empty state when tenant has 0 accounts |

### Existing files to modify

| File | Change |
|---|---|
| `src/lib/importers/pnl-import-server.ts` | Enrichment-path account-mismatch safety; return `mismatchedAccount` count in result |
| `src/app/api/pnl/import/route.ts` | Pass mismatched-account count back in response (small forwarding change) |
| `src/app/(dashboard)/pnl/page.tsx` | Add "Bulk Import" button next to existing "Import"; mount `BulkImportDialog`; handle `?intent=bulk-import` query param |

### Files NOT touched

The existing single-file `PnlImportDialog.tsx` stays exactly as it is. The existing parsers stay as-is. The other 3 import APIs (`import-orders`, `import-returns`, `import-settlement`) stay as-is for v1 — only the P&L import server gets the enrichment-path hardening because it's the only one with an enrichment branch (verified in the spec review).

---

## Chunk 1: Server-side — overlap-check + enrichment safety

### Task 1: Inspect the existing P&L import server

**Files:**
- Read-only: `src/lib/importers/pnl-import-server.ts`

- [ ] **Step 1: Read the file fully**

Use Read on `src/lib/importers/pnl-import-server.ts`. Locate the **enrichment branch** — it's the path where an existing order matches an incoming `order_item_id` and the code does `UPDATE` on that order.

Note down:
- Line range of the enrichment branch
- Whether it currently writes `marketplace_account_id` (it does NOT — this is the bug we're fixing)
- The shape of the `PnlImportResult` interface (we need to add a new field)

> **No commit for this task** — pure exploration to ground subsequent edits.

### Task 2: Add `mismatchedAccount` field to `PnlImportResult`

**Files:**
- Modify: `src/lib/importers/pnl-import-server.ts`

- [ ] **Step 1: Update the result interface**

Find the `PnlImportResult` interface near the top of `src/lib/importers/pnl-import-server.ts` and add a new field:

```typescript
export interface PnlImportResult {
  imported: number
  skipped: number
  enriched: number
  mismatchedAccount: number   // NEW: rows where assigned account didn't match existing order's account
  unmappedSkus: string[]
  anomalyCount: number
  errors: string[]
}
```

- [ ] **Step 2: Initialise the field at every return-path**

Search the file for every place that constructs and returns a `PnlImportResult`. Add `mismatchedAccount: 0` (or the actual computed value, see Task 3) to each.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/importers/pnl-import-server.ts
git commit -m "feat(pnl-import): add mismatchedAccount field to PnlImportResult"
```

### Task 3: Harden the enrichment branch — refuse silent account mismatches

**Files:**
- Modify: `src/lib/importers/pnl-import-server.ts`

- [ ] **Step 1: Locate the enrichment branch**

Find the section where the importer detects an existing order (matching by `order_item_id` or `platform_order_id`) and updates it with financial data. It typically loads existing rows in batch then iterates per row.

- [ ] **Step 2: Add the mismatch check**

Inside the per-row enrichment loop, before the `UPDATE` call:

```typescript
// Refuse to enrich if the existing order is linked to a DIFFERENT account.
// This guards against bulk imports with wrong file→account assignment
// silently overwriting the wrong account's data.
const existingAccountId: string | null = existingOrder.marketplace_account_id ?? null
if (existingAccountId && existingAccountId !== marketplaceAccountId) {
  mismatchedAccount += 1
  continue   // skip this row; user will see it in the results screen
}
// If existingAccountId is null (legacy data), proceed and backfill it via the UPDATE below.
```

- [ ] **Step 3: Update the UPDATE statement to also write `marketplace_account_id`**

Whatever the current `update({...})` payload is, add `marketplace_account_id: marketplaceAccountId` to it. This backfills legacy null-account rows during enrichment (only ones that passed the mismatch check).

- [ ] **Step 4: Increment `mismatchedAccount` counter**

Declare `let mismatchedAccount = 0` near the other counters at the top of the function. Include it in the returned `PnlImportResult`.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/importers/pnl-import-server.ts
git commit -m "feat(pnl-import): refuse silent account-mismatch on enrichment + backfill null accounts"
```

### Task 4: Forward `mismatchedAccount` through the import API

**Files:**
- Modify: `src/app/api/pnl/import/route.ts`

- [ ] **Step 1: Read the route**

The handler currently returns the result of `importPnlData(...)` directly. It already forwards all fields, so no code change is needed if the result type was updated cleanly in Task 2. Verify the JSON response shape includes `mismatchedAccount`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

> **No commit for this task** unless changes were needed (likely none).

### Task 5: Create overlap-check API

**Files:**
- Create: `src/app/api/pnl/bulk-overlap-check/route.ts`

- [ ] **Step 1: Create the route file**

Write the following at `src/app/api/pnl/bulk-overlap-check/route.ts`:

```typescript
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
        // Per-account scoped
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
        // P&L overlap = orders rows with order_financials in this range for this account
        const { data, count: c } = await supabase
          .from('orders')
          .select('order_date, order_financials!inner(order_item_id)', { count: 'exact', head: false })
          .eq('tenant_id', tenantId)
          .eq('marketplace_account_id', marketplaceAccountId)
          .gte('order_date', dateRange.from)
          .lte('order_date', dateRange.to)
          .order('order_date', { ascending: true })
          .limit(1)
        count = c ?? 0
        sampleDate = (data?.[0] as { order_date?: string } | undefined)?.order_date
      } else if (body.reportType === 'returns') {
        // Tenant-wide (returns reports don't carry marketplace_account_id)
        const { data, count: c } = await supabase
          .from('orders')
          .select('return_request_date', { count: 'exact', head: false })
          .eq('tenant_id', tenantId)
          .gte('return_request_date', dateRange.from)
          .lte('return_request_date', dateRange.to)
          .order('return_request_date', { ascending: true })
          .limit(1)
        count = c ?? 0
        sampleDate = (data?.[0] as { return_request_date?: string } | undefined)?.return_request_date
      } else if (body.reportType === 'settlement') {
        // Tenant-wide
        const { data, count: c } = await supabase
          .from('orders')
          .select('settlement_date', { count: 'exact', head: false })
          .eq('tenant_id', tenantId)
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
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If there are issues with the inner-join syntax for `order_financials`, simplify the P&L branch to count via `order_financials` directly (filter by `tenant_id` + a join on `orders.marketplace_account_id` is harder against the existing schema — verify shapes during implementation).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/pnl/bulk-overlap-check/route.ts
git commit -m "feat(pnl): bulk-overlap-check endpoint for per-file existing-row counts"
```

---

## Chunk 2: Client-side foundation — types + state machine

### Task 6: Shared types for the bulk flow

**Files:**
- Create: `src/components/pnl/bulk-import/types.ts`

- [ ] **Step 1: Create the file**

Write the full content:

```typescript
import type { ParsedPnlRow } from '@/lib/importers/pnl-xlsx-parser'
import type { ParsedOrderRow } from '@/lib/importers/orders-report-parser'
import type { ParsedReturnRow } from '@/lib/importers/returns-report-parser'
import type { ParsedSettlementRow } from '@/lib/importers/settlement-report-parser'

export type ReportType = 'orders' | 'returns' | 'pnl' | 'settlement'

export type AnyParsedRow = ParsedPnlRow | ParsedOrderRow | ParsedReturnRow | ParsedSettlementRow

export type FileStatus =
  | { kind: 'parsing' }
  | { kind: 'ready'; rowCount: number; dateRange: { from: string; to: string }; sampleSkus: string[] }
  | { kind: 'parse-error'; reason: string }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'too-large'; reason: string }
  | { kind: 'empty'; reason: string }
  | { kind: 'uploading' }
  | { kind: 'imported'; imported: number; skipped: number; mismatchedAccount: number; failed: number }
  | { kind: 'failed'; reason: string }

export interface FileEntry {
  fileKey: string                          // stable client-side ID (uuid v4)
  fileName: string
  fileSize: number
  fileLastModified: number                 // for dup-drop detection
  rows: AnyParsedRow[] | null              // null until parsed
  status: FileStatus
  marketplaceAccountId: string | null      // user-assigned (P&L + Orders only)
  includeInImport: boolean                 // checkbox state
  multiSelectChecked: boolean              // shift-click selection state
}

export type Step = 'reportType' | 'dropFiles' | 'fileTable' | 'confirm' | 'progress' | 'results'

export interface BulkImportState {
  step: Step
  reportType: ReportType | null
  files: FileEntry[]                        // valid + main-table files
  skippedFiles: FileEntry[]                 // wrong-type, parse-error, empty, too-large
  showSkippedPanel: boolean                 // collapsible panel state
  overlapsByFileKey: Record<string, { existingRowCount: number; sampleExistingDate?: string }> | null
  isCheckingOverlap: boolean
  overlapCheckError: string | null
  verifiedAccountAssignment: boolean        // confirm-modal checkbox
  importInFlight: boolean
  importStartedAt: number | null            // ms epoch, for ETA
  currentImportingFileKey: string | null
  finalSummary: { imported: number; skippedDup: number; failed: number; mismatched: number; perAccount: Record<string, { files: number; rows: number }> } | null
}

export interface MarketplaceAccountLite {
  id: string
  account_name: string
  platform: string
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/pnl/bulk-import/types.ts
git commit -m "feat(bulk-import): shared types for the wizard"
```

### Task 7: State reducer

**Files:**
- Create: `src/components/pnl/bulk-import/bulk-import-state.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { BulkImportState, FileEntry, ReportType, Step } from './types'

export const MAX_FILES_PER_SESSION = 50
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  // 50 MB

export type Action =
  | { type: 'reset' }
  | { type: 'setStep'; step: Step }
  | { type: 'setReportType'; reportType: ReportType }
  | { type: 'addFile'; file: FileEntry }                  // for valid (or "to be parsed") files
  | { type: 'addSkipped'; file: FileEntry }               // for instantly-rejected files
  | { type: 'fileParsed'; fileKey: string; rowCount: number; dateRange: { from: string; to: string }; sampleSkus: string[]; rows: FileEntry['rows'] }
  | { type: 'fileParseError'; fileKey: string; reason: string }
  | { type: 'fileEmpty'; fileKey: string }                // moves from main table to skipped panel
  | { type: 'reincludeSkipped'; fileKey: string }         // moves back into main table
  | { type: 'removeFile'; fileKey: string }
  | { type: 'setIncludeInImport'; fileKey: string; include: boolean }
  | { type: 'setAccount'; fileKey: string; accountId: string }
  | { type: 'applyAccountToSelected'; accountId: string }
  | { type: 'setMultiSelect'; fileKey: string; selected: boolean }
  | { type: 'clearMultiSelect' }
  | { type: 'setShowSkippedPanel'; show: boolean }
  | { type: 'startOverlapCheck' }
  | { type: 'overlapCheckSuccess'; overlaps: BulkImportState['overlapsByFileKey'] }
  | { type: 'overlapCheckError'; reason: string }
  | { type: 'setVerifiedAccountAssignment'; verified: boolean }
  | { type: 'startImport' }
  | { type: 'startImportingFile'; fileKey: string }
  | { type: 'fileImportSuccess'; fileKey: string; imported: number; skipped: number; mismatchedAccount: number; failed: number }
  | { type: 'fileImportFailed'; fileKey: string; reason: string }
  | { type: 'finishImport'; summary: NonNullable<BulkImportState['finalSummary']> }

export const initialState: BulkImportState = {
  step: 'reportType',
  reportType: null,
  files: [],
  skippedFiles: [],
  showSkippedPanel: true,
  overlapsByFileKey: null,
  isCheckingOverlap: false,
  overlapCheckError: null,
  verifiedAccountAssignment: false,
  importInFlight: false,
  importStartedAt: null,
  currentImportingFileKey: null,
  finalSummary: null,
}

export function reducer(state: BulkImportState, action: Action): BulkImportState {
  switch (action.type) {
    case 'reset':
      return initialState
    case 'setStep':
      return { ...state, step: action.step }
    case 'setReportType':
      return { ...state, reportType: action.reportType }
    case 'addFile':
      return { ...state, files: [...state.files, action.file] }
    case 'addSkipped':
      return { ...state, skippedFiles: [...state.skippedFiles, action.file] }
    case 'fileParsed':
      return {
        ...state,
        files: state.files.map(f =>
          f.fileKey === action.fileKey
            ? { ...f, status: { kind: 'ready', rowCount: action.rowCount, dateRange: action.dateRange, sampleSkus: action.sampleSkus }, rows: action.rows, includeInImport: true }
            : f,
        ),
      }
    case 'fileParseError': {
      const file = state.files.find(f => f.fileKey === action.fileKey)
      if (!file) return state
      const updated: FileEntry = { ...file, status: { kind: 'parse-error', reason: action.reason }, includeInImport: false }
      return {
        ...state,
        files: state.files.filter(f => f.fileKey !== action.fileKey),
        skippedFiles: [...state.skippedFiles, updated],
      }
    }
    case 'fileEmpty': {
      const file = state.files.find(f => f.fileKey === action.fileKey)
      if (!file) return state
      const updated: FileEntry = { ...file, status: { kind: 'empty', reason: '0 rows — likely wrong date range' }, includeInImport: false }
      return {
        ...state,
        files: state.files.filter(f => f.fileKey !== action.fileKey),
        skippedFiles: [...state.skippedFiles, updated],
      }
    }
    case 'reincludeSkipped': {
      const file = state.skippedFiles.find(f => f.fileKey === action.fileKey)
      if (!file) return state
      return {
        ...state,
        skippedFiles: state.skippedFiles.filter(f => f.fileKey !== action.fileKey),
        files: [...state.files, { ...file, includeInImport: false }],
      }
    }
    case 'removeFile':
      return {
        ...state,
        files: state.files.filter(f => f.fileKey !== action.fileKey),
        skippedFiles: state.skippedFiles.filter(f => f.fileKey !== action.fileKey),
      }
    case 'setIncludeInImport':
      return {
        ...state,
        files: state.files.map(f => f.fileKey === action.fileKey ? { ...f, includeInImport: action.include } : f),
      }
    case 'setAccount':
      return {
        ...state,
        files: state.files.map(f => f.fileKey === action.fileKey ? { ...f, marketplaceAccountId: action.accountId } : f),
      }
    case 'applyAccountToSelected':
      return {
        ...state,
        files: state.files.map(f => f.multiSelectChecked ? { ...f, marketplaceAccountId: action.accountId } : f),
      }
    case 'setMultiSelect':
      return {
        ...state,
        files: state.files.map(f => f.fileKey === action.fileKey ? { ...f, multiSelectChecked: action.selected } : f),
      }
    case 'clearMultiSelect':
      return { ...state, files: state.files.map(f => ({ ...f, multiSelectChecked: false })) }
    case 'setShowSkippedPanel':
      return { ...state, showSkippedPanel: action.show }
    case 'startOverlapCheck':
      return { ...state, isCheckingOverlap: true, overlapCheckError: null }
    case 'overlapCheckSuccess':
      return { ...state, isCheckingOverlap: false, overlapsByFileKey: action.overlaps }
    case 'overlapCheckError':
      return { ...state, isCheckingOverlap: false, overlapCheckError: action.reason }
    case 'setVerifiedAccountAssignment':
      return { ...state, verifiedAccountAssignment: action.verified }
    case 'startImport':
      return { ...state, importInFlight: true, importStartedAt: Date.now(), step: 'progress' }
    case 'startImportingFile':
      return {
        ...state,
        currentImportingFileKey: action.fileKey,
        files: state.files.map(f => f.fileKey === action.fileKey ? { ...f, status: { kind: 'uploading' } } : f),
      }
    case 'fileImportSuccess':
      return {
        ...state,
        files: state.files.map(f => f.fileKey === action.fileKey
          ? { ...f, status: { kind: 'imported', imported: action.imported, skipped: action.skipped, mismatchedAccount: action.mismatchedAccount, failed: action.failed } }
          : f,
        ),
      }
    case 'fileImportFailed':
      return {
        ...state,
        files: state.files.map(f => f.fileKey === action.fileKey ? { ...f, status: { kind: 'failed', reason: action.reason } } : f),
      }
    case 'finishImport':
      return { ...state, importInFlight: false, currentImportingFileKey: null, finalSummary: action.summary, step: 'results' }
    default:
      return state
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/pnl/bulk-import/bulk-import-state.ts
git commit -m "feat(bulk-import): pure state reducer for the wizard"
```

---

## Chunk 3: UI step components

### Task 8: Empty-accounts state component

**Files:**
- Create: `src/components/pnl/bulk-import/EmptyAccountsState.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Building2 } from 'lucide-react'

export function EmptyAccountsState({ onClose }: { onClose: () => void }) {
  return (
    <div className="text-center py-8 space-y-4">
      <Building2 className="h-12 w-12 mx-auto text-muted-foreground" />
      <div className="space-y-1">
        <h3 className="font-medium">Set up an account first</h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          You need at least one Flipkart marketplace account before you can bulk-import reports.
          Each Seller Hub login is one &quot;account&quot; in FK-Tool.
        </p>
      </div>
      <div className="flex justify-center gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button asChild>
          <Link href="/settings">Open Settings →</Link>
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/pnl/bulk-import/EmptyAccountsState.tsx
git commit -m "feat(bulk-import): empty state when tenant has 0 marketplace accounts"
```

### Task 9: Step 1 — pick report type

**Files:**
- Create: `src/components/pnl/bulk-import/StepReportType.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Package, RotateCcw, DollarSign, Landmark } from 'lucide-react'
import type { ReportType } from './types'

const REPORTS: { type: ReportType; label: string; description: string; icon: typeof Package }[] = [
  { type: 'orders',     label: 'Orders Report',     description: 'Lifecycle data — dispatch, delivery, return dates', icon: Package },
  { type: 'returns',    label: 'Returns Report',    description: 'RTO/RVP details with reasons',                       icon: RotateCcw },
  { type: 'pnl',        label: 'P&L Report',        description: 'Fee breakdown — commission, shipping, taxes',        icon: DollarSign },
  { type: 'settlement', label: 'Settlement Report', description: 'Bank settlement and NEFT IDs',                       icon: Landmark },
]

interface Props {
  selected: ReportType | null
  onSelect: (rt: ReportType) => void
  onNext: () => void
  onCancel: () => void
}

const HIDE_HINT_KEY = 'fk-tool:bulk-import:hide-source-hint-until'

export function StepReportType({ selected, onSelect, onNext, onCancel }: Props) {
  const [showHint, setShowHint] = useState(true)

  useEffect(() => {
    try {
      const ts = window.localStorage.getItem(HIDE_HINT_KEY)
      if (ts && Number(ts) > Date.now()) setShowHint(false)
    } catch { /* localStorage may be unavailable */ }
  }, [])

  function dismissHint() {
    try {
      const thirty = 30 * 24 * 60 * 60 * 1000
      window.localStorage.setItem(HIDE_HINT_KEY, String(Date.now() + thirty))
    } catch { /* ignore */ }
    setShowHint(false)
  }

  return (
    <div className="space-y-4">
      {showHint && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs flex items-start justify-between gap-3">
          <p>First time? Each report type comes from a different page in Flipkart Seller Hub. Match the file you have to the correct type below.</p>
          <button type="button" onClick={dismissHint} className="text-muted-foreground hover:text-foreground">Hide</button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {REPORTS.map(r => {
          const Icon = r.icon
          const isSelected = selected === r.type
          return (
            <button
              key={r.type}
              type="button"
              onClick={() => onSelect(r.type)}
              className={[
                'rounded-lg border p-4 text-left transition-colors',
                isSelected ? 'border-primary bg-primary/5' : 'hover:border-primary/50',
              ].join(' ')}
            >
              <Icon className="h-5 w-5 mb-2 text-primary" />
              <p className="font-medium text-sm">{r.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
            </button>
          )
        })}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={onNext} disabled={!selected}>Next: Drop files →</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/pnl/bulk-import/StepReportType.tsx
git commit -m "feat(bulk-import): Step 1 — pick report type with first-time hint"
```

### Task 10: Step 2 — drop files

**Files:**
- Create: `src/components/pnl/bulk-import/StepDropFiles.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'
import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Button } from '@/components/ui/button'
import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MAX_FILES_PER_SESSION, MAX_FILE_SIZE_BYTES } from './bulk-import-state'

interface Props {
  onFilesDropped: (accepted: File[], rejected: { file: File; reason: string }[]) => void
  onBack: () => void
  currentFileCount: number
}

export function StepDropFiles({ onFilesDropped, onBack, currentFileCount }: Props) {
  const remainingSlots = MAX_FILES_PER_SESSION - currentFileCount

  const onDrop = useCallback(
    (accepted: File[], rejections: { file: File; errors: { code: string; message: string }[] }[]) => {
      const ourRejected: { file: File; reason: string }[] = rejections.map(r => ({
        file: r.file,
        reason: r.errors[0]?.message ?? 'Rejected by file picker',
      }))
      // Enforce file count cap
      const overflow = Math.max(0, accepted.length - remainingSlots)
      const acceptedTrimmed = accepted.slice(0, remainingSlots)
      for (const f of accepted.slice(remainingSlots)) {
        ourRejected.push({ file: f, reason: `Maximum ${MAX_FILES_PER_SESSION} files per session` })
      }
      // Per-file size check (react-dropzone supports maxSize, but be defensive)
      const sizeOk: File[] = []
      for (const f of acceptedTrimmed) {
        if (f.size > MAX_FILE_SIZE_BYTES) {
          ourRejected.push({ file: f, reason: `File exceeds 50 MB limit` })
        } else if (f.size === 0) {
          ourRejected.push({ file: f, reason: 'Empty file (0 bytes)' })
        } else {
          sizeOk.push(f)
        }
      }
      onFilesDropped(sizeOk, ourRejected)
      if (overflow > 0) {
        // (toast will be raised by the parent — keep this component pure)
      }
    },
    [onFilesDropped, remainingSlots],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    maxSize: MAX_FILE_SIZE_BYTES,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.XLSX'],
    },
  })

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 cursor-pointer text-center transition-colors',
          isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
        )}
      >
        <input {...getInputProps()} />
        <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm font-medium">Drop your files here, or click to browse</p>
        <p className="text-xs text-muted-foreground mt-1">
          Multiple files OK · .xlsx only · Max {MAX_FILES_PER_SESSION} files · 50 MB per file
        </p>
      </div>
      <div className="flex justify-start">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/pnl/bulk-import/StepDropFiles.tsx
git commit -m "feat(bulk-import): Step 2 — drop zone with .xlsx/size/count limits"
```

### Task 11: Step 3 — file table + skipped-files panel

**Files:**
- Create: `src/components/pnl/bulk-import/StepFileTable.tsx`

- [ ] **Step 1: Create the component**

This is the longest component. Key behaviours:
- Render valid files in main table; rejected/empty files in a collapsible panel below
- Per-row checkbox for include-in-import
- Per-row account dropdown (disabled `—` for Returns/Settlement)
- Multi-select via shift-click; "Apply account to selected" dropdown when ≥2 rows selected
- Status icon paired with text (Ready, Parsing, Error)
- Sample row shows up to 3 distinct SKUs
- × icon to remove a file entirely
- Re-include button on skipped panel rows
- Disabled "Import N files" button when any checked P&L/Orders row is missing an account

```tsx
'use client'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { Loader2, CheckCircle2, AlertCircle, X, ChevronRight, ChevronDown } from 'lucide-react'
import type { FileEntry, MarketplaceAccountLite, ReportType } from './types'

function needsAccount(rt: ReportType): boolean {
  return rt === 'pnl' || rt === 'orders'
}

interface Props {
  reportType: ReportType
  files: FileEntry[]
  skippedFiles: FileEntry[]
  showSkippedPanel: boolean
  accounts: MarketplaceAccountLite[]
  onSetAccount: (fileKey: string, accountId: string) => void
  onApplyAccountToSelected: (accountId: string) => void
  onSetMultiSelect: (fileKey: string, selected: boolean) => void
  onSetIncludeInImport: (fileKey: string, include: boolean) => void
  onRemoveFile: (fileKey: string) => void
  onReinclude: (fileKey: string) => void
  onToggleSkippedPanel: () => void
  onBack: () => void
  onNext: () => void
}

export function StepFileTable(props: Props) {
  const {
    reportType, files, skippedFiles, showSkippedPanel, accounts,
    onSetAccount, onApplyAccountToSelected, onSetMultiSelect, onSetIncludeInImport,
    onRemoveFile, onReinclude, onToggleSkippedPanel, onBack, onNext,
  } = props

  const [bulkAccountId, setBulkAccountId] = useState<string>('')

  const requiresAccount = needsAccount(reportType)
  const checkedFiles = files.filter(f => f.includeInImport && f.status.kind === 'ready')
  const totalRows = checkedFiles.reduce((s, f) => s + (f.status.kind === 'ready' ? f.status.rowCount : 0), 0)

  const importDisabled = useMemo(() => {
    if (checkedFiles.length === 0) return true
    if (requiresAccount && checkedFiles.some(f => !f.marketplaceAccountId)) return true
    return false
  }, [checkedFiles, requiresAccount])

  const selectedCount = files.filter(f => f.multiSelectChecked).length
  const parsingCount = files.filter(f => f.status.kind === 'parsing').length

  return (
    <div className="space-y-4">
      {parsingCount > 0 && (
        <p className="text-xs text-muted-foreground">
          Parsing {parsingCount} file{parsingCount === 1 ? '' : 's'}…
        </p>
      )}

      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs">
            <tr>
              <th className="px-2 py-2 w-8"></th>
              <th className="px-2 py-2 text-left">Filename</th>
              <th className="px-2 py-2 text-left">Date Range</th>
              <th className="px-2 py-2 text-left">Sample SKUs</th>
              {requiresAccount && <th className="px-2 py-2 text-left">Account</th>}
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {files.length === 0 && (
              <tr><td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">No files yet</td></tr>
            )}
            {files.map(f => {
              const isReady = f.status.kind === 'ready'
              const range = isReady && f.status.kind === 'ready' ? `${f.status.dateRange.from} → ${f.status.dateRange.to}` : '—'
              const skuPreview = isReady && f.status.kind === 'ready'
                ? f.status.sampleSkus.slice(0, 3).join(', ') + (f.status.sampleSkus.length > 3 ? ` (+${f.status.sampleSkus.length - 3} more)` : '')
                : '—'
              return (
                <tr
                  key={f.fileKey}
                  className={f.multiSelectChecked ? 'bg-primary/5 ring-1 ring-primary/20' : ''}
                  onClick={(e) => {
                    if ((e as unknown as { shiftKey: boolean }).shiftKey) {
                      onSetMultiSelect(f.fileKey, !f.multiSelectChecked)
                    }
                  }}
                >
                  <td className="px-2 py-2">
                    <Checkbox
                      checked={f.includeInImport}
                      disabled={!isReady}
                      onCheckedChange={(v) => onSetIncludeInImport(f.fileKey, !!v)}
                    />
                  </td>
                  <td className="px-2 py-2 truncate max-w-[200px]" title={f.fileName}>{f.fileName}</td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap">{range}</td>
                  <td className="px-2 py-2 text-xs truncate max-w-[200px]" title={skuPreview}>{skuPreview}</td>
                  {requiresAccount && (
                    <td className="px-2 py-2">
                      <Select
                        value={f.marketplaceAccountId ?? ''}
                        onValueChange={(v) => onSetAccount(f.fileKey, v)}
                      >
                        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Select account" /></SelectTrigger>
                        <SelectContent>
                          {accounts.map(a => (
                            <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  )}
                  {!requiresAccount && (
                    <></>  /* No account column for Returns/Settlement reports — but keep header consistent */
                  )}
                  <td className="px-2 py-2 text-xs">
                    {f.status.kind === 'parsing' && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Parsing…</span>}
                    {f.status.kind === 'ready' && <span className="flex items-center gap-1 text-green-700"><CheckCircle2 className="h-3 w-3" /> Ready · {f.status.rowCount} rows</span>}
                  </td>
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => onRemoveFile(f.fileKey)} aria-label={`Remove ${f.fileName}`}>
                      <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{checkedFiles.length} of {files.filter(f => f.status.kind === 'ready').length} valid files selected · ~{totalRows} rows total {selectedCount > 0 && `· ${selectedCount} selected for bulk-assign`}</span>
        {selectedCount > 0 && requiresAccount && (
          <div className="flex items-center gap-2">
            <Select value={bulkAccountId} onValueChange={(v) => { setBulkAccountId(v); onApplyAccountToSelected(v) }}>
              <SelectTrigger className="h-7 w-44 text-xs"><SelectValue placeholder="Apply account to selected" /></SelectTrigger>
              <SelectContent>
                {accounts.map(a => (<SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Skipped files panel */}
      {skippedFiles.length > 0 && (
        <div className="border rounded-lg">
          <button
            type="button"
            onClick={onToggleSkippedPanel}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
          >
            {showSkippedPanel ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span>{skippedFiles.length} files skipped — click to see why</span>
          </button>
          {showSkippedPanel && (
            <ul className="px-3 pb-3 space-y-1.5 text-xs">
              {skippedFiles.map(f => (
                <li key={f.fileKey} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="h-3 w-3 text-amber-600 shrink-0" />
                    <span className="truncate" title={f.fileName}>{f.fileName}</span>
                    <span className="text-muted-foreground truncate">— {('reason' in f.status) ? f.status.reason : 'Unknown'}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {f.status.kind === 'empty' && (
                      <Button size="sm" variant="ghost" onClick={() => onReinclude(f.fileKey)}>Re-include</Button>
                    )}
                    <button type="button" onClick={() => onRemoveFile(f.fileKey)} aria-label={`Remove ${f.fileName}`}>
                      <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex justify-between gap-2 pt-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Button onClick={onNext} disabled={importDisabled}>
          Import {checkedFiles.length} file{checkedFiles.length === 1 ? '' : 's'} →
        </Button>
      </div>

      {!requiresAccount && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <InfoTooltip content="Returns and Settlement reports apply across all accounts — no per-file assignment needed." />
          Returns/Settlement files don&apos;t need account assignment.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If there are missing shadcn imports, install or stub appropriately.)

- [ ] **Step 3: Commit**

```bash
git add src/components/pnl/bulk-import/StepFileTable.tsx
git commit -m "feat(bulk-import): Step 3 — file table with skipped-panel and multi-select"
```

### Task 12: Step 4 — confirmation modal

**Files:**
- Create: `src/components/pnl/bulk-import/StepConfirm.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { AlertTriangle } from 'lucide-react'
import type { FileEntry, MarketplaceAccountLite, ReportType } from './types'

interface Props {
  reportType: ReportType
  files: FileEntry[]                                  // include-in-import + ready files only
  accounts: MarketplaceAccountLite[]
  overlapsByFileKey: Record<string, { existingRowCount: number; sampleExistingDate?: string }> | null
  isCheckingOverlap: boolean
  overlapCheckError: string | null
  verifiedAccountAssignment: boolean
  onSetVerifiedAccountAssignment: (v: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  onRetryOverlap: () => void
  onSkipOverlap: () => void
}

export function StepConfirm(props: Props) {
  const { files, accounts, overlapsByFileKey, isCheckingOverlap, overlapCheckError,
    verifiedAccountAssignment, onSetVerifiedAccountAssignment,
    onConfirm, onCancel, onRetryOverlap, onSkipOverlap, reportType } = props

  const totalRows = files.reduce((s, f) => f.status.kind === 'ready' ? s + f.status.rowCount : s, 0)

  // Group by account name (for P&L/Orders); single bucket for Returns/Settlement
  const accountNameById = new Map(accounts.map(a => [a.id, a.account_name]))
  const groups = new Map<string, FileEntry[]>()
  for (const f of files) {
    const key = (reportType === 'pnl' || reportType === 'orders')
      ? (f.marketplaceAccountId ? (accountNameById.get(f.marketplaceAccountId) ?? 'Unknown') : '— Unassigned')
      : '— Tenant-wide —'
    const arr = groups.get(key) ?? []
    arr.push(f)
    groups.set(key, arr)
  }

  return (
    <div className="space-y-4">
      <h3 className="font-medium">Confirm Import</h3>
      <p className="text-sm">
        About to import <strong>{files.length} {reportType.toUpperCase()} files</strong> · ~{totalRows} rows
      </p>

      {isCheckingOverlap && <p className="text-xs text-muted-foreground">Checking for existing data…</p>}

      {overlapCheckError && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-2">
          <p className="text-destructive">Overlap check failed: {overlapCheckError}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onRetryOverlap}>Retry overlap check</Button>
            <Button size="sm" variant="ghost" onClick={onSkipOverlap}>Skip overlap check and import anyway</Button>
          </div>
        </div>
      )}

      <div className="space-y-3 text-sm">
        {[...groups.entries()].map(([groupKey, groupFiles]) => {
          const groupRows = groupFiles.reduce((s, f) => f.status.kind === 'ready' ? s + f.status.rowCount : s, 0)
          return (
            <div key={groupKey} className="space-y-1">
              <p className="font-medium">{groupKey} — {groupFiles.length} files · ~{groupRows} rows</p>
              <ul className="text-xs text-muted-foreground space-y-1 pl-4">
                {groupFiles.map(f => {
                  const overlap = overlapsByFileKey?.[f.fileKey]
                  const range = f.status.kind === 'ready' ? `${f.status.dateRange.from} → ${f.status.dateRange.to}` : ''
                  return (
                    <li key={f.fileKey} className="space-y-0.5">
                      <div>{f.fileName} · {range} · {f.status.kind === 'ready' ? f.status.rowCount : 0} rows</div>
                      {overlap && overlap.existingRowCount > 0 && (
                        <div className="flex items-center gap-1 text-amber-700">
                          <AlertTriangle className="h-3 w-3" />
                          Already has {overlap.existingRowCount} rows in this range — will dedupe by Order Item ID
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Behavior: dedupe by Order Item ID — duplicates skipped, only new rows added.
      </p>

      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <Checkbox
          checked={verifiedAccountAssignment}
          onCheckedChange={(v) => onSetVerifiedAccountAssignment(!!v)}
          className="mt-0.5"
        />
        <span>I&apos;ve verified each file is assigned to the correct account (sample SKUs in the file table can help)</span>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={onConfirm} disabled={!verifiedAccountAssignment || isCheckingOverlap}>Confirm import</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/pnl/bulk-import/StepConfirm.tsx
git commit -m "feat(bulk-import): Step 4 — confirmation modal with verification checkbox"
```

### Task 13: Step 5 — live progress with beforeunload

**Files:**
- Create: `src/components/pnl/bulk-import/StepProgress.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'
import { useEffect } from 'react'
import { Progress } from '@/components/ui/progress'
import { Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import type { FileEntry } from './types'

interface Props {
  files: FileEntry[]                          // only the ones being imported, in order
  importStartedAt: number | null
  currentImportingFileKey: string | null
}

function fmtSecs(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export function StepProgress({ files, importStartedAt, currentImportingFileKey }: Props) {
  const completed = files.filter(f => f.status.kind === 'imported' || f.status.kind === 'failed').length
  const total = files.length
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0

  // ETA based on rolling average per completed file
  let eta: string | null = null
  if (importStartedAt && completed > 0 && completed < total) {
    const elapsed = Date.now() - importStartedAt
    const avgPerFile = elapsed / completed
    eta = fmtSecs(avgPerFile * (total - completed))
  }

  // beforeunload guard
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  return (
    <div className="space-y-4">
      <h3 className="font-medium">Importing {total} file{total === 1 ? '' : 's'}…</h3>
      <Progress value={percent} aria-valuenow={percent} aria-valuemax={100} role="progressbar" />
      <p className="text-xs text-muted-foreground">
        {completed} of {total} ({percent}%) {eta && `· ~${eta} remaining`}
      </p>
      <ul className="text-sm space-y-1">
        {files.map(f => {
          if (f.status.kind === 'imported') {
            return (
              <li key={f.fileKey} className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="truncate">{f.fileName}</span>
                <span className="text-xs text-muted-foreground">
                  — {f.status.imported} imported · {f.status.skipped} skipped · {f.status.mismatchedAccount} account-mismatch · {f.status.failed} failed
                </span>
              </li>
            )
          }
          if (f.status.kind === 'failed') {
            return (
              <li key={f.fileKey} className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="truncate">{f.fileName}</span>
                <span className="text-xs">— {f.status.reason}</span>
              </li>
            )
          }
          if (f.status.kind === 'uploading' || f.fileKey === currentImportingFileKey) {
            return (
              <li key={f.fileKey} className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span className="truncate">{f.fileName}</span>
                <span className="text-xs text-muted-foreground">— importing…</span>
              </li>
            )
          }
          return (
            <li key={f.fileKey} className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" />
              <span className="truncate">{f.fileName}</span>
              <span className="text-xs">— pending</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/pnl/bulk-import/StepProgress.tsx
git commit -m "feat(bulk-import): Step 5 — live progress with ETA and beforeunload guard"
```

### Task 14: Step 6 — results

**Files:**
- Create: `src/components/pnl/bulk-import/StepResults.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'
import { Button } from '@/components/ui/button'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import type { BulkImportState } from './types'

interface Props {
  summary: NonNullable<BulkImportState['finalSummary']>
  failedFiles: { fileName: string; reason: string }[]
  onClose: () => void
}

export function StepResults({ summary, failedFiles, onClose }: Props) {
  return (
    <div className="space-y-4">
      <h3 className="font-medium flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        Import Complete
      </h3>

      <div className="text-sm space-y-1">
        <p>{summary.imported} rows added · {summary.skippedDup} skipped (duplicates) · {summary.failed} row failures · {summary.mismatched} account-mismatched skips</p>
      </div>

      <div className="space-y-1 text-sm">
        <p className="font-medium text-xs uppercase text-muted-foreground tracking-wide">By account</p>
        {Object.entries(summary.perAccount).map(([accountName, stats]) => (
          <p key={accountName} className="text-xs">
            {accountName} · {stats.files} files · {stats.rows} rows
          </p>
        ))}
      </div>

      {failedFiles.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs space-y-1">
          <div className="flex items-center gap-2 text-amber-800 font-medium">
            <AlertTriangle className="h-3 w-3" />
            {failedFiles.length} file{failedFiles.length === 1 ? '' : 's'} failed:
          </div>
          <ul className="space-y-0.5 pl-5 list-disc">
            {failedFiles.map((f, i) => (
              <li key={i}>{f.fileName}: {f.reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/pnl/bulk-import/StepResults.tsx
git commit -m "feat(bulk-import): Step 6 — results screen with per-account aggregates"
```

---

## Chunk 4: Wrapper dialog + parser orchestration

### Task 15: Top-level BulkImportDialog wrapper

**Files:**
- Create: `src/components/pnl/BulkImportDialog.tsx`

- [ ] **Step 1: Create the component**

This component wires everything together. It:
- Loads accounts on mount
- Shows EmptyAccountsState if 0 accounts
- Owns the reducer + step transitions
- Hands off file parsing to the appropriate parser per report type
- Calls overlap-check API on confirm
- Sequentially POSTs to the appropriate import API per file
- Aggregates final summary

```tsx
'use client'

import { useEffect, useReducer, useCallback, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { parsePnlXlsx } from '@/lib/importers/pnl-xlsx-parser'
import { parseOrdersReport } from '@/lib/importers/orders-report-parser'
import { parseReturnsReport } from '@/lib/importers/returns-report-parser'
import { parseSettlementXlsx } from '@/lib/importers/settlement-report-parser'

import { reducer, initialState, MAX_FILES_PER_SESSION } from './bulk-import/bulk-import-state'
import type { FileEntry, ReportType, MarketplaceAccountLite, AnyParsedRow } from './bulk-import/types'

import { EmptyAccountsState } from './bulk-import/EmptyAccountsState'
import { StepReportType } from './bulk-import/StepReportType'
import { StepDropFiles } from './bulk-import/StepDropFiles'
import { StepFileTable } from './bulk-import/StepFileTable'
import { StepConfirm } from './bulk-import/StepConfirm'
import { StepProgress } from './bulk-import/StepProgress'
import { StepResults } from './bulk-import/StepResults'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete: () => void
  enabledReportTypes?: ReportType[]   // defaults to all four
}

const ALL_TYPES: ReportType[] = ['orders', 'returns', 'pnl', 'settlement']

function uuid(): string {
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function importApiFor(rt: ReportType): string {
  return rt === 'pnl' ? '/api/pnl/import'
    : rt === 'orders' ? '/api/pnl/import-orders'
    : rt === 'returns' ? '/api/pnl/import-returns'
    : '/api/pnl/import-settlement'
}

async function parseFile(rt: ReportType, file: File): Promise<{
  rows: AnyParsedRow[]
  rowCount: number
  dateRange: { from: string; to: string } | null
  sampleSkus: string[]
}> {
  let rows: AnyParsedRow[]
  if (rt === 'pnl') rows = await parsePnlXlsx(file)
  else if (rt === 'orders') rows = await parseOrdersReport(file)
  else if (rt === 'returns') rows = await parseReturnsReport(file)
  else rows = await parseSettlementXlsx(file)

  const validRows = rows.filter(r => !r.error)
  if (validRows.length === 0) {
    return { rows: validRows, rowCount: 0, dateRange: null, sampleSkus: [] }
  }

  // Date range — use whichever date field the parser exposes
  type AnyDate = { orderDate?: string; returnDate?: string; settlementDate?: string }
  const dates: string[] = validRows
    .map(r => (r as AnyDate).orderDate ?? (r as AnyDate).returnDate ?? (r as AnyDate).settlementDate ?? '')
    .filter(Boolean)
    .map(d => String(d).slice(0, 10))
  const dateRange = dates.length > 0
    ? { from: dates.reduce((a, b) => a < b ? a : b), to: dates.reduce((a, b) => a > b ? a : b) }
    : null

  // First 3 distinct SKUs
  type AnySku = { skuName?: string; sku?: string; platformSku?: string }
  const skuSet = new Set<string>()
  for (const r of validRows) {
    const s = (r as AnySku).skuName ?? (r as AnySku).sku ?? (r as AnySku).platformSku ?? ''
    if (s) {
      skuSet.add(s)
      if (skuSet.size >= 3) break
    }
  }

  return { rows: validRows, rowCount: validRows.length, dateRange, sampleSkus: [...skuSet] }
}

export function BulkImportDialog({ open, onOpenChange, onImportComplete, enabledReportTypes = ALL_TYPES }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [accounts, setAccounts] = useState<MarketplaceAccountLite[] | null>(null)

  // load accounts when dialog opens
  useEffect(() => {
    if (!open) return
    fetch('/api/marketplace-accounts')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load accounts')))
      .then((data: MarketplaceAccountLite[]) => setAccounts(data ?? []))
      .catch((e) => {
        toast.error((e as Error).message)
        setAccounts([])
      })
  }, [open])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) dispatch({ type: 'reset' })
  }, [open])

  const flipkartAccounts = useMemo(
    () => (accounts ?? []).filter(a => a.platform === 'flipkart'),
    [accounts],
  )

  // === handlers ===

  const handleFilesDropped = useCallback((accepted: File[], rejected: { file: File; reason: string }[]) => {
    if (!state.reportType) return
    const rt = state.reportType
    if (state.step === 'dropFiles') dispatch({ type: 'setStep', step: 'fileTable' })

    // Reject overflow
    if (rejected.length > 0) {
      for (const { file, reason } of rejected) {
        const entry: FileEntry = {
          fileKey: uuid(), fileName: file.name, fileSize: file.size, fileLastModified: file.lastModified,
          rows: null, status: { kind: 'unsupported', reason }, marketplaceAccountId: null,
          includeInImport: false, multiSelectChecked: false,
        }
        dispatch({ type: 'addSkipped', file: entry })
      }
    }

    // Dedup against existing files (same name + size + lastModified)
    const existingKeys = new Set([...state.files, ...state.skippedFiles].map(f => `${f.fileName}::${f.fileSize}::${f.fileLastModified}`))
    const dedupedAccepted = accepted.filter(f => !existingKeys.has(`${f.name}::${f.size}::${f.lastModified}`))
    const skippedAsDup = accepted.length - dedupedAccepted.length
    if (skippedAsDup > 0) toast.message(`${skippedAsDup} file${skippedAsDup === 1 ? '' : 's'} already added — ignored`)

    // Spawn parsing tasks
    for (const file of dedupedAccepted) {
      const fileKey = uuid()
      const entry: FileEntry = {
        fileKey, fileName: file.name, fileSize: file.size, fileLastModified: file.lastModified,
        rows: null, status: { kind: 'parsing' }, marketplaceAccountId: null,
        includeInImport: false, multiSelectChecked: false,
      }
      dispatch({ type: 'addFile', file: entry })
      ;(async () => {
        try {
          const result = await parseFile(rt, file)
          if (!result.dateRange) {
            dispatch({ type: 'fileEmpty', fileKey })
            return
          }
          dispatch({
            type: 'fileParsed',
            fileKey,
            rowCount: result.rowCount,
            dateRange: result.dateRange,
            sampleSkus: result.sampleSkus,
            rows: result.rows,
          })
        } catch (e) {
          dispatch({ type: 'fileParseError', fileKey, reason: (e as Error).message })
        }
      })()
    }
  }, [state.reportType, state.step, state.files, state.skippedFiles])

  const checkOverlapAndConfirm = useCallback(async () => {
    if (!state.reportType) return
    dispatch({ type: 'startOverlapCheck' })
    const checkedFiles = state.files.filter(f => f.includeInImport && f.status.kind === 'ready')
    try {
      const res = await fetch('/api/pnl/bulk-overlap-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportType: state.reportType,
          files: checkedFiles.map(f => ({
            fileKey: f.fileKey,
            marketplaceAccountId: f.marketplaceAccountId,
            dateRange: f.status.kind === 'ready' ? f.status.dateRange : { from: '1970-01-01', to: '1970-01-01' },
          })),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        dispatch({ type: 'overlapCheckError', reason: body.error ?? `HTTP ${res.status}` })
        return
      }
      const data = await res.json() as { overlaps: { fileKey: string; existingRowCount: number; sampleExistingDate?: string }[] }
      const map: Record<string, { existingRowCount: number; sampleExistingDate?: string }> = {}
      for (const o of data.overlaps) map[o.fileKey] = { existingRowCount: o.existingRowCount, sampleExistingDate: o.sampleExistingDate }
      dispatch({ type: 'overlapCheckSuccess', overlaps: map })
    } catch (e) {
      dispatch({ type: 'overlapCheckError', reason: (e as Error).message })
    }
  }, [state.reportType, state.files])

  const handleStartImport = useCallback(async () => {
    if (!state.reportType) return
    const rt = state.reportType
    const importApi = importApiFor(rt)
    const checkedFiles = state.files.filter(f => f.includeInImport && f.status.kind === 'ready')

    dispatch({ type: 'startImport' })

    let totalImported = 0, totalSkippedDup = 0, totalFailed = 0, totalMismatched = 0
    const perAccount: Record<string, { files: number; rows: number }> = {}

    for (const file of checkedFiles) {
      dispatch({ type: 'startImportingFile', fileKey: file.fileKey })
      try {
        const body: Record<string, unknown> = { rows: file.rows }
        if (rt === 'pnl' || rt === 'orders') body.marketplaceAccountId = file.marketplaceAccountId
        const res = await fetch(importApi, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          dispatch({ type: 'fileImportFailed', fileKey: file.fileKey, reason: json.error ?? `HTTP ${res.status}` })
          totalFailed += 1
          continue
        }
        const imported = json.imported ?? 0
        const skipped = json.skipped ?? 0
        const mismatchedAccount = json.mismatchedAccount ?? 0
        const failedRows = (Array.isArray(json.errors) ? json.errors.length : 0) ?? 0
        dispatch({
          type: 'fileImportSuccess',
          fileKey: file.fileKey,
          imported, skipped, mismatchedAccount, failed: failedRows,
        })
        totalImported += imported
        totalSkippedDup += skipped
        totalMismatched += mismatchedAccount
        // Per-account aggregate
        const acctName = file.marketplaceAccountId
          ? (flipkartAccounts.find(a => a.id === file.marketplaceAccountId)?.account_name ?? 'Unknown')
          : 'Tenant-wide'
        perAccount[acctName] = perAccount[acctName] ?? { files: 0, rows: 0 }
        perAccount[acctName].files += 1
        perAccount[acctName].rows += imported
      } catch (e) {
        dispatch({ type: 'fileImportFailed', fileKey: file.fileKey, reason: (e as Error).message })
        totalFailed += 1
      }
    }

    dispatch({
      type: 'finishImport',
      summary: {
        imported: totalImported,
        skippedDup: totalSkippedDup,
        failed: totalFailed,
        mismatched: totalMismatched,
        perAccount,
      },
    })
    onImportComplete()
  }, [state.reportType, state.files, flipkartAccounts, onImportComplete])

  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  // === render ===
  // Empty state if loaded and no flipkart accounts
  if (open && accounts !== null && flipkartAccounts.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Bulk Import</DialogTitle></DialogHeader>
          <EmptyAccountsState onClose={close} />
        </DialogContent>
      </Dialog>
    )
  }

  // include-in-import + ready files for steps 4/5/6
  const importableFiles = state.files.filter(f => f.includeInImport && f.status.kind === 'ready')
  const failedForResults = state.files
    .filter(f => f.status.kind === 'failed')
    .map(f => ({ fileName: f.fileName, reason: f.status.kind === 'failed' ? f.status.reason : 'Unknown' }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {state.step === 'reportType' && 'Bulk Import — Pick report type'}
            {state.step === 'dropFiles' && 'Bulk Import — Drop files'}
            {state.step === 'fileTable' && 'Bulk Import — Review files'}
            {state.step === 'confirm' && 'Bulk Import — Confirm'}
            {state.step === 'progress' && 'Bulk Import — Importing'}
            {state.step === 'results' && 'Bulk Import — Complete'}
          </DialogTitle>
        </DialogHeader>

        {state.step === 'reportType' && (
          <StepReportType
            selected={state.reportType}
            onSelect={(rt) => enabledReportTypes.includes(rt) && dispatch({ type: 'setReportType', reportType: rt })}
            onNext={() => dispatch({ type: 'setStep', step: 'dropFiles' })}
            onCancel={close}
          />
        )}
        {state.step === 'dropFiles' && (
          <StepDropFiles
            onFilesDropped={handleFilesDropped}
            onBack={() => dispatch({ type: 'setStep', step: 'reportType' })}
            currentFileCount={state.files.length + state.skippedFiles.length}
          />
        )}
        {state.step === 'fileTable' && state.reportType && (
          <StepFileTable
            reportType={state.reportType}
            files={state.files}
            skippedFiles={state.skippedFiles}
            showSkippedPanel={state.showSkippedPanel}
            accounts={flipkartAccounts}
            onSetAccount={(fileKey, accountId) => dispatch({ type: 'setAccount', fileKey, accountId })}
            onApplyAccountToSelected={(accountId) => dispatch({ type: 'applyAccountToSelected', accountId })}
            onSetMultiSelect={(fileKey, selected) => dispatch({ type: 'setMultiSelect', fileKey, selected })}
            onSetIncludeInImport={(fileKey, include) => dispatch({ type: 'setIncludeInImport', fileKey, include })}
            onRemoveFile={(fileKey) => dispatch({ type: 'removeFile', fileKey })}
            onReinclude={(fileKey) => dispatch({ type: 'reincludeSkipped', fileKey })}
            onToggleSkippedPanel={() => dispatch({ type: 'setShowSkippedPanel', show: !state.showSkippedPanel })}
            onBack={() => dispatch({ type: 'setStep', step: 'dropFiles' })}
            onNext={() => {
              dispatch({ type: 'setStep', step: 'confirm' })
              checkOverlapAndConfirm()
            }}
          />
        )}
        {state.step === 'confirm' && state.reportType && (
          <StepConfirm
            reportType={state.reportType}
            files={importableFiles}
            accounts={flipkartAccounts}
            overlapsByFileKey={state.overlapsByFileKey}
            isCheckingOverlap={state.isCheckingOverlap}
            overlapCheckError={state.overlapCheckError}
            verifiedAccountAssignment={state.verifiedAccountAssignment}
            onSetVerifiedAccountAssignment={(v) => dispatch({ type: 'setVerifiedAccountAssignment', verified: v })}
            onConfirm={handleStartImport}
            onCancel={() => dispatch({ type: 'setStep', step: 'fileTable' })}
            onRetryOverlap={checkOverlapAndConfirm}
            onSkipOverlap={() => dispatch({ type: 'overlapCheckSuccess', overlaps: {} })}
          />
        )}
        {state.step === 'progress' && (
          <StepProgress
            files={importableFiles}
            importStartedAt={state.importStartedAt}
            currentImportingFileKey={state.currentImportingFileKey}
          />
        )}
        {state.step === 'results' && state.finalSummary && (
          <StepResults
            summary={state.finalSummary}
            failedFiles={failedForResults}
            onClose={close}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// useState import was missed in body — add at top
import { useState } from 'react'
```

> **Implementation note:** the `useState` import at the bottom is intentional in the snippet above — when you actually create the file, place it at the top with the other React imports. The import was placed there in the inline snippet to keep the structure visible.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. Some import shapes (the parser return types) may need adjustment depending on actual signatures of the existing parsers — verify each `parseXxx` function's argument shape (some take `File`, some take `ArrayBuffer`).

- [ ] **Step 3: Commit**

```bash
git add src/components/pnl/BulkImportDialog.tsx
git commit -m "feat(bulk-import): top-level wrapper dialog wiring all 6 steps"
```

---

## Chunk 5: Wire into /pnl page

### Task 16: Add Bulk Import button + URL intent handler

**Files:**
- Modify: `src/app/(dashboard)/pnl/page.tsx`

- [ ] **Step 1: Read the current /pnl page**

Locate the existing "Import" button (probably wrapped in a `PnlImportDialog`). Note the import statements at the top.

- [ ] **Step 2: Add imports**

```typescript
import { useSearchParams, useRouter } from 'next/navigation'
import { Layers } from 'lucide-react'
import { BulkImportDialog } from '@/components/pnl/BulkImportDialog'
```

- [ ] **Step 3: Add state + URL-param handler**

Inside the page component:

```typescript
const searchParams = useSearchParams()
const router = useRouter()
const [bulkImportOpen, setBulkImportOpen] = useState(false)

// Auto-open bulk dialog if landed via deep-link
useEffect(() => {
  if (searchParams.get('intent') === 'bulk-import') {
    setBulkImportOpen(true)
    // Clean the URL so refresh doesn't re-open
    router.replace('/pnl')
  }
}, [searchParams, router])
```

- [ ] **Step 4: Add the button**

Next to the existing "Import" button, add:

```tsx
<Button variant="outline" onClick={() => setBulkImportOpen(true)}>
  <Layers className="h-4 w-4 mr-2" />
  Bulk Import
</Button>
```

- [ ] **Step 5: Mount the dialog**

At the bottom of the JSX (typically next to the existing `PnlImportDialog`):

```tsx
<BulkImportDialog
  open={bulkImportOpen}
  onOpenChange={setBulkImportOpen}
  onImportComplete={() => {
    // Whatever the existing /pnl page does on import-complete (refetch etc.)
    // Match the pattern used by PnlImportDialog
  }}
/>
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(dashboard\)/pnl/page.tsx
git commit -m "feat(pnl): Bulk Import button on /pnl + ?intent=bulk-import deep-link handler"
```

---

## Chunk 6: Deploy + smoke test

### Task 17: Type-check, push, deploy

- [ ] **Step 1: Final type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Push and deploy**

```bash
git push origin main
ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=no root@46.225.117.86 "cd /opt/fk-tool && bash deploy.sh"
```

Expected: container restarts with "Container fk-tool Started".

### Task 18: Smoke test on live site

Open https://ecommerceforall.in/pnl.

- [ ] **Step 1: Verify "Bulk Import" button appears** next to existing "Import" button

- [ ] **Step 2: Empty-account state**
  - In a tenant with 0 Flipkart accounts (or temporarily delete all to test), open Bulk Import → verify empty state with "Open Settings →" link
  - Re-add accounts before next step

- [ ] **Step 3: Step 1 — Pick P&L type**
  - Click "Bulk Import" → verify Step 1 renders with 4 type cards + first-time hint
  - Click P&L → "Next" enables → click Next

- [ ] **Step 4: Step 2 — drop 3 P&L files** (use the actual sample files from your Desktop folder)
  - Drop 3 valid `.xlsx` P&L files
  - Verify dialog flips to Step 3 (file table)

- [ ] **Step 5: Step 3 verify rows**
  - Each file shows: filename, date range, sample SKUs (≤3), account dropdown, Ready status
  - Aggregate "Parsing N of M" indicator was visible briefly during parsing

- [ ] **Step 6: Try edge cases**
  - Drop a `.pdf` → verify it lands in skipped panel with "Unsupported file type"
  - Drop the same valid `.xlsx` again → verify toast "(already added)" and no duplicate row
  - Drop an empty `.xlsx` (create one: open in Excel, delete all rows, save) → verify it lands in skipped with "0 rows"
  - Click "Re-include" on the empty file → verify it appears in main table

- [ ] **Step 7: Account assignment**
  - Manually pick accounts per file via dropdowns
  - Shift-click 2+ rows → verify "Apply account to selected" dropdown appears
  - Pick an account → verify all selected rows update

- [ ] **Step 8: Click Import N files**
  - Verify "Checking for existing data…" loading state
  - Confirmation modal renders with per-account summary + overlap warnings
  - Try clicking Confirm without ticking the verification checkbox → button is disabled
  - Tick the checkbox → button enables → click Confirm

- [ ] **Step 9: Step 5 — progress**
  - Verify progress bar + per-file status
  - Try to close the tab → `beforeunload` warning fires

- [ ] **Step 10: Step 6 — results**
  - Verify per-file + per-account aggregates
  - Imported rows visible on `/pnl` Overview after closing dialog

- [ ] **Step 11: Re-run import**
  - Re-import the same files → verify dedupe (skipped count > 0, imported count = 0)

- [ ] **Step 12: Test other report types**
  - Repeat steps 3-10 for Orders, Returns, Settlement
  - Verify Returns/Settlement do NOT show account dropdown
  - Verify confirmation modal labels them as "Tenant-wide"

- [ ] **Step 13: ?intent=bulk-import deep-link**
  - Navigate to `https://ecommerceforall.in/pnl?intent=bulk-import` → verify Bulk Import dialog auto-opens
  - Close dialog → verify URL is now `/pnl` (clean)

- [ ] **Step 14: Account-mismatch safety**
  - Find a P&L file whose orders are linked to Account A
  - Bulk-import it but assign Account B
  - Verify the results screen shows non-zero `mismatchedAccount` count
  - Open `/pnl` Overview → verify Account A's data did NOT get overwritten with Account B's metadata

---

## Done

Update spec status to shipped:

```bash
# Edit docs/superpowers/specs/2026-04-25-bulk-pnl-importer-design.md
# Change "Status: Draft v2 (reviewed and revised)" → "Status: Shipped 2026-04-25"
git add docs/superpowers/specs/2026-04-25-bulk-pnl-importer-design.md
git commit -m "docs: mark bulk pnl importer spec as shipped"
git push origin main
```
