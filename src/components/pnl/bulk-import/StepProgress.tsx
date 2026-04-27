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

  let eta: string | null = null
  if (importStartedAt && completed > 0 && completed < total) {
    const elapsed = Date.now() - importStartedAt
    const avgPerFile = elapsed / completed
    eta = fmtSecs(avgPerFile * (total - completed))
  }

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
