'use client'

import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Upload, CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { parsePnlXlsx, type ParsedPnlRow } from '@/lib/importers/pnl-xlsx-parser'
import { toast } from 'sonner'

type Step = 'select-account' | 'upload' | 'parsing' | 'preview' | 'importing' | 'results'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete: () => void
}

interface MarketplaceAccount {
  id: string
  account_name: string
  platform: string
}

interface ImportResults {
  imported: number
  skipped: number
  enriched: number
  unmappedSkus: string[]
  anomalyCount: number
  errors: string[]
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

export function PnlImportDialog({ open, onOpenChange, onImportComplete }: Props) {
  const [step, setStep] = useState<Step>('select-account')
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [rows, setRows] = useState<ParsedPnlRow[]>([])
  const [duplicateItemIds, setDuplicateItemIds] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<ImportResults | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  // Compute counts
  const duplicateIndices = new Set(
    rows.map((r, i) => duplicateItemIds.has(r.orderItemId) ? i : -1).filter(i => i >= 0)
  )
  const errorIndices = new Set(
    rows.map((r, i) => r.error ? i : -1).filter(i => i >= 0)
  )
  const dupCount = duplicateIndices.size
  const errorCount = errorIndices.size
  const importableCount = rows.length - dupCount - errorCount

  const reset = useCallback(() => {
    setStep('select-account')
    setSelectedAccountId('')
    setRows([])
    setDuplicateItemIds(new Set())
    setResults(null)
    setParseError(null)
  }, [])

  // Fetch Flipkart marketplace accounts
  useEffect(() => {
    if (!open) return
    let cancelled = false

    async function fetchAccounts() {
      setLoadingAccounts(true)
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('marketplace_accounts')
          .select('id, account_name, platform')
          .eq('platform', 'flipkart')
        if (!cancelled && data) setAccounts(data)
      } catch {
        // empty dropdown
      } finally {
        if (!cancelled) setLoadingAccounts(false)
      }
    }

    fetchAccounts()
    return () => { cancelled = true }
  }, [open])

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setParseError(null)
    setStep('parsing')

    try {
      const buffer = await file.arrayBuffer()
      const parsed = await parsePnlXlsx(buffer)

      if (parsed.length === 0) {
        setParseError('No data rows found in the "Orders P&L" sheet.')
        setStep('upload')
        return
      }

      setRows(parsed)
      setStep('preview')

      // Check for duplicates
      try {
        const orderItemIds = parsed.map(r => r.orderItemId).filter(Boolean)
        const res = await fetch('/api/pnl/check-duplicates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderItemIds }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.existingItemIds?.length) {
            setDuplicateItemIds(new Set(data.existingItemIds))
          }
        }
      } catch {
        // proceed without dedup info
      }
    } catch (e) {
      setParseError((e as Error).message || 'Failed to parse XLSX file')
      setStep('upload')
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    multiple: false,
    disabled: step !== 'upload',
  })

  async function handleImport() {
    if (importableCount === 0) return
    setStep('importing')

    try {
      const skipIndices = [...duplicateIndices, ...errorIndices]
      const res = await fetch('/api/pnl/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows,
          marketplaceAccountId: selectedAccountId,
          skipRowIndices: skipIndices,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Import failed' }))
        toast.error(errData.error || 'Import failed')
        setStep('preview')
        return
      }

      const data: ImportResults = await res.json()
      setResults(data)
      setStep('results')
      if (data.imported > 0 || data.enriched > 0) onImportComplete()
    } catch (e) {
      toast.error((e as Error).message || 'Import failed')
      setStep('preview')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {step === 'select-account' && 'Import Flipkart P&L'}
            {step === 'upload' && 'Upload P&L File'}
            {step === 'parsing' && 'Parsing...'}
            {step === 'preview' && `Preview — ${rows.length} rows`}
            {step === 'importing' && 'Importing...'}
            {step === 'results' && 'Import Complete'}
          </DialogTitle>
        </DialogHeader>

        {/* -- SELECT ACCOUNT -- */}
        {step === 'select-account' && (
          <div className="space-y-4 flex-1">
            <p className="text-sm text-muted-foreground">
              Select the Flipkart marketplace account this P&L report belongs to.
            </p>
            {loadingAccounts ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading accounts...</span>
              </div>
            ) : (
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select Flipkart account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {/* -- UPLOAD -- */}
        {step === 'upload' && (
          <div className="space-y-4 flex-1">
            <p className="text-sm text-muted-foreground">
              Upload the Flipkart P&L XLSX file for{' '}
              <span className="font-medium text-foreground">
                {accounts.find(a => a.id === selectedAccountId)?.account_name}
              </span>
            </p>
            {parseError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 inline mr-1" />
                {parseError}
              </div>
            )}
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors
                ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}`}
            >
              <input {...getInputProps()} />
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium">
                {isDragActive ? 'Drop your XLSX here' : 'Drag & drop your P&L XLSX or click to browse'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Accepts .xlsx files exported from Flipkart Seller Hub
              </p>
            </div>
          </div>
        )}

        {/* -- PARSING -- */}
        {step === 'parsing' && (
          <div className="flex-1 flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">Parsing XLSX file...</span>
          </div>
        )}

        {/* -- PREVIEW / IMPORTING -- */}
        {(step === 'preview' || step === 'importing') && (
          <div className="flex flex-col space-y-3 flex-1 min-h-0">
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                {importableCount} ready to import
              </span>
              {dupCount > 0 && (
                <span className="flex items-center gap-1 text-yellow-600">
                  <AlertCircle className="h-4 w-4" />
                  {dupCount} duplicate{dupCount > 1 ? 's' : ''} (will skip)
                </span>
              )}
              {errorCount > 0 && (
                <span className="flex items-center gap-1 text-red-600">
                  <XCircle className="h-4 w-4" />
                  {errorCount} error{errorCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="max-h-[55vh] overflow-y-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Order Item ID</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Fees</TableHead>
                    <TableHead>Flag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 200).map((row, idx) => {
                    const isDup = duplicateIndices.has(idx)
                    const hasErr = errorIndices.has(idx)
                    return (
                      <TableRow
                        key={idx}
                        className={
                          hasErr ? 'bg-red-50' :
                          isDup ? 'bg-yellow-50' : ''
                        }
                      >
                        <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="text-xs font-mono">{row.orderItemId || '—'}</TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">{row.skuName || '—'}</TableCell>
                        <TableCell className="text-sm">{row.orderStatus || '—'}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {row.accountedNetSales ? fmt(row.accountedNetSales) : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {row.totalExpenses ? fmt(Math.abs(row.totalExpenses)) : '—'}
                        </TableCell>
                        <TableCell>
                          {hasErr ? (
                            <Badge variant="outline" className="text-red-700 border-red-400 bg-red-50 text-xs">
                              {row.error}
                            </Badge>
                          ) : isDup ? (
                            <Badge variant="outline" className="text-yellow-700 border-yellow-400 bg-yellow-50 text-xs">
                              Duplicate
                            </Badge>
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              {rows.length > 200 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Showing first 200 of {rows.length} rows
                </p>
              )}
            </div>
          </div>
        )}

        {/* -- RESULTS -- */}
        {step === 'results' && results && (
          <div className="flex-1 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-green-50 p-4 text-center">
                <div className="text-2xl font-bold text-green-700">{results.imported}</div>
                <div className="text-xs text-green-600 mt-1">Imported</div>
              </div>
              <div className="rounded-lg border bg-blue-50 p-4 text-center">
                <div className="text-2xl font-bold text-blue-700">{results.enriched}</div>
                <div className="text-xs text-blue-600 mt-1">Enriched</div>
              </div>
              <div className="rounded-lg border bg-muted/50 p-4 text-center">
                <div className="text-2xl font-bold text-muted-foreground">{results.skipped}</div>
                <div className="text-xs text-muted-foreground mt-1">Skipped</div>
              </div>
            </div>
            {results.unmappedSkus.length > 0 && (
              <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-700">
                <AlertCircle className="h-4 w-4 inline mr-1" />
                {results.unmappedSkus.length} unmapped SKU{results.unmappedSkus.length > 1 ? 's' : ''}:{' '}
                <span className="font-mono text-xs">{results.unmappedSkus.slice(0, 10).join(', ')}</span>
                {results.unmappedSkus.length > 10 && ` and ${results.unmappedSkus.length - 10} more`}
              </div>
            )}
            {results.anomalyCount > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 inline mr-1" />
                {results.anomalyCount} anomal{results.anomalyCount > 1 ? 'ies' : 'y'} detected. Check the Anomaly Rules panel for details.
              </div>
            )}
            {results.errors.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 inline mr-1" />
                {results.errors.length} error{results.errors.length > 1 ? 's' : ''}:
                <ul className="ml-5 mt-1 list-disc text-xs">
                  {results.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'select-account' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => setStep('upload')} disabled={!selectedAccountId}>
                Next &rarr;
              </Button>
            </>
          )}
          {step === 'upload' && (
            <Button variant="outline" onClick={() => setStep('select-account')}>
              &larr; Back
            </Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={reset}>Cancel</Button>
              <Button onClick={handleImport} disabled={importableCount === 0}>
                Import {importableCount} rows &rarr;
              </Button>
            </>
          )}
          {step === 'importing' && (
            <Button disabled>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Importing...
            </Button>
          )}
          {step === 'results' && (
            <>
              <Button variant="outline" onClick={reset}>Import Another</Button>
              <Button onClick={() => { onOpenChange(false); reset() }}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
