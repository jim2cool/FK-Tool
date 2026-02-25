'use client'
import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, FileText, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  onFile: (file: File) => void
  uploading: boolean
}

export function UploadZone({ onFile, uploading }: Props) {
  const [draggedFile, setDraggedFile] = useState<File | null>(null)

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) {
      setDraggedFile(accepted[0])
      onFile(accepted[0])
    }
  }, [onFile])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'] },
    maxFiles: 1,
    disabled: uploading,
  })

  return (
    <div
      {...getRootProps()}
      className={cn(
        'border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors',
        isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30',
        uploading && 'opacity-50 cursor-not-allowed'
      )}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-3">
        <div className="p-3 rounded-full bg-muted">
          {uploading ? (
            <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : draggedFile ? (
            <FileText className="h-6 w-6 text-primary" />
          ) : (
            <Upload className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        {uploading ? (
          <p className="text-sm text-muted-foreground">Uploading and analysing…</p>
        ) : draggedFile ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{draggedFile.name}</p>
            <p className="text-xs text-muted-foreground">{(draggedFile.size / 1024).toFixed(1)} KB</p>
            <p className="text-xs text-muted-foreground">Drop another file or click to replace</p>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium">{isDragActive ? 'Drop it here' : 'Drop a file here'}</p>
            <p className="text-xs text-muted-foreground">CSV, XLSX or XLS · Flipkart or Amazon reports</p>
          </>
        )}
      </div>
    </div>
  )
}
