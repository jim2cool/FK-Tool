'use client'
import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { CheckCircle2, Upload, Loader2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ReportType, Platform } from '@/lib/daily-pnl/types'
import { parseOrdersFile, parseListingFile, parseCogsFile, parsePnlHistoryFile } from '@/lib/daily-pnl/parsers'

type UploadState = {
  status: 'idle' | 'parsing' | 'uploading' | 'done' | 'error'
  lastUploaded?: Date
  rowCount?: number
  error?: string
}

type ReportConfig = { type: ReportType; label: string; description: string }

const REPORTS: ReportConfig[] = [
  { type: 'orders',      label: 'A. Orders',      description: 'Flipkart order export (order_item_id, sku, dispatched_date, status)' },
  { type: 'listing',     label: 'B. Listing',     description: 'Seller listing export (MRP, Bank Settlement, Selling Price)' },
  { type: 'cogs',        label: 'C. COGS',        description: 'SKU → Master Product mapping + COGS/unit' },
  { type: 'pnl_history', label: 'D. P&L History', description: 'Flipkart P&L report — 60–90 days of settled order data' },
]

function parseFile(type: ReportType, file: File) {
  if (type === 'orders')      return parseOrdersFile(file)
  if (type === 'listing')     return parseListingFile(file)
  if (type === 'cogs')        return parseCogsFile(file)
  if (type === 'pnl_history') return parsePnlHistoryFile(file)
  throw new Error(`Unknown report type: ${type}`)
}

function DropZone({
  config, marketplaceAccountId, state, onChange, onUploaded,
}: {
  config: ReportConfig; marketplaceAccountId: string; state: UploadState
  onChange: (s: UploadState) => void; onUploaded: () => void
}) {
  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    onChange({ status: 'parsing' })
    try {
      const rows = await parseFile(config.type, file)
      // Check for a top-level parse error (returned as a single error row with _row=0)
      const fatal = rows.find(r => '_row' in (r as object) && (r as { _row: number })._row === 0 && 'error' in (r as object))
      if (fatal && 'error' in (fatal as object)) {
        const msg = (fatal as { error: string }).error
        onChange({ status: 'error', error: msg })
        toast.error(`${config.label}: ${msg}`)
        return
      }
      onChange({ status: 'uploading' })
      const res = await fetch('/api/daily-pnl/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketplace_account_id: marketplaceAccountId, report_type: config.type, rows }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const { inserted } = await res.json() as { inserted: number }
      onChange({ status: 'done', lastUploaded: new Date(), rowCount: inserted })
      toast.success(`${config.label}: ${inserted} rows uploaded`)
      onUploaded()
    } catch (e: unknown) {
      const msg = (e as Error).message
      onChange({ status: 'error', error: msg })
      toast.error(`${config.label}: ${msg}`)
    }
  }, [marketplaceAccountId, config, onChange, onUploaded])

  const isLoading = state.status === 'parsing' || state.status === 'uploading'
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, multiple: false, disabled: isLoading,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
  })

  return (
    <div
      {...getRootProps()}
      className={cn(
        'border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors select-none',
        isDragActive                ? 'border-primary bg-primary/5'     : 'border-border hover:border-primary/50',
        state.status === 'done'    && 'border-green-400 bg-green-50/50',
        state.status === 'error'   && 'border-red-400 bg-red-50/50',
        isLoading                  && 'opacity-60 cursor-not-allowed',
      )}
    >
      <input {...getInputProps()} />
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {isLoading                       && <Loader2     className="h-5 w-5 animate-spin text-muted-foreground" />}
          {state.status === 'done'         && <CheckCircle2 className="h-5 w-5 text-green-600" />}
          {state.status === 'error'        && <AlertCircle  className="h-5 w-5 text-red-500" />}
          {state.status === 'idle'         && <Upload       className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{config.label}</p>
          <p className="text-xs text-muted-foreground">{config.description}</p>
          {state.status === 'done'     && <p className="text-xs text-green-600 mt-1">{state.rowCount} rows · {state.lastUploaded?.toLocaleTimeString()}</p>}
          {state.status === 'error'    && <p className="text-xs text-red-500 mt-1 truncate">{state.error}</p>}
          {state.status === 'parsing'  && <p className="text-xs text-muted-foreground mt-1">Parsing file…</p>}
          {state.status === 'uploading'&& <p className="text-xs text-muted-foreground mt-1">Uploading…</p>}
        </div>
      </div>
    </div>
  )
}

export function UploadPanel({
  marketplaceAccountId, platform, onAnyUploaded,
}: {
  marketplaceAccountId: string
  platform: Platform
  onAnyUploaded: () => void
}) {
  const [states, setStates] = useState<Record<ReportType, UploadState>>({
    orders: { status: 'idle' }, listing: { status: 'idle' },
    cogs: { status: 'idle' }, pnl_history: { status: 'idle' },
  })

  if (platform !== 'flipkart') {
    return (
      <div className="border rounded-lg p-6 text-center text-muted-foreground text-sm">
        Upload support for {platform.toUpperCase()} is coming soon. Only Flipkart is supported today.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {REPORTS.map(cfg => (
        <DropZone
          key={cfg.type}
          config={cfg}
          marketplaceAccountId={marketplaceAccountId}
          state={states[cfg.type]}
          onChange={s => setStates(prev => ({ ...prev, [cfg.type]: s }))}
          onUploaded={onAnyUploaded}
        />
      ))}
    </div>
  )
}
