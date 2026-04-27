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
