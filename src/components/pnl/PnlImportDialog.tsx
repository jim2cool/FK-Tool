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

type Step = 'select-account' | 'upload' | 'preview' | 'importing' | 'results'

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
  unmapped: number
  anomalies: number
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
  const [duplicateIndices, setDuplicateIndices] = useState<Set<number>>(new Set())
  const [unmappedIndices, setUnmappedIndices] = useState<Set<number>>(new Set())
  const [results, setResults] = useState<ImportResults | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  const validRows = rows.filter((_, i) => !duplicateIndices.has(i) && !unmappedIndices.has(i))
  const dupCount = rows.filter((_, i) => duplicateIndices.has(i)).length
  const unmappedCount = rows.filter((_, i) => unmappedIndices.has(i)).length
  const importableCount = rows.length - dupCount

  const reset = useCallback(() => {
    setStep('select-account')
    setSelectedAccountId('')
    setRows([])
    setDuplicateIndices(new Set())
    setUnmappedIndices(new Set())
    setResults(null)
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
        if (!cancelled && data) {
          setAccounts(data)
        }
      } catch {
        // silently fail — user will see empty dropdown
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

    try {
      const buffer = await file.arrayBuffer()
      const parsed = await parsePnlXlsx(buffer)
      setRows(parsed)

      // Check for duplicates
      setStep('preview')
      try {
        const orderItemIds = parsed.map((r: ParsedPnlRow) => r.orderItemId).filter(Boolean)
        const res = await fetch('/api/pnl/check-duplicates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_item_ids: orderItemIds,
            marketplace_account_id: selectedAccountId,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.duplicateIndices) {
            setDuplicateIndices(new Set(data.duplicateIndices as number[]))
          }
          if (data.unmappedIndices) {
            setUnmappedIndices(new Set(data.unmappedIndices as number[]))
          }
        }
      } catch {
        // proceed without dedup info
      }
    } catch {
      // parse error — could show toast here
    }
  }, [selectedAccountId])

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
      const res = await fetch('/api/pnl/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows,
          marketplace_account_id: selectedAccountId,
          skipIndices: [...duplicateIndices],
        }),
      })
      const data: ImportResults = await res.json()
      setResults(data)
      setStep('results')
      if (data.imported > 0) onImportComplete()
    } catch {
      setResults({
        imported: 0,
        skipped: rows.length,
        enriched: 0,
        unmapped: 0,
        anomalies: 0,
      })
      setStep('results')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {step === 'select-account' && 'Import Flipkart P&L'}
            {step === 'upload' && 'Upload P&L File'}
            {step === 'preview' && 'Preview Import'}
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
            ) : accounts.length === 0 ? (
              <div className="border border-dashed rounded-lg p-6 text-center">
                <AlertCircle className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No Flipkart marketplace accounts found. Add one in Settings first.
                </p>
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
                  {dupCount} duplicate{dupCount > 1 ? 's' : ''} (will be skipped)
                </span>
              )}
              {unmappedCount > 0 && (
                <span className="flex items-center gap-1 text-orange-600">
                  <XCircle className="h-4 w-4" />
                  {unmappedCount} unmapped SKU{unmappedCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="max-h-[55vh] overflow-y-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Fees</TableHead>
                    <TableHead>Flag</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, idx) => {
                    const isDup = duplicateIndices.has(idx)
                    const isUnmapped = unmappedIndices.has(idx)
                    return (
                      <TableRow
                        key={idx}
                        className={
                          isDup ? 'bg-yellow-50 dark:bg-yellow-950/20' :
                          isUnmapped ? 'bg-orange-50 dark:bg-orange-950/20' : ''
                        }
                      >
                        <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="text-sm font-mono">{row.orderItemId || '—'}</TableCell>
                        <TableCell className="text-sm">{row.skuName || '—'}</TableCell>
                        <TableCell className="text-sm">{row.orderStatus || '—'}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {row.accountedNetSales ? fmt(row.accountedNetSales) : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {row.totalExpenses ? fmt(Math.abs(row.totalExpenses)) : '—'}
                        </TableCell>
                        <TableCell>
                          {isDup ? (
                            <Badge variant="outline" className="text-yellow-700 border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 text-xs">
                              Duplicate
                            </Badge>
                          ) : isUnmapped ? (
                            <Badge variant="outline" className="text-orange-700 border-orange-400 bg-orange-50 dark:bg-orange-950/30 text-xs">
                              Unmapped
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
            </div>
          </div>
        )}

        {/* -- RESULTS -- */}
        {step === 'results' && results && (
          <div className="flex-1 space-y-4">
            <div className="grid grid-cols-5 gap-3">
              <div className="rounded-lg border bg-green-50 dark:bg-green-950/20 p-4 text-center">
                <div className="text-2xl font-bold text-green-700 dark:text-green-400">{results.imported}</div>
                <div className="text-xs text-green-600 dark:text-green-500 mt-1">Imported</div>
              </div>
              <div className="rounded-lg border bg-muted/50 p-4 text-center">
                <div className="text-2xl font-bold text-muted-foreground">{results.skipped}</div>
                <div className="text-xs text-muted-foreground mt-1">Skipped</div>
              </div>
              <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 p-4 text-center">
                <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{results.enriched}</div>
                <div className="text-xs text-blue-600 dark:text-blue-500 mt-1">Enriched</div>
              </div>
              <div className="rounded-lg border bg-orange-50 dark:bg-orange-950/20 p-4 text-center">
                <div className="text-2xl font-bold text-orange-700 dark:text-orange-400">{results.unmapped}</div>
                <div className="text-xs text-orange-600 dark:text-orange-500 mt-1">Unmapped</div>
              </div>
              <div className="rounded-lg border bg-red-50 dark:bg-red-950/20 p-4 text-center">
                <div className="text-2xl font-bold text-red-700 dark:text-red-400">{results.anomalies}</div>
                <div className="text-xs text-red-600 dark:text-red-500 mt-1">Anomalies</div>
              </div>
            </div>
            {results.unmapped > 0 && (
              <p className="text-xs text-orange-600">
                Some platform SKUs could not be mapped to master SKUs. Map them in Master Catalog &rarr; SKU Mappings.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'select-account' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                onClick={() => setStep('upload')}
                disabled={!selectedAccountId}
              >
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
              <Button variant="outline" onClick={reset}>Back</Button>
              <Button onClick={handleImport} disabled={importableCount === 0}>
                Import {importableCount} {importableCount === 1 ? 'row' : 'rows'}
                {dupCount > 0 && ` (skip ${dupCount})`}
                {' \u2192'}
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
