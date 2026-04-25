# Bulk P&L Importer — Design Spec

**Date:** 2026-04-25
**Status:** Draft, awaiting review

## Goal

Let a seller bulk-load Flipkart historical reports (Orders / Returns / P&L / Settlement) — across many accounts and many months — into the existing FK-Tool P&L data layer (`orders`, `order_financials`) in a single dialog session, instead of repeating the existing single-file import wizard once per file.

## Why now

The new Daily P&L Estimator at `/daily-pnl` is a temporary parallel stack with its own `dp_*` tables. The medium-term plan is to fold its benchmark reads back onto `order_financials` once enough historical depth is available in the main system. That requires backfilling several months of historical reports per Flipkart account into `order_financials` first — a task that's painful with the existing one-file-at-a-time import dialog.

This spec covers the bulk importer that unblocks that backfill. Once shipped, the team can load 9+ months of history across 4+ accounts in a single sitting.

## Non-goals (deferred to future work)

- Re-architecting the existing single-file `PnlImportDialog` (it stays as-is for ad-hoc one-offs)
- Folding Daily P&L Estimator's `dp_*` tables back onto the main schema (separate effort, after backfill)
- Persistent upload session that survives a browser close (real engineering effort; not required for a one-time backfill activity)
- Auto-detecting report type so users can drop mixed types in one batch (Approach A's flagship feature; deferred until we see real usage patterns from the type-led flow)
- Folder-based drop ("here's everything for NuvioCentral"; deferred — random Flipkart filenames make this brittle anyway)

## Architecture

### High-level flow (type-led, "Approach C")

```
1. User clicks "Bulk Import" on /pnl page
2. Dialog opens at Step 1: pick ONE report type (P&L / Orders / Returns / Settlement)
3. Step 2: drop multiple files of that type → parsed in parallel in browser
4. Step 3: review file table → assign accounts, tick/untick, multi-select bulk-assign
5. Step 4: pre-import confirmation modal — summary, per-file overlap warnings, final go/no-go
6. Step 5: sequential import with live per-file progress
7. Step 6: final summary screen with aggregate stats + per-file outcomes
8. Repeat from Step 1 if other report types remain (each session is one type)
```

### Component structure

```
src/components/pnl/
  PnlImportDialog.tsx              (existing — unchanged)
  BulkImportDialog.tsx             (new — wraps the wizard described above)
  bulk-import/
    StepReportType.tsx
    StepDropFiles.tsx
    StepFileTable.tsx
    StepConfirm.tsx
    StepProgress.tsx
    StepResults.tsx
    types.ts
    bulk-import-state.ts          (state machine + per-file lifecycle)
```

The wrapper `BulkImportDialog` is a single shadcn `Dialog` that swaps its body between Step components. No URL routing — modal-internal state via a small reducer in `bulk-import-state.ts`.

### Reusability

`BulkImportDialog` is designed to be **portable** to other surfaces in the app later (e.g., a "bulk Orders importer" embedded inside the future Daily P&L Estimator v2). Achieved by:

- Props drive the parser, the import API path, and whether per-file account assignment is needed.
- No hard-coded references to `/pnl` or `/daily-pnl` — the dialog doesn't know where it's mounted.
- Result rows include the `marketplace_account_id` and import API path verbatim, so the dialog never has to "know" what data layer it's writing to.

```typescript
interface BulkImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete: () => void

  // What kinds of reports this dialog supports in this mount.
  // /pnl mounts it with all 4. A future surface could mount it with just 'orders'.
  enabledReportTypes: ReportType[]
}
```

### Reuse over rewrite

All parsing and import logic already exists in the codebase. The bulk dialog is purely an orchestration shell.

| Concern | Existing module reused |
|---|---|
| P&L parsing | `src/lib/importers/pnl-xlsx-parser.ts` |
| Orders parsing | `src/lib/importers/orders-report-parser.ts` |
| Returns parsing | `src/lib/importers/returns-report-parser.ts` |
| Settlement parsing | `src/lib/importers/settlement-report-parser.ts` |
| P&L import | `POST /api/pnl/import` |
| Orders import | `POST /api/pnl/import-orders` |
| Returns import | `POST /api/pnl/import-returns` |
| Settlement import | `POST /api/pnl/import-settlement` |
| Duplicate check | `POST /api/pnl/check-duplicates` |
| Marketplace accounts | `GET /api/marketplace-accounts` |

**One new server endpoint** is required: a batched overlap-check (see Data Flow).

**No DB schema changes.**

## Data flow

### Per-file lifecycle inside the dialog

```
File dropped
   ↓
Parsed in browser (existing parser)
   ↓
Auto-detected: row_count, date_range (min/max order_date),
  sample_row { sku, order_date, status }
   ↓
User assigns account (P&L + Orders only — Returns/Settlement skip this)
   ↓
On "Import All": single batched overlap-check API call
   ↓
User confirms in pre-import modal
   ↓
Sequential POST per file to the appropriate import API
   ↓
Per-file result captured (imported / skipped / errors)
   ↓
Final summary aggregates all per-file results
```

### New endpoint: overlap pre-check

`POST /api/pnl/bulk-overlap-check`

**Request:**
```typescript
{
  reportType: 'pnl' | 'orders' | 'returns' | 'settlement'
  files: Array<{
    fileKey: string                       // client-side identifier
    marketplaceAccountId: string | null   // null for returns/settlement
    dateRange: { from: string; to: string }   // YYYY-MM-DD
  }>
}
```

**Response:**
```typescript
{
  overlaps: Array<{
    fileKey: string
    existingRowCount: number              // 0 = no overlap
    sampleExistingDate?: string           // earliest existing row in the date range
  }>
}
```

Read-only, runs as a single batched query per file. Powers the inline overlap warnings in the confirmation modal.

Implementation per report type:

| Report type | Overlap query target |
|---|---|
| P&L | `order_financials` joined to `orders` on `order_item_id` where `marketplace_account_id = X AND order_date BETWEEN from AND to AND tenant_id = current` |
| Orders | `orders` where same filter |
| Returns | `orders` where `return_date BETWEEN from AND to AND tenant_id = current` |
| Settlement | `orders` where `settlement_date BETWEEN from AND to AND tenant_id = current` |

## UI / UX

### Step 1 — Pick report type

Four large radio cards using the existing `REPORT_TYPES` config from `PnlImportDialog`. Single selection per session.

```
┌──────────────────────┐  ┌──────────────────────┐
│ 📦 Orders Report     │  │ ↩️  Returns Report   │
│ Lifecycle data       │  │ RTO/RVP details      │
└──────────────────────┘  └──────────────────────┘
┌──────────────────────┐  ┌──────────────────────┐
│ 💰 P&L Report        │  │ 🏦 Settlement Report │
│ Fee breakdown        │  │ Payment details      │
└──────────────────────┘  └──────────────────────┘

[Cancel]                              [Next: Drop files →]
```

### Step 2 — Drop files

Single large drop zone, accepts `.xlsx` / `.csv`, multiple files. After drop, files start parsing immediately and the dialog flips to Step 3 with rows rendering progressively as each parse completes.

```
┌─────────────────────────────────────────┐
│                                         │
│      Drop your P&L files here           │
│      (or click to browse)               │
│                                         │
│      Multiple files OK                  │
│                                         │
└─────────────────────────────────────────┘

[← Back]
```

### Step 3 — File table (the workhorse view)

```
┌─┐  Filename            Type        Date Range          Sample row                              Account              Rows    Status
├─┤  ☑ aBc123XYZ.xlsx    P&L         Mar 1–31, 2025      SKU 'NUVIO-WMDH-100', 2025-03-01        [NuvioCentral ▾]    1,234   ✅ Ready
├─┤  ☑ qRs456pDq.xlsx    P&L         Apr 1–30, 2025      SKU 'XYDROG-VAC', 2025-04-02            [NuvioCentral ▾]    1,089   ✅ Ready
├─┤  ☑ ZzZ789aBc.xlsx    P&L         May 1–31, 2025      SKU 'NUV-ROMPER', 2025-05-01            [BodhNest ▾]        2,341   ✅ Ready
├─┤  ☐ broken.xlsx       —           —                   —                                       —                   —       ❌ Missing Order Item ID column
└─┘

Selected: 3 files (~4,664 rows)                                         [Apply account to selected ▾]

[← Back]                                                                                       [Import 3 files →]
```

**Controls:**
- **Per-row checkbox** → unchecked rows are excluded from import.
- **Account dropdown** is required for P&L and Orders rows; disabled and shown as `—` for Returns and Settlement rows (the existing `needsAccountStep()` rule).
- **Sample row column** shows the file's first valid data row in compact form (`SKU 'X', date Y`) so the user can sanity-check before assigning account. Reduces wrong-account assignments — the user can confirm "yes, this is BodhNest data" by recognising a SKU.
- **Multi-select bulk-assign:** ticking the master checkbox in the header row enters multi-select mode; an "Apply account to selected ▾" dropdown appears next to the row count and applies the chosen account to every ticked row in one click.
- **Parse errors** auto-uncheck the row, render it red, and tooltip shows the parse error.
- **Import button** is disabled if any *checked* P&L/Orders row is missing an account.

### Step 4 — Pre-import confirmation modal

Triggered by "Import N files":

```
┌─────────────────────────────────────────────────┐
│ Confirm Import                                  │
├─────────────────────────────────────────────────┤
│ About to import 9 P&L files                     │
│                                                 │
│ NuvioCentral — 4 files                          │
│   Mar 2025 — 1,234 rows                         │
│   Apr 2025 — 1,089 rows                         │
│   May 2025 — 1,256 rows                         │
│   ⚠️ Already has 567 rows for Jun 2025          │
│      → will dedupe by Order Item ID             │
│                                                 │
│ BodhNest — 5 files                              │
│   Mar–Jul 2025 — 5,432 rows                     │
│                                                 │
│ Total: 9 files, ~9,011 rows                     │
│ Behavior: dedupe by Order Item ID — duplicates  │
│ skipped, only new rows added.                   │
│                                                 │
│              [Cancel]    [Confirm import]       │
└─────────────────────────────────────────────────┘
```

Overlap warnings rendered inline per file. User can still confirm — existing dedup logic protects data integrity.

### Step 5 — Live progress

Sequential import. One file at a time. Progress list updates live:

```
Importing 9 files...

✅ aBc123XYZ.xlsx — 1,234 rows imported, 0 skipped (1.2s)
✅ qRs456pDq.xlsx — 1,089 rows imported, 0 skipped (1.1s)
🔄 ZzZ789aBc.xlsx — importing...
⏸ ...4 more pending
```

A file failure does NOT abort the batch — it's captured in per-file results and import continues with the next file.

### Step 6 — Final results

```
Import Complete

✅ 8 files imported successfully (8,567 rows added)
⚠️ 1 file with errors:
   • broken.xlsx: Account permission denied

Total imported: 8,567 rows
Total skipped (duplicates): 444 rows

[Close]
```

`onImportComplete` callback fires (matches existing dialog behavior) so the parent `/pnl` page refreshes its data.

## Error handling

| Scenario | Behavior |
|---|---|
| File doesn't parse | Row marked red, auto-unchecked, tooltip shows parse error |
| User skips assigning account on a checked P&L/Orders file | Import button disabled until resolved |
| Overlap detected | Soft warning in confirmation modal; user can still proceed (dedup runs server-side) |
| Single file fails server-side mid-import | Per-file result captures error; remaining files still import |
| User closes dialog mid-import | Confirm prompt: "Cancel remaining imports? Already-imported files are kept." |
| Network failure during a file's import | That file's result shows the error; user can retry the whole bulk session afterwards |
| Empty file (0 rows after parse) | Row shows "0 rows" status; allowed to import (server treats as no-op) |
| Browser closed mid-import | Already-imported files persist (server-side commit per file); session state is lost (deferred to v2) |

## Testing strategy

### Unit
- Existing parsers/importers already covered.
- New: bulk overlap-check helper functions (date-range + account aggregation), state machine transitions.

### Integration
- Mock the four import APIs and the overlap-check API. Drop 3 files of each report type, assert sequential import calls in correct order with correct payloads.
- Mock 2-of-3 file overlap; assert confirmation modal renders the right warning per file.
- Assert "Apply to selected" updates only ticked rows' account assignment.

### Manual smoke test (mandatory before deploy)
On the live site after deploy:
1. `/pnl` → click "Bulk Import"
2. Pick "P&L Report"
3. Drop 3+ P&L files (mix of overlapping + non-overlapping ranges, mix of accounts)
4. Verify date ranges + sample rows auto-populate on each row
5. Use multi-select + "Apply account to selected" to bulk-assign → verify behavior
6. Click Import — verify confirmation modal shows correct overlap warnings
7. Confirm → verify sequential progress + correct final results
8. Repeat for Orders / Returns / Settlement
9. Verify imported data appears in the existing P&L tab (Overview, Products, Cash Flow tabs)
10. Re-import the same files → verify dedupe (should report 0 new rows)

## Implementation budget

Single dev with sub-agent execution:
- Step components (6 components) — ~1.5 days
- Overlap-check endpoint — ~0.5 day
- State machine + multi-select + sample preview wiring — ~1 day
- Manual + integration testing on real Flipkart reports — ~0.5 day

**Estimated total: ~3.5 dev-days.**

## Open design points (please confirm during review)

1. **Overlap warning behavior** when the system detects existing data for the file's date range:
   - **Default chosen:** soft warning + allow proceed (existing dedup-by-`order_item_id` already prevents data corruption; blocking adds friction for legitimate "fill in stragglers" cases).
   - Alternative: hard block; smart auto-uncheck.

2. **"Bulk Import" button placement** on `/pnl`:
   - **Default chosen:** second button next to existing "Import" (e.g., a stack icon labelled "Bulk Import"). Single-file flow stays untouched.
   - Alternative: replace single-file with unified dialog (rejected — riskier diff).

3. **Sequential vs parallel imports** within a session:
   - **Default chosen:** sequential. Predictable server load, simple per-file progress UI.
   - Alternative: parallel with concurrency cap (deferred until proven needed).
