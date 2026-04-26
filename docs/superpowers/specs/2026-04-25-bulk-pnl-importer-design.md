# Bulk P&L Importer — Design Spec

**Date:** 2026-04-25
**Status:** Draft v2 (reviewed and revised)

## Goal

Let a seller bulk-load Flipkart historical reports (Orders / Returns / P&L / Settlement) — across many accounts and many months — into the existing FK-Tool P&L data layer (`orders`, `order_financials`) in a single dialog session, instead of repeating the existing single-file import wizard once per file.

## Why now

The new Daily P&L Estimator at `/daily-pnl` is a temporary parallel stack with its own `dp_*` tables. The medium-term plan is to fold its benchmark reads onto `order_financials` once enough historical depth is available. That requires backfilling several months of historical reports per Flipkart account into `order_financials` first. The existing one-file-at-a-time dialog is too slow for that.

This spec covers the bulk importer that unblocks the backfill. Once shipped, the team can load 9+ months of history across multiple accounts in one sitting.

## Non-goals (deferred to future work)

- Re-architecting the existing single-file `PnlImportDialog` (it stays as-is for ad-hoc one-offs)
- Folding `dp_*` tables back onto the main schema (separate effort, after backfill)
- Persistent upload session that survives a browser close (real engineering effort; not required for one-time backfill)
- Auto-detecting report type so users can drop mixed types in one batch
- Folder-based drop ("here's everything for NuvioCentral")
- Mobile / responsive layout — this is a desktop-only feature (a backfill is an at-desk activity)
- Reverting / undoing an import session

## Architecture

### High-level flow (type-led, "Approach C")

```
1. User clicks "Bulk Import" on /pnl page
2. Dialog opens at Step 1: pick ONE report type
3. Step 2: drop multiple files of that type → parsed in parallel in browser
4. Step 3: review file table → assign accounts, tick/untick, multi-select bulk-assign
5. Step 4: pre-import confirmation modal — summary, per-file overlap warnings,
           verification checkbox, final go/no-go
6. Step 5: sequential import with live per-file + aggregate progress
7. Step 6: final summary screen with per-file + per-account aggregate stats
8. Repeat from Step 1 if other report types remain (each session is one type)
```

### Component structure

```
src/components/pnl/
  PnlImportDialog.tsx              (existing — unchanged)
  BulkImportDialog.tsx             (new — wraps the wizard)
  bulk-import/
    StepReportType.tsx
    StepDropFiles.tsx
    StepFileTable.tsx
    StepConfirm.tsx
    StepProgress.tsx
    StepResults.tsx
    EmptyAccountsState.tsx        (new — when 0 accounts exist)
    types.ts
    bulk-import-state.ts          (state machine + per-file lifecycle)
```

### Reusability

`BulkImportDialog` is designed to be **portable** to other surfaces (e.g., embedded inside Daily P&L Estimator v2 for bulk Orders upload). Achieved by:

- Props drive the parser, the import API path, and whether per-file account assignment is needed
- No hard-coded references to `/pnl` or `/daily-pnl` — the dialog doesn't know where it's mounted
- Result rows include `marketplace_account_id` and import API path verbatim

```typescript
interface BulkImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete: () => void
  enabledReportTypes: ReportType[]    // /pnl mounts all 4; future surfaces can subset
}
```

### Reuse over rewrite

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

**One new server endpoint:** batched overlap-check (see Data Flow). **No DB schema changes.**

### CSV / XLSX support per report type

Verified during planning:

| Report type | Accepted formats |
|---|---|
| Orders | `.xlsx` |
| Returns | `.xlsx` |
| P&L | `.xlsx` (multi-sheet — parser already targets `Orders P&L` sheet) |
| Settlement | `.xlsx` |

For v1, **`.csv` is NOT advertised** as supported in the drop zone's `accept` prop (Flipkart Seller Hub only exports `.xlsx`). The drop zone explicitly accepts `.xlsx` only and rejects others (see Empty States section).

**Case-insensitive extension matching:** the `accept` prop must include both `.xlsx` and `.XLSX` patterns to handle uppercase extensions on Windows downloads.

### Enrichment-path safety for marketplace_account_id

**Critical implementation detail discovered during review.** The existing `pnl-import-server.ts` has TWO write paths:

1. **Insert path** (new order_item_id) — sets `marketplace_account_id` from the bulk-import's assigned account. Safe.
2. **Enrichment path** (matches existing order via `order_item_id`/`platform_order_id`) — currently does an `UPDATE` that does NOT touch `marketplace_account_id`. Unsafe for bulk import.

**Risk:** if the user accidentally assigns NuvioCentral's P&L file to BodhNest in bulk, the enrichment path silently keeps the existing (correct, label-derived) `marketplace_account_id` while writing financial data — the financial figures are correct per-order but the assignment audit trail is misleading.

**Required server-side change as part of this spec:** before enriching, the import server MUST:
1. Read the existing order's `marketplace_account_id`
2. Compare to the assigned `marketplaceAccountId` in the import request
3. **If they differ AND the existing one is non-null:**
   - Default behavior: SKIP the enrichment for that row, count it in `mismatched_account` in the result
   - Bulk Importer surfaces these in Step 6: "X rows skipped — assigned to Y but already linked to Z. Verify file-account mapping."
4. **If existing is null** (legacy data): proceed with enrichment AND set `marketplace_account_id` to the assigned value (backfill).

This adds ~half a day to implementation but is required to honor the verification-checkbox guarantee.

## Data flow

### Per-file lifecycle inside the dialog

```
File dropped
   ↓
Browser-side parse (existing parser, runs in Web Worker for files > 10MB)
   ↓
Auto-detected: row_count, date_range (min/max order_date),
  sample_rows (first 3 distinct SKUs)
   ↓
User assigns account (P&L + Orders only — Returns/Settlement skip this)
   ↓
On "Import All": single batched overlap-check API call (with loading state)
   ↓
User confirms in pre-import modal (with verification checkbox)
   ↓
Sequential POST per file to the appropriate import API
   ↓
Per-file result captured (imported / skipped-duplicate / failed-row)
   ↓
Final summary aggregates per-file + per-account totals
```

### NEW endpoint: overlap pre-check

`POST /api/pnl/bulk-overlap-check`

**Request:**
```typescript
{
  reportType: 'pnl' | 'orders' | 'returns' | 'settlement'
  files: Array<{
    fileKey: string
    marketplaceAccountId: string | null   // null for returns/settlement
    dateRange: { from: string; to: string }
  }>
}
```

**Response:**
```typescript
{
  overlaps: Array<{
    fileKey: string
    existingRowCount: number              // 0 = no overlap
    sampleExistingDate?: string
  }>
}
```

Read-only, runs as a single batched query per file. Implementation per report type:

| Report type | Overlap query target | Per-account filter? |
|---|---|---|
| P&L | `order_financials` joined to `orders` where `marketplace_account_id = X AND order_date BETWEEN from AND to AND tenant_id = current` | Yes |
| Orders | `orders` where `marketplace_account_id = X AND order_date BETWEEN from AND to AND tenant_id = current` | Yes |
| Returns | `orders` where `return_request_date BETWEEN from AND to AND tenant_id = current` | **No (tenant-wide)** |
| Settlement | `orders` where `settlement_date BETWEEN from AND to AND tenant_id = current` | **No (tenant-wide)** |

**Important caveat for Returns and Settlement:** these report types don't carry a `marketplace_account_id` (they're matched by `order_item_id` against the existing orders table, regardless of which account the order belongs to). The overlap count is therefore **tenant-wide** for these types — it tells you "your tenant already has N return rows in this date range" without breaking that down per-account. The confirmation modal renders this honestly: "Tenant already has 234 return rows in Mar 2025 — duplicates dedupe by Order Item ID."

**Schema note:** the column is named `return_request_date` in `orders` (not `return_date`). The Returns server-side import writes both `return_request_date` and `return_complete_date`; we use `return_request_date` for the overlap query because it aligns with Flipkart's "report period" semantics (when the return was filed, not when it was completed).

## UI / UX

### Pre-flight: zero-account empty state

If `GET /api/marketplace-accounts` returns 0 Flipkart accounts when the dialog opens:

```
┌──────────────────────────────────────────────────┐
│ Set up an account first                          │
├──────────────────────────────────────────────────┤
│ You need at least one Flipkart marketplace       │
│ account before you can import reports.           │
│                                                  │
│ Accounts represent each Seller Hub login you     │
│ operate (e.g. NuvioCentral, BodhNest).           │
│                                                  │
│           [Open Settings →]                      │
└──────────────────────────────────────────────────┘
```

The wizard never starts until at least one account exists.

### Step 1 — Pick report type (with first-time orientation)

Four large radio cards. Above the cards (visible on every session, dismissible "for the next 30 days" via localStorage):

```
First time importing? Each report type comes from a
different page in Flipkart Seller Hub. [Where to download →]
```

The link opens a small popover with one-line guidance per report type plus an external link to Flipkart Seller Hub.

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

Single drop zone, `.xlsx` only, multiple. Files start parsing as soon as they drop; the dialog flips to Step 3 immediately and rows render progressively.

```
┌─────────────────────────────────────────┐
│                                         │
│      Drop your P&L files here           │
│      (or click to browse)               │
│                                         │
│      Multiple files OK · .xlsx only     │
│      Max 50 files · 50 MB per file      │
└─────────────────────────────────────────┘

[← Back]
```

**Limits enforced:**
- Max 50 files per session (soft cap with warning past 30; hard reject at 50)
- Max 50 MB per file (hard reject)
- Rejected files (wrong format, too large, parse-failed) appear as red rows in Step 3 with the rejection reason

**Parsing strategy:** for v1, parse on the main thread synchronously per file. The xlsx parser is fast enough for typical Flipkart exports (single-month data is well under 5 MB). For files > 10 MB, the UI may briefly stutter while parsing — acceptable for a low-frequency backfill activity.

> **Web Worker deferred to v2.** Adding a Web Worker for xlsx parsing requires bundler config (worker-loader for the `xlsx` chunk; cf. the `pdf.worker.min.mjs` precedent in CLAUDE.md). That's ~1.5 days of work for a rare-file optimisation. v2 candidate.

### Step 3 — File table

```
                                                                                              Account              Status
┌─┐ × ☑ aBc123XYZ.xlsx   P&L     Mar 1–31, 2025   NUVIO-WMDH, XYDROG-VAC, NUV-ROMPER (+12)   [NuvioCentral ▾]    ✅ Ready · 1,234 rows
├─┤ × ☑ qRs456pDq.xlsx   P&L     Apr 1–30, 2025   NUVIO-WMDH, XYDROG-VAC (+5 more)            [NuvioCentral ▾]    🔄 Parsing…
├─┤ × ☑ ZzZ789aBc.xlsx   P&L     May 1–31, 2025   NUV-ROMPER, NIRVA (+8 more)                 [BodhNest ▾]        ✅ Ready · 2,341 rows
├─┤ × ☐ broken.xlsx      —       —                —                                            —                   ❌ Error · Missing Order Item ID column
├─┤ × ☐ dupe.pdf         —       —                —                                            —                   ❌ Error · Unsupported file type (.xlsx required)
├─┤ × ☐ empty.xlsx       —       —                —                                            —                   ⚠️ 0 rows · Likely wrong date range
└─┘

3 of 6 files selected, ~3,575 rows total                              [Apply account to selected ▾] (shift-click rows to select)

[← Back]                                                                                               [Import 3 files →]
```

**Per-row controls:**
- **× (remove)** — fully drops the file from the table
- **☑ checkbox** — include/exclude from import (the only "include" semantic on this row)
- **Account dropdown** — required for P&L/Orders; disabled with `—` and `<InfoTooltip content="Settlement reports apply across all accounts — no assignment needed.">` for Returns/Settlement
- **Status column** — pairs every emoji with text (`✅ Ready`, `🔄 Parsing…`, `❌ Error`, `⚠️ 0 rows`) for screen readers and color-blind users
- **Sample row column** — shows the first 3 distinct SKUs detected, with `(+N more)` count for files with more variety

**Multi-select for bulk-assign:**
- **Shift-click** a row to select a range
- **Ctrl/Cmd-click** to add individual rows to the selection
- Selected rows get a highlighted background ring (separate visual from the include checkbox)
- "Apply account to selected ▾" appears when ≥ 2 rows are in the selection
- This is **not** the same as the include checkbox — selection is for bulk-assign only

**Auto-handling:**
- Wrong file type → red row, auto-unchecked, can't be checked
- Parse error → red row, auto-unchecked, tooltip shows error
- 0-row file → yellow row, auto-unchecked (must be explicitly re-checked to import)
- Duplicate-file drop (same `name + size + lastModified`) → toast "(already added)", no duplicate row

**Aggregate parse indicator** above the table while parses are in flight:
```
Parsing 4 of 9 files…
```

**Import button** disabled when:
- Any *checked* P&L/Orders row is missing an account, OR
- Zero rows checked

### Step 4 — Pre-import confirmation modal

Triggered by "Import N files". On click, button shows spinner and "Checking for existing data…" while overlap-check runs. If overlap-check fails (network/500), show toast + retry button + escape hatch "Skip overlap check and import anyway."

```
┌────────────────────────────────────────────────────────┐
│ Confirm Import                                         │
├────────────────────────────────────────────────────────┤
│ About to import 9 P&L files (~9,011 rows · ~30 sec)    │
│                                                        │
│ NuvioCentral — 4 files                                 │
│   Mar 2025 — 1,234 rows                                │
│   Apr 2025 — 1,089 rows                                │
│   May 2025 — 1,256 rows                                │
│   ⚠️  Already has 567 rows for Jun 2025                │
│       → will dedupe by Order Item ID                   │
│                                                        │
│ BodhNest — 5 files                                     │
│   Mar–Jul 2025 — 5,432 rows                            │
│                                                        │
│ Total: 9 files · ~9,011 rows · 2 accounts              │
│ Behavior: dedupe by Order Item ID — duplicates skipped │
│                                                        │
│ ☐ I've verified each file is assigned to the correct   │
│    account (sample SKUs in the file table can help)    │
│                                                        │
│              [Cancel]    [Confirm import]              │
└────────────────────────────────────────────────────────┘
```

**Verification checkbox** is the forcing function against wrong-account assignments. "Confirm import" is disabled until ticked. Tradeoff: small extra friction; in exchange, the user pauses to actually look — the very thing the spec was designed to prevent.

**Estimated time** ("~30 sec") is a rolling average based on file size; gives the user permission to leave the tab.

### Step 5 — Live progress

Sequential import. Top-level progress bar with running ETA:

```
Importing 9 files…  [██████░░░░░░░░░░░░░░] 3 of 9 (33%) · ~22s remaining

✅ aBc123XYZ.xlsx — 1,234 imported · 0 skipped · 0 failed (1.2s)
✅ qRs456pDq.xlsx — 1,089 imported · 0 skipped · 0 failed (1.1s)
🔄 ZzZ789aBc.xlsx — importing…
⏸ ...6 more pending
```

Per-file results break down: **imported / skipped (duplicates) / failed (per-row errors)** — three numbers, not two. A file that imports 800 of 1,200 rows due to mid-row failures shows clearly.

**Browser-close warning:** while Step 5 is active, attach a `beforeunload` listener that shows:
> "Imports in progress. Leaving will stop the remaining files. Already-imported files are kept."

User can still leave; this is a soft warning.

A file failure does NOT abort the batch. Continues with the next file; failure surfaces in the final results.

### Step 6 — Final results

```
Import Complete

✅ 8 files imported successfully
⚠️ 1 file with errors:
   • broken.xlsx: Account permission denied

By account:
  NuvioCentral · 4 files · 4,567 rows added · 234 skipped (duplicates)
  BodhNest    · 4 files · 4,000 rows added · 210 skipped

Total: 8,567 rows added · 444 skipped · 0 row-level failures

[Close]
```

Per-account aggregation reinforces what was actually loaded. `onImportComplete` fires so `/pnl` page refreshes its data.

### Closing the dialog mid-flow

| Closing at step | Behavior |
|---|---|
| Step 1, Step 2 (no files) | Closes immediately |
| Step 3 (files dropped) | Confirm prompt: "Discard 9 parsed files? Account assignments will be lost." |
| Step 4 (confirmation modal) | Modal closes; underlying file table preserved |
| Step 5 (mid-import) | Confirm prompt: "Cancel remaining imports? Already-imported files are kept." (X imported · Y pending) |
| Step 6 (results) | Closes immediately |

### Concurrency with the single-file dialog

Both flows ultimately POST to the same import endpoints, which dedupe by `order_item_id` server-side. If a team member runs the single-file dialog on the same account while a bulk import is running, the only consequence is potentially-redundant rows that get deduped. This is acceptable — the spec calls it out so the engineer doesn't add unnecessary locking logic.

The overlap-check at Step 4 uses the database state at the moment of the API call, so any rows imported by a parallel session right after the check will only show up as deduped in Step 6.

### Deep-link from other surfaces (`/pnl?intent=bulk-import`)

The `/pnl` page reads a `?intent=bulk-import` query param on mount. If present, the page auto-opens the Bulk Import dialog at Step 1. After the dialog closes (or the user navigates), the param is removed via `router.replace('/pnl')` to keep the URL clean.

This is the integration contract for surfaces (notably the Daily P&L Estimator v2's Benchmark Status card) that need to "send the user to bulk-import P&L." Without this contract, those surfaces have no graceful fallback when the in-place modal mounting isn't available.

## Accessibility

- **Step transitions:** focus moves to the new step's heading on transition; uses `aria-live="polite"` so screen readers announce the change
- **File table:**
  - Tab order: × → checkbox → account dropdown, row by row
  - Account dropdown supports type-ahead
  - Status icons paired with text (Ready, Error, Importing, Pending) — no icon-only state
  - Multi-select via shift-click is mouse-only; v1 doesn't add keyboard multi-select (use the checkbox-based "Apply to all ticked" instead — keyboard users tick rows then bulk-assign)
- **Confirmation modal:** verification checkbox uses standard `<Checkbox aria-label="...">`, confirm button labelled "Confirm import"
- **Progress UI:** progress bar has `role="progressbar"` with `aria-valuenow / aria-valuemax`; per-file lines use `aria-live="polite"` for announcements as files complete

## Error handling

| Scenario | Behavior |
|---|---|
| Tenant has 0 marketplace accounts | Empty state replaces wizard; deep-link to Settings |
| File doesn't parse | Red row, auto-unchecked, tooltip shows parse error |
| Wrong file type dropped (PDF, .xls, image) | Red row with "Unsupported file type (.xlsx required)" |
| File > 50 MB | Hard reject, red row with "File exceeds 50 MB limit" |
| > 50 files dropped | Hard reject the overflow, toast: "Maximum 50 files per session" |
| 0-row file after parse | Yellow row, auto-unchecked; user must explicitly re-check to import |
| Empty file (file is 0 bytes) | Red row, auto-unchecked, "Empty file" |
| Duplicate file drop | Toast "(already added)", no duplicate row |
| User skips assigning account on a checked P&L/Orders file | Import button disabled until resolved |
| Overlap-check API fails | Toast + Retry button + "Skip overlap check and import anyway" escape hatch |
| Overlap detected | Soft warning in confirmation modal; user can still proceed |
| Single file fails server-side mid-import | Per-file result captures error; remaining files still import |
| User closes dialog mid-flow | Confirm prompt depending on step (see "Closing the dialog mid-flow") |
| User refreshes browser mid-import | `beforeunload` warning fires; if user proceeds, already-imported files persist; in-flight file's outcome depends on whether server received the request |
| Concurrent single-file import on same account | Both proceed; dedup at server side |
| Network failure on individual import POST | That file's result shows error; user can retry whole bulk session via `PnlImportDialog` (single-file) or re-run the bulk session for failed files |

## Testing strategy

### Unit
- Existing parsers/importers already covered
- New: bulk overlap-check helper functions, state machine transitions, normalization of file metadata for dup-drop detection
- New: empty-state branch when 0 accounts

### Integration
- Mock the four import APIs and the overlap-check API. Drop 3 files of each report type, assert sequential calls in correct order
- Mock 2-of-3 file overlap; assert confirmation modal renders correct warnings
- Assert "Apply to selected" updates only ticked rows
- Assert duplicate-file drop is deduped (no duplicate table row)
- Assert verification checkbox gates the Confirm button
- Assert browser-close warning attaches/detaches correctly across steps

### Manual smoke test (mandatory before deploy)
1. With 0 marketplace accounts → open Bulk Import → verify empty state appears
2. Add a Flipkart account → re-open → verify wizard starts at Step 1
3. Pick "P&L Report"
4. Drop 3+ P&L files (mix overlapping + non-overlapping date ranges, mix accounts, include 1 broken file + 1 PDF + 1 empty file)
5. Verify aggregate "Parsing N of M" indicator
6. Verify each row's auto-detected fields (date range, sample SKUs)
7. Verify rejected files render as red rows with rejection reasons
8. Verify 0-row file is yellow + auto-unchecked
9. Verify duplicate-drop is deduped
10. Use shift-click to select multiple rows, "Apply account to selected" → verify behavior
11. Click Import → verify "Checking for existing data…" loading state
12. Verify confirmation modal: per-account summary, overlap warnings, verification checkbox gates confirm
13. Confirm → verify sequential progress with ETA + per-file 3-number breakdown
14. Try closing browser tab mid-import → verify `beforeunload` warning
15. Verify final results show per-file + per-account aggregates
16. Repeat for Orders / Returns / Settlement
17. Re-import the same files → verify dedupe (should report ~0 new rows)
18. With Settlement type, verify Account column shows `—` with the helpful tooltip

## Implementation budget

Single dev with sub-agent execution:
- Step components (6 + EmptyAccountsState) — ~1.5 days
- Overlap-check endpoint — ~0.5 day
- State machine + multi-select + sample preview wiring — ~1 day
- Enrichment-path account-mismatch safety in `pnl-import-server.ts` + tests — ~0.5 day
- `?intent=bulk-import` URL handler on `/pnl` page — ~0.25 day
- Progress UI + ETA — ~0.25 day
- Accessibility + error states + empty states — ~0.5 day
- Manual + integration testing on real Flipkart reports — ~0.5 day

**Estimated total: ~5 dev-days.** (Was 4.5; +0.5 for enrichment-path safety, which was a missed integrity issue from v1 review.)

## Resolved design points (from review)

1. **Empty state for 0 accounts** — wizard blocked, deep-link to Settings.
2. **First-time orientation** — Step 1 has dismissible "Where to download →" callout.
3. **Loading states** — explicit per-file parse status, aggregate parse indicator, overlap-check spinner, sequential-import progress bar with ETA.
4. **Wrong file type / size limits** — explicit rejection with reasons; 50 files / 50 MB caps.
5. **Empty files** — auto-uncheck with yellow warning.
6. **Duplicate file drops** — auto-deduped with toast.
7. **Account misassignment safety** — verification checkbox in confirmation modal.
8. **Browser close mid-import** — `beforeunload` warning.
9. **Per-file results** — three numbers (imported / skipped-duplicate / failed-row).
10. **Per-account aggregate in final results** — added.
11. **Status icons paired with text labels** — for accessibility.
12. **Sample row enhancement** — 3 distinct SKUs with `(+N more)` count.
13. **Remove file affordance** — × icon per row.
14. **Multi-select vs include checkbox** — separated via shift-click semantics.
15. **CSV/XLSX support** — XLSX-only for v1; CSV not advertised.
16. **Mobile** — desktop-only; responsive layout deferred (backfill is at-desk).
17. **Accessibility** — explicit section: focus management, keyboard nav, screen-reader labels.

## Open design points (please confirm during review)

1. **Verification checkbox in Step 4** — small extra friction. Idiot-proof but every user has to tick it every time. Want it permanently, or removable via an "I trust myself" toggle in user settings (v2)?

2. **Web Worker for large-file parsing** — adds ~0.5 day of complexity for the rare case of files > 10 MB. Acceptable tradeoff?

3. **Rejected-files in the file table vs separate "Skipped" panel** — currently red rows in the same table. Alternative: a collapsible "5 files skipped (click to see why)" panel below the table. Cleaner table; one extra click to diagnose.

## Corrections from implementation-readiness review

The following issues were found in a second adversarial review pass and corrected in this spec:

1. **Wrong column name** — overlap-check for Returns referenced `orders.return_date`, which doesn't exist. The actual column is `return_request_date`. Fixed with rationale.

2. **Returns/Settlement overlap scope** — these report types don't carry `marketplace_account_id`, so per-account overlap counts are impossible. Spec now explicitly returns tenant-wide counts for these types and the confirmation modal labels them honestly.

3. **Enrichment-path account-mismatch silent corruption** — the existing `pnl-import-server.ts` enrichment branch updates an existing order's financials without validating that the assigned `marketplace_account_id` matches the existing one. Bulk-import users could (with a wrong account assignment) silently update the wrong account's data. Spec now requires server-side mismatch detection that skips the row and reports it as `mismatched_account` in the result. Added 0.5 day to the budget.

4. **Web Worker for xlsx parsing was underestimated** — the precedent in CLAUDE.md (pdf.js worker bundling) shows this is a 1.5-day chore, not a 0.5-day one. Deferred to v2; v1 parses on the main thread.

5. **Case-insensitive file extension matching** — `accept` prop must include both `.xlsx` and `.XLSX` for Windows downloads.

6. **`?intent=bulk-import` deep-link contract** — added to spec so the Daily P&L Estimator v2's "Upload P&L now" fallback link works correctly.

## Future enhancements (v2 candidates)

- Save filename → account assignments per tenant, so re-imports are pre-populated
- Show overlap status in the file table (Step 3) instead of waiting until Step 4 — more API calls, faster decision-making
- Persistent draft session via localStorage (file metadata + account assignments, not file content) — recover from accidental refresh
- Show account context in dropdown: `NuvioCentral · E4A · GGN` — avoids the "which org is this?" friction
- Telemetry on session metrics (parse failures, overlap rates, total time) — informs auto-detect-type prioritization
