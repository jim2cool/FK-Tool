'use client'

import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Download,
  Upload,
  CheckCircle,
  XCircle,
  AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  parseComboCsv,
  groupComboRows,
  type ParsedComboRow,
  type ParsedComboGroup,
  type ComboImportResult,
} from '@/lib/importers/combo-csv-parser'

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'idle' | 'preview' | 'importing' | 'results'

interface ComboImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ComboImportDialog({
  open,
  onOpenChange,
  onImported,
}: ComboImportDialogProps) {
  const [step, setStep] = useState<Step>('idle')
  const [parsedRows, setParsedRows] = useState<ParsedComboRow[]>([])
  const [groups, setGroups] = useState<ParsedComboGroup[]>([])
  const [csvText, setCsvText] = useState<string>('')
  const [results, setResults] = useState<ComboImportResult | null>(null)
  const [downloading, setDownloading] = useState(false)

  // ─── Derived counts ────────────────────────────────────────────────────────

  const validRows = parsedRows.filter((r) => !r.error)
  const invalidRows = parsedRows.filter((r) => r.error)
  const totalErrors = groups.reduce((sum, g) => sum + g.errors.length, 0)

  // ─── Reset all state ───────────────────────────────────────────────────────

  function resetState() {
    setStep('idle')
    setParsedRows([])
    setGroups([])
    setCsvText('')
    setResults(null)
  }

  function handleClose() {
    if (step === 'importing') return
    resetState()
    onOpenChange(false)
  }

  // ─── File handling ─────────────────────────────────────────────────────────

  function processFile(file: File) {
    if (!file.name.endsWith('.csv')) {
      toast.error('Please select a CSV file')
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const rows = parseComboCsv(text)
      const grouped = groupComboRows(rows)
      setCsvText(text)
      setParsedRows(rows)
      setGroups(grouped)
      setStep('preview')
    }
    reader.readAsText(file)
  }

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (file) processFile(file)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.csv'] },
    multiple: false,
    disabled: step !== 'idle',
  })

  // ─── Template download ─────────────────────────────────────────────────────

  async function downloadTemplate() {
    setDownloading(true)
    try {
      const res = await fetch('/api/catalog/combos/csv-template')
      if (!res.ok) {
        toast.error('Failed to generate template')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'combo-import-template.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download template')
    } finally {
      setDownloading(false)
    }
  }

  // ─── Import ────────────────────────────────────────────────────────────────

  async function handleImport() {
    if (validRows.length === 0 || !csvText) return
    setStep('importing')
    try {
      const res = await fetch('/api/catalog/combos/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText }),
      })
      const data: ComboImportResult = await res.json()
      if (!res.ok) {
        toast.error((data as unknown as { error?: string }).error ?? 'Import failed')
        setStep('preview')
        return
      }
      setResults(data)
      setStep('results')
      if (data.combosCreated > 0 || data.componentsAdded > 0 || data.mappingsCreated > 0 || data.mappingsUpdated > 0) {
        onImported()
      }
    } catch {
      toast.error('Network error during import')
      setStep('preview')
    }
  }

  // ─── Preview table ─────────────────────────────────────────────────────────

  function renderPreviewTable(frozen = false) {
    return (
      <div className={`overflow-auto rounded border max-h-80 ${frozen ? 'pointer-events-none opacity-75' : ''}`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">#</TableHead>
              <TableHead>Combo Name</TableHead>
              <TableHead>Component SKU</TableHead>
              <TableHead className="w-14">Qty</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Platform SKU</TableHead>
              <TableHead className="w-28">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parsedRows.map((row) => {
              const isInvalid = !!row.error
              // Check group-level errors for this row (e.g. duplicate component)
              const groupError = groups.flatMap(g => g.errors).find(e => e.rowIndex === row.rowIndex)
              const hasError = isInvalid || !!groupError
              const errorMsg = row.error || groupError?.reason

              return (
                <TableRow
                  key={row.rowIndex}
                  className={hasError ? 'bg-destructive/10' : undefined}
                >
                  <TableCell className="text-center tabular-nums text-muted-foreground text-xs">
                    {row.rowIndex}
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-[140px] truncate">
                    {row.comboName || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-[140px] truncate">
                    {row.componentSku || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {row.quantity > 0 ? row.quantity : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.channel || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs max-w-[120px] truncate">
                    {row.account || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-[120px] truncate">
                    {row.platformSku || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {hasError ? (
                      <span className="flex items-start gap-1 text-destructive leading-tight">
                        <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span className="break-words">{errorMsg}</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-green-700">
                        <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>Valid</span>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  // ─── Step renderers ────────────────────────────────────────────────────────

  function renderIdle() {
    return (
      <div className="space-y-4">
        {/* Template download */}
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
          <div>
            <p className="text-sm font-medium">First time importing?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Download our template — it lists your existing products and accounts.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadTemplate}
            disabled={downloading}
          >
            <Download className="h-4 w-4 mr-2" />
            {downloading ? 'Generating...' : 'Download Template'}
          </Button>
        </div>

        {/* Instructions */}
        <div className="rounded-lg border bg-muted/20 px-4 py-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground text-sm">How it works</p>
          <p>Each row adds a <strong>component</strong> to a combo. Rows with the same <strong>Combo Name</strong> are grouped together.</p>
          <p><strong>Channel / Account / Platform SKU</strong> are optional per row — fill them to map a platform listing to the combo.</p>
          <p>If a combo already exists, new mappings are added (existing components are kept).</p>
        </div>

        {/* Drop zone */}
        <div
          {...getRootProps()}
          className={[
            'flex flex-col items-center justify-center gap-4 py-12',
            'border-2 border-dashed rounded-lg cursor-pointer transition-colors',
            isDragActive
              ? 'border-primary bg-primary/5'
              : 'border-muted hover:border-primary/50 hover:bg-muted/30',
          ].join(' ')}
        >
          <input {...getInputProps()} />
          <Upload className="h-10 w-10 text-muted-foreground" />
          <div className="text-center">
            <p className="text-sm font-medium">
              {isDragActive ? 'Drop the CSV here' : 'Drag & drop a CSV file'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
          </div>
        </div>
      </div>
    )
  }

  function renderPreview() {
    return (
      <div className="space-y-3">
        {/* Summary badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary">{groups.length} combo{groups.length !== 1 ? 's' : ''}</Badge>
          <Badge variant="secondary">
            {groups.reduce((s, g) => s + g.components.length, 0)} components
          </Badge>
          <Badge variant="secondary">
            {groups.reduce((s, g) => s + g.mappings.length, 0)} mappings
          </Badge>
          {totalErrors > 0 && (
            <Badge
              variant="secondary"
              className="bg-destructive/10 text-destructive border-destructive/20"
            >
              {totalErrors} error{totalErrors !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>

        {renderPreviewTable(false)}
      </div>
    )
  }

  function renderImporting() {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary">{groups.length} combo{groups.length !== 1 ? 's' : ''}</Badge>
          <Badge variant="secondary">{validRows.length} valid rows</Badge>
        </div>
        {renderPreviewTable(true)}
      </div>
    )
  }

  function renderResults() {
    if (!results) return null
    return (
      <div className="space-y-4">
        {/* Summary stats */}
        <div className="flex flex-col gap-2">
          {results.combosCreated > 0 && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span><strong>{results.combosCreated}</strong> combo{results.combosCreated !== 1 ? 's' : ''} created</span>
            </div>
          )}
          {results.combosSkipped > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span><strong>{results.combosSkipped}</strong> combo{results.combosSkipped !== 1 ? 's' : ''} already existed</span>
            </div>
          )}
          {results.componentsAdded > 0 && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span><strong>{results.componentsAdded}</strong> component{results.componentsAdded !== 1 ? 's' : ''} added</span>
            </div>
          )}
          {results.mappingsCreated > 0 && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span><strong>{results.mappingsCreated}</strong> mapping{results.mappingsCreated !== 1 ? 's' : ''} created</span>
            </div>
          )}
          {results.mappingsUpdated > 0 && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle className="h-4 w-4 shrink-0" />
              <span><strong>{results.mappingsUpdated}</strong> mapping{results.mappingsUpdated !== 1 ? 's' : ''} reassigned</span>
            </div>
          )}
        </div>

        {/* Error list */}
        {results.errors.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {results.errors.length} error{results.errors.length !== 1 ? 's' : ''}
            </div>
            <div className="max-h-48 overflow-y-auto rounded border divide-y text-xs">
              {results.errors.map((err, i) => (
                <div key={i} className="px-3 py-2 text-destructive">
                  <span className="font-medium">Row {err.row}:</span> {err.reason}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── Dialog title ──────────────────────────────────────────────────────────

  const titles: Record<Step, string> = {
    idle: 'Import Combos from CSV',
    preview: 'Import Combos from CSV',
    importing: 'Import Combos from CSV',
    results: 'Import Complete',
  }

  // ─── Footer ────────────────────────────────────────────────────────────────

  function renderFooter() {
    switch (step) {
      case 'idle':
        return (
          <div className="flex justify-end">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          </div>
        )
      case 'preview':
        return (
          <div className="flex justify-between">
            <Button variant="outline" onClick={resetState}>
              Back
            </Button>
            <Button
              onClick={handleImport}
              disabled={validRows.length === 0}
            >
              Import {groups.length} combo{groups.length !== 1 ? 's' : ''} →
            </Button>
          </div>
        )
      case 'importing':
        return (
          <div className="flex justify-end">
            <Button disabled>Importing...</Button>
          </div>
        )
      case 'results':
        return (
          <div className="flex justify-between">
            <Button variant="outline" onClick={resetState}>
              Import Another
            </Button>
            <Button onClick={handleClose}>Done</Button>
          </div>
        )
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{titles[step]}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2">
          {step === 'idle' && renderIdle()}
          {step === 'preview' && renderPreview()}
          {step === 'importing' && renderImporting()}
          {step === 'results' && renderResults()}
        </div>

        <div className="border-t pt-4">{renderFooter()}</div>
      </DialogContent>
    </Dialog>
  )
}
