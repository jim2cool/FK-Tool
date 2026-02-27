'use client'
import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Upload, Download, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { parsePurchasesCsv, type ParsedPurchaseRow, type PurchaseImportResult } from '@/lib/importers/purchases-csv-parser'

type State = 'idle' | 'preview' | 'importing' | 'results'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

export function PurchasesImportDialog({ open, onOpenChange, onImported }: Props) {
  const [state, setState] = useState<State>('idle')
  const [csvText, setCsvText] = useState('')
  const [rows, setRows] = useState<ParsedPurchaseRow[]>([])
  const [result, setResult] = useState<PurchaseImportResult | null>(null)

  const validRows   = rows.filter(r => !r.error)
  const invalidRows = rows.filter(r => r.error)

  const reset = useCallback(() => {
    setState('idle')
    setCsvText('')
    setRows([])
    setResult(null)
  }, [])

  const onDrop = useCallback((files: File[]) => {
    const file = files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const parsed = parsePurchasesCsv(text)
      setCsvText(text)
      setRows(parsed)
      setState('preview')
    }
    reader.readAsText(file)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
    disabled: state !== 'idle',
  })

  async function handleDownloadTemplate() {
    const res = await fetch('/api/purchases/csv-template')
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'purchases-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport() {
    if (validRows.length === 0) return
    setState('importing')
    try {
      const res = await fetch('/api/purchases/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText }),
      })
      const data: PurchaseImportResult = await res.json()
      setResult(data)
      setState('results')
      if (data.created > 0) onImported()
    } catch {
      setState('results')
      setResult({ created: 0, skipped: rows.length, errors: [{ row: 0, reason: 'Network error' }] })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {state === 'idle'      && 'Import Purchases'}
            {state === 'preview'   && 'Preview Import'}
            {state === 'importing' && 'Importing…'}
            {state === 'results'   && 'Import Complete'}
          </DialogTitle>
        </DialogHeader>

        {/* ── IDLE ── */}
        {state === 'idle' && (
          <div className="space-y-4 flex-1">
            <Button variant="outline" className="w-full" onClick={handleDownloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors
                ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}`}
            >
              <input {...getInputProps()} />
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium">
                {isDragActive ? 'Drop your CSV here' : 'Drag & drop your CSV or click to browse'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Columns: Receipt Date, Master Product, Variant, Qty., HSN Code, GST Rate Slab, Tax Paid (Y/N), Rate Per Unit, Vendor Name, Invoice #, Warehouse
              </p>
            </div>
          </div>
        )}

        {/* ── PREVIEW / IMPORTING ── */}
        {(state === 'preview' || state === 'importing') && (
          <div className="flex-1 flex flex-col min-h-0 space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                {validRows.length} valid
              </span>
              {invalidRows.length > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <XCircle className="h-4 w-4" />
                  {invalidRows.length} invalid (will be skipped)
                </span>
              )}
            </div>
            <ScrollArea className="flex-1 border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate/Unit</TableHead>
                    <TableHead>GST</TableHead>
                    <TableHead>Tax Paid</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.rowIndex} className={row.error ? 'bg-destructive/5' : ''}>
                      <TableCell className="text-xs text-muted-foreground">{row.rowIndex}</TableCell>
                      <TableCell className="text-sm">{row.date}</TableCell>
                      <TableCell className="text-sm font-medium">{row.master}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.variant || '—'}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums">{row.qty || '—'}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums">
                        {row.ratePerUnit ? `₹${row.ratePerUnit}` : '—'}
                      </TableCell>
                      <TableCell className="text-sm">{row.gstRateSlab}</TableCell>
                      <TableCell className="text-sm">{row.taxPaid ? 'Y' : 'N'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.vendorName || '—'}</TableCell>
                      <TableCell className="text-sm">{row.warehouseName}</TableCell>
                      <TableCell>
                        {row.error ? (
                          <span className="text-xs text-destructive">{row.error}</span>
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        )}

        {/* ── RESULTS ── */}
        {state === 'results' && result && (
          <div className="flex-1 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-green-50 p-4 text-center">
                <div className="text-2xl font-bold text-green-700">{result.created}</div>
                <div className="text-sm text-green-600 mt-1">created</div>
              </div>
              <div className="rounded-lg border bg-muted/50 p-4 text-center">
                <div className="text-2xl font-bold text-muted-foreground">{result.skipped}</div>
                <div className="text-sm text-muted-foreground mt-1">skipped</div>
              </div>
              <div className="rounded-lg border bg-muted/50 p-4 text-center">
                <div className="text-2xl font-bold text-muted-foreground">{result.errors.length}</div>
                <div className="text-sm text-muted-foreground mt-1">errors</div>
              </div>
            </div>
            {result.errors.length > 0 && (
              <ScrollArea className="h-40 border rounded-md p-3">
                <div className="space-y-1">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-xs text-destructive flex gap-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span><span className="font-medium">Row {e.row}:</span> {e.reason}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        <DialogFooter>
          {state === 'idle' && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          {state === 'preview' && (
            <>
              <Button variant="outline" onClick={reset}>Back</Button>
              <Button onClick={handleImport} disabled={validRows.length === 0}>
                Import {validRows.length} {validRows.length === 1 ? 'row' : 'rows'} →
              </Button>
            </>
          )}
          {state === 'importing' && (
            <Button disabled>Importing…</Button>
          )}
          {state === 'results' && (
            <>
              <Button variant="outline" onClick={reset}>Import Another</Button>
              <Button onClick={() => { onOpenChange(false); reset() }}>View Purchases</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
