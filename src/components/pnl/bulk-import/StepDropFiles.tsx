'use client'
import { useCallback } from 'react'
import type { FileRejection } from 'react-dropzone'
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
    (accepted: File[], rejections: FileRejection[]) => {
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
