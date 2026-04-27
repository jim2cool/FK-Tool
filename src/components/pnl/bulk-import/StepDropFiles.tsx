'use client'
import { useCallback } from 'react'
import type { FileRejection } from 'react-dropzone'
import { useDropzone } from 'react-dropzone'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MAX_FILES_PER_SESSION, MAX_FILE_SIZE_BYTES } from './bulk-import-state'
import type { MarketplaceAccountLite, ReportType } from './types'

interface Props {
  reportType: ReportType
  accounts: MarketplaceAccountLite[]
  selectedAccountId: string | null
  onSelectAccount: (id: string) => void
  onFilesDropped: (accepted: File[], rejected: { file: File; reason: string }[]) => void
  onBack: () => void
  currentFileCount: number
}

export function StepDropFiles({ reportType, accounts, selectedAccountId, onSelectAccount, onFilesDropped, onBack, currentFileCount }: Props) {
  const remainingSlots = MAX_FILES_PER_SESSION - currentFileCount
  const requiresAccount = reportType === 'pnl' || reportType === 'orders'
  const accountMissing = requiresAccount && !selectedAccountId

  const onDrop = useCallback(
    (accepted: File[], rejections: FileRejection[]) => {
      if (accountMissing) return
      const ourRejected: { file: File; reason: string }[] = rejections.map(r => ({
        file: r.file,
        reason: r.errors[0]?.message ?? 'Rejected by file picker',
      }))
      const acceptedTrimmed = accepted.slice(0, remainingSlots)
      for (const f of accepted.slice(remainingSlots)) {
        ourRejected.push({ file: f, reason: `Maximum ${MAX_FILES_PER_SESSION} files per session` })
      }
      const sizeOk: File[] = []
      for (const f of acceptedTrimmed) {
        if (f.size > MAX_FILE_SIZE_BYTES) {
          ourRejected.push({ file: f, reason: 'File exceeds 50 MB limit' })
        } else if (f.size === 0) {
          ourRejected.push({ file: f, reason: 'Empty file (0 bytes)' })
        } else {
          sizeOk.push(f)
        }
      }
      onFilesDropped(sizeOk, ourRejected)
    },
    [onFilesDropped, remainingSlots, accountMissing],
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
      {requiresAccount && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Account</label>
          <Select value={selectedAccountId ?? ''} onValueChange={onSelectAccount}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select the Flipkart account these files belong to" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">All files dropped in this session will be assigned to this account.</p>
        </div>
      )}

      <div
        {...getRootProps()}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
          accountMissing
            ? 'border-border opacity-50 cursor-not-allowed'
            : 'cursor-pointer',
          !accountMissing && isDragActive ? 'border-primary bg-primary/5' : '',
          !accountMissing && !isDragActive ? 'border-border hover:border-primary/50' : '',
        )}
      >
        <input {...getInputProps({ multiple: true })} disabled={accountMissing} />
        <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        {accountMissing ? (
          <p className="text-sm text-muted-foreground">Select an account above to enable file upload</p>
        ) : (
          <>
            <p className="text-sm font-medium">Drop your files here, or click to browse</p>
            <p className="text-xs text-muted-foreground mt-1">
              .xlsx only · Max {MAX_FILES_PER_SESSION} files · 50 MB per file
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tip: select many files in Explorer (Ctrl-click) before dragging, or hold Ctrl in the file picker to multi-select.
            </p>
          </>
        )}
      </div>
      <div className="flex justify-start">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
      </div>
    </div>
  )
}
