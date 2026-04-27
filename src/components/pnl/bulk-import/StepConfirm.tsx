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
                  const rowCount = f.status.kind === 'ready' ? f.status.rowCount : 0
                  return (
                    <li key={f.fileKey} className="space-y-0.5">
                      <div>{f.fileName} · {range} · {rowCount} rows</div>
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
        <span>I&apos;ve verified the account, date ranges, and file list above are correct</span>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={onConfirm} disabled={!verifiedAccountAssignment || isCheckingOverlap}>Confirm import</Button>
      </div>
    </div>
  )
}
