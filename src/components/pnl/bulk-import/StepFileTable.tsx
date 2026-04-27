'use client'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { Loader2, CheckCircle2, AlertCircle, X, ChevronRight, ChevronDown } from 'lucide-react'
import type { FileEntry, ReportType } from './types'

function needsAccount(rt: ReportType): boolean {
  return rt === 'pnl' || rt === 'orders'
}

interface Props {
  reportType: ReportType
  files: FileEntry[]
  skippedFiles: FileEntry[]
  showSkippedPanel: boolean
  selectedAccountName: string | null
  onSetIncludeInImport: (fileKey: string, include: boolean) => void
  onRemoveFile: (fileKey: string) => void
  onReinclude: (fileKey: string) => void
  onToggleSkippedPanel: () => void
  onBack: () => void
  onNext: () => void
}

export function StepFileTable(props: Props) {
  const {
    reportType, files, skippedFiles, showSkippedPanel, selectedAccountName,
    onSetIncludeInImport, onRemoveFile, onReinclude, onToggleSkippedPanel, onBack, onNext,
  } = props

  const requiresAccount = needsAccount(reportType)
  const checkedFiles = files.filter(f => f.includeInImport && f.status.kind === 'ready')
  const totalRows = checkedFiles.reduce((s, f) => s + (f.status.kind === 'ready' ? f.status.rowCount : 0), 0)

  const importDisabled = useMemo(() => {
    if (checkedFiles.length === 0) return true
    if (requiresAccount && checkedFiles.some(f => !f.marketplaceAccountId)) return true
    return false
  }, [checkedFiles, requiresAccount])

  const parsingCount = files.filter(f => f.status.kind === 'parsing').length

  return (
    <div className="space-y-4">
      {requiresAccount && selectedAccountName && (
        <p className="text-sm">
          Account: <strong>{selectedAccountName}</strong>
          <span className="text-muted-foreground text-xs ml-2">— all files assigned to this account. Go back to change.</span>
        </p>
      )}

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
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {files.length === 0 && (
              <tr><td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">No files yet</td></tr>
            )}
            {files.map(f => {
              const isReady = f.status.kind === 'ready'
              const readyStatus = isReady && f.status.kind === 'ready' ? f.status : null
              const range = readyStatus ? `${readyStatus.dateRange.from} → ${readyStatus.dateRange.to}` : '—'
              const skuPreview = readyStatus
                ? readyStatus.sampleSkus.slice(0, 3).join(', ') + (readyStatus.sampleSkus.length > 3 ? ` (+${readyStatus.sampleSkus.length - 3} more)` : '')
                : '—'
              return (
                <tr key={f.fileKey}>
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
                  <td className="px-2 py-2 text-xs">
                    {f.status.kind === 'parsing' && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Parsing…</span>}
                    {f.status.kind === 'ready' && <span className="flex items-center gap-1 text-green-700"><CheckCircle2 className="h-3 w-3" /> Ready · {f.status.rowCount} rows</span>}
                    {(f.status.kind === 'parse-error' || f.status.kind === 'unsupported' || f.status.kind === 'too-large' || f.status.kind === 'empty') && (
                      <span className="flex items-center gap-1 text-destructive"><AlertCircle className="h-3 w-3" /> Error</span>
                    )}
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

      <div className="flex items-center text-xs text-muted-foreground">
        <span>
          {checkedFiles.length} of {files.filter(f => f.status.kind === 'ready').length} valid files selected · ~{totalRows} rows total
        </span>
      </div>

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
                    <span className="text-muted-foreground truncate">
                      — {('reason' in f.status) ? (f.status as { reason: string }).reason : 'Unknown'}
                    </span>
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
