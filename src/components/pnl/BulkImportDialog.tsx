'use client'

import { useEffect, useReducer, useCallback, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { parsePnlXlsx } from '@/lib/importers/pnl-xlsx-parser'
import { parseOrdersReport } from '@/lib/importers/orders-report-parser'
import { parseReturnsReport } from '@/lib/importers/returns-report-parser'
import { parseSettlementXlsx } from '@/lib/importers/settlement-report-parser'

import { reducer, initialState } from './bulk-import/bulk-import-state'
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
  enabledReportTypes?: ReportType[]
}

const ALL_TYPES: ReportType[] = ['orders', 'returns', 'pnl', 'settlement']

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function importApiFor(rt: ReportType): string {
  if (rt === 'pnl') return '/api/pnl/import'
  if (rt === 'orders') return '/api/pnl/import-orders'
  if (rt === 'returns') return '/api/pnl/import-returns'
  return '/api/pnl/import-settlement'
}

async function parseFile(rt: ReportType, file: File): Promise<{
  rows: AnyParsedRow[]
  rowCount: number
  dateRange: { from: string; to: string } | null
  sampleSkus: string[]
}> {
  const buffer = await file.arrayBuffer()

  let rows: AnyParsedRow[]
  if (rt === 'pnl') rows = await parsePnlXlsx(buffer)
  else if (rt === 'orders') rows = await parseOrdersReport(buffer)
  else if (rt === 'returns') rows = await parseReturnsReport(buffer)
  else rows = await parseSettlementXlsx(buffer)

  const validRows = rows.filter(r => !r.error)
  if (validRows.length === 0) {
    return { rows: validRows, rowCount: 0, dateRange: null, sampleSkus: [] }
  }

  // Extract dates using the correct field per report type
  let dates: string[] = []
  if (rt === 'pnl' || rt === 'orders') {
    dates = validRows
      .map(r => (r as { orderDate?: string }).orderDate ?? '')
      .filter(Boolean)
      .map(d => String(d).slice(0, 10))
  } else if (rt === 'returns') {
    dates = validRows
      .map(r => (r as { returnRequestDate?: string | null }).returnRequestDate ?? '')
      .filter(Boolean)
      .map(d => String(d).slice(0, 10))
  } else {
    dates = validRows
      .map(r => (r as { paymentDate?: string }).paymentDate ?? '')
      .filter(Boolean)
      .map(d => String(d).slice(0, 10))
  }

  const dateRange = dates.length > 0
    ? { from: dates.reduce((a, b) => a < b ? a : b), to: dates.reduce((a, b) => a > b ? a : b) }
    : null

  // Extract up to 3 distinct SKUs
  const skuSet = new Set<string>()
  for (const r of validRows) {
    const s = rt === 'settlement'
      ? ((r as { sellerSku?: string }).sellerSku ?? '')
      : ((r as { skuName?: string }).skuName ?? '')
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

  useEffect(() => {
    if (!open) return
    fetch('/api/marketplace-accounts')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load accounts')))
      .then((data: MarketplaceAccountLite[]) => setAccounts(data ?? []))
      .catch((e: unknown) => {
        toast.error((e as Error).message)
        setAccounts([])
      })
  }, [open])

  useEffect(() => {
    if (!open) dispatch({ type: 'reset' })
  }, [open])

  const flipkartAccounts = useMemo(
    () => (accounts ?? []).filter(a => a.platform === 'flipkart'),
    [accounts],
  )

  const handleFilesDropped = useCallback((accepted: File[], rejected: { file: File; reason: string }[]) => {
    if (!state.reportType) return
    const rt = state.reportType
    if (state.step === 'dropFiles') dispatch({ type: 'setStep', step: 'fileTable' })

    for (const { file, reason } of rejected) {
      const entry: FileEntry = {
        fileKey: uuid(), fileName: file.name, fileSize: file.size, fileLastModified: file.lastModified,
        rows: null, status: { kind: 'unsupported', reason }, marketplaceAccountId: null,
        includeInImport: false, multiSelectChecked: false,
      }
      dispatch({ type: 'addSkipped', file: entry })
    }

    const existingKeys = new Set(
      [...state.files, ...state.skippedFiles].map(f => `${f.fileName}::${f.fileSize}::${f.fileLastModified}`)
    )
    const dedupedAccepted = accepted.filter(f => !existingKeys.has(`${f.name}::${f.size}::${f.lastModified}`))
    const skippedAsDup = accepted.length - dedupedAccepted.length
    if (skippedAsDup > 0) toast.info(`${skippedAsDup} file${skippedAsDup === 1 ? '' : 's'} already added — ignored`)

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
        const body = await res.json().catch(() => ({})) as { error?: string }
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
        const json = await res.json().catch(() => ({})) as Record<string, unknown>
        if (!res.ok) {
          dispatch({ type: 'fileImportFailed', fileKey: file.fileKey, reason: (json.error as string) ?? `HTTP ${res.status}` })
          totalFailed += 1
          continue
        }
        const imported = (json.imported as number) ?? 0
        const skipped = (json.skipped as number) ?? 0
        const mismatchedAccount = (json.mismatchedAccount as number) ?? 0
        const failedRows = Array.isArray(json.errors) ? json.errors.length : 0
        dispatch({
          type: 'fileImportSuccess',
          fileKey: file.fileKey,
          imported, skipped, mismatchedAccount, failed: failedRows,
        })
        totalImported += imported
        totalSkippedDup += skipped
        totalMismatched += mismatchedAccount
        const acctName = file.marketplaceAccountId
          ? (flipkartAccounts.find(a => a.id === file.marketplaceAccountId)?.account_name ?? 'Unknown')
          : 'Tenant-wide'
        if (!perAccount[acctName]) perAccount[acctName] = { files: 0, rows: 0 }
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

  const importableFiles = state.files.filter(f => f.includeInImport && f.status.kind === 'ready')
  const failedForResults = state.files
    .filter(f => f.status.kind === 'failed')
    .map(f => ({ fileName: f.fileName, reason: f.status.kind === 'failed' ? f.status.reason : 'Unknown' }))

  const stepTitle = {
    reportType: 'Bulk Import — Pick report type',
    dropFiles: 'Bulk Import — Drop files',
    fileTable: 'Bulk Import — Review files',
    confirm: 'Bulk Import — Confirm',
    progress: 'Bulk Import — Importing',
    results: 'Bulk Import — Complete',
  }[state.step]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{stepTitle}</DialogTitle>
        </DialogHeader>

        {state.step === 'reportType' && (
          <StepReportType
            selected={state.reportType}
            onSelect={(rt) => {
              if (enabledReportTypes.includes(rt)) dispatch({ type: 'setReportType', reportType: rt })
            }}
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
              void checkOverlapAndConfirm()
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
            onConfirm={() => void handleStartImport()}
            onCancel={() => dispatch({ type: 'setStep', step: 'fileTable' })}
            onRetryOverlap={() => void checkOverlapAndConfirm()}
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
