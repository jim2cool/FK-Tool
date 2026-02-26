'use client'
import { useRef, useState, useEffect } from 'react'
import Papa from 'papaparse'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { Upload, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, Plus, X, Download } from 'lucide-react'
import type { CsvColumnMapping } from '@/lib/importers/sku-mapping-importer'

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'idle' | 'mapping' | 'importing' | 'results'

type StringMappingKey = Exclude<keyof CsvColumnMapping, 'variant_attr_cols' | 'account_cols'>

interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]  // first 5 rows for preview
  totalRows: number
  rawText: string
}

interface ImportResults {
  created: number
  updated: number
  failed: number
  errors: Array<{ row: number; sku: string; message: string }>
}

interface MappingField {
  key: StringMappingKey
  label: string
  required: boolean
}

interface MarketplaceAccount {
  id: string
  platform: string
  account_name: string
}

type AccountColEntry = { csv_col: string; marketplace_account_id: string; platform: string }

const PLATFORM_LABEL: Record<string, string> = { flipkart: 'Flipkart', amazon: 'Amazon', d2c: 'D2C' }
const PLATFORM_SHORT: Record<string, string> = { flipkart: 'FK', amazon: 'AMZ', d2c: 'D2C' }

const MAPPING_FIELDS: MappingField[] = [
  { key: 'master_sku_name', label: 'Master SKU Name', required: true },
  { key: 'parent_sku_name', label: 'Parent Product',  required: false },
  { key: 'flipkart_sku',    label: 'Flipkart SKU (no account)', required: false },
  { key: 'amazon_sku',      label: 'Amazon SKU (no account)',   required: false },
  { key: 'd2c_sku',         label: 'D2C SKU (no account)',      required: false },
  { key: 'description',     label: 'Description',               required: false },
]

// ─── Fuzzy auto-detection ─────────────────────────────────────────────────────

const SYNONYMS: Record<StringMappingKey, string[]> = {
  master_sku_name: ['mastersku', 'masterskuname', 'skuname', 'productname', 'itemname', 'title', 'name', 'sku', 'product', 'skuid', 'masterskucode', 'skucode', 'code', 'productcode', 'item', 'itemcode', 'skukey', 'variantname'],
  parent_sku_name: ['parent', 'parentsku', 'parentproduct', 'productgroup', 'group', 'parentname', 'basename', 'masterproduct', 'parentitem', 'productfamily'],
  flipkart_sku:    ['flipkart', 'fksku', 'fklisting', 'fkid', 'flipkartsku', 'flipkartlisting', 'fklistingid', 'fskuid', 'flipkartid', 'fsn', 'fkskuid'],
  amazon_sku:      ['amazon', 'amazonsku', 'asin', 'amz', 'amzsku', 'amazonasin', 'amazonlisting', 'amzn', 'amzasin', 'amazonid', 'amazonskuid'],
  d2c_sku:         ['d2c', 'd2csku', 'websitesku', 'directsku', 'ownsite', 'shopifysku', 'websiteid', 'd2cid', 'storeid', 'woosku', 'shopify', 'woocommerce', 'website'],
  description:     ['description', 'desc', 'details', 'productdescription', 'itemdescription', 'skudescription', 'productdesc', 'itemdesc', 'summary', 'about', 'info', 'notes', 'shortdescription'],
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function autoDetect(headers: string[]): CsvColumnMapping {
  const mapping: CsvColumnMapping = {
    master_sku_name: '',
    flipkart_sku: null, amazon_sku: null, d2c_sku: null,
    description: null, parent_sku_name: null,
    variant_attr_cols: [], account_cols: [],
  }
  for (const field of Object.keys(SYNONYMS) as Array<StringMappingKey>) {
    const synonyms = SYNONYMS[field]
    const match = headers.find(h => h.trim() !== '' && synonyms.includes(normalise(h)))
    if (match) (mapping as unknown as Record<string, string | null>)[field] = match
  }
  return mapping
}

/** Auto-detect per-account columns: header must be exactly "{Platform} SKU - {Account Name}" */
function autoDetectAccountCols(headers: string[], accounts: MarketplaceAccount[]): AccountColEntry[] {
  const result: AccountColEntry[] = []
  for (const account of accounts) {
    const expected = `${PLATFORM_LABEL[account.platform] ?? account.platform} SKU - ${account.account_name}`
    const match = headers.find(h => h.trim() === expected)
    if (match) result.push({ csv_col: match, marketplace_account_id: account.id, platform: account.platform })
  }
  return result
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

const SKIP = '__skip__'

export function CsvImportDialog({ open, onOpenChange, onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('idle')
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = useState<CsvColumnMapping>({
    master_sku_name: '', flipkart_sku: null, amazon_sku: null, d2c_sku: null,
    description: null, parent_sku_name: null, variant_attr_cols: [], account_cols: [],
  })
  const [variantAttrCols, setVariantAttrCols] = useState<Array<{ csv_col: string; attr_key: string }>>([])
  const [accountColsMapping, setAccountColsMapping] = useState<AccountColEntry[]>([])
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([])
  const [results, setResults] = useState<ImportResults | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // Fetch accounts when dialog opens
  useEffect(() => {
    if (open) {
      fetch('/api/marketplace-accounts')
        .then(r => r.json())
        .then(data => setAccounts(Array.isArray(data) ? data : []))
        .catch(() => {})
    }
  }, [open])

  // Re-run account auto-detection when accounts load (in case file was already parsed)
  useEffect(() => {
    if (accounts.length > 0 && parsed && accountColsMapping.length === 0) {
      setAccountColsMapping(autoDetectAccountCols(parsed.headers, accounts))
    }
  }, [accounts, parsed, accountColsMapping.length])

  function handleClose() {
    if (step === 'importing') return
    setStep('idle')
    setParsed(null)
    setResults(null)
    setShowErrors(false)
    setVariantAttrCols([])
    setAccountColsMapping([])
    onOpenChange(false)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.csv')) { toast.error('Please select a CSV file'); return }

    const reader = new FileReader()
    reader.onload = (ev) => {
      const rawText = ev.target?.result as string
      const { data: allData, meta } = Papa.parse<Record<string, string>>(rawText, {
        header: true, skipEmptyLines: true,
      })
      const headers = meta.fields ?? []
      setParsed({ headers, rows: allData.slice(0, 5), totalRows: allData.length, rawText })
      setMapping(autoDetect(headers))
      setAccountColsMapping(autoDetectAccountCols(headers, accounts))
      setStep('mapping')
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function setField(key: StringMappingKey, value: string) {
    setMapping(prev => ({ ...prev, [key]: value === SKIP ? null : value }))
  }

  function getSelectValue(key: StringMappingKey): string {
    const v = mapping[key]
    return (v === null || v === '') ? SKIP : (v as string)
  }

  async function downloadTemplate() {
    setDownloading(true)
    try {
      const res = await fetch('/api/catalog/csv-template')
      if (!res.ok) { toast.error('Failed to generate template'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'sku-import-template.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download template')
    } finally {
      setDownloading(false)
    }
  }

  const canImport = !!mapping.master_sku_name

  async function handleImport() {
    if (!parsed || !canImport) return
    setStep('importing')
    try {
      const res = await fetch('/api/catalog/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv: parsed.rawText,
          mapping: { ...mapping, variant_attr_cols: variantAttrCols, account_cols: accountColsMapping },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Import failed')
        setStep('mapping')
        return
      }
      setResults(data as ImportResults)
      setStep('results')
      if (data.created > 0 || data.updated > 0) onImported()
    } catch {
      toast.error('Network error during import')
      setStep('mapping')
    }
  }

  // ─── Render helpers ──────────────────────────────────────────────────────────

  function renderIdle() {
    return (
      <div className="space-y-4">
        {/* Template download hint */}
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
          <div>
            <p className="text-sm font-medium">First time importing?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Download our template — headers are pre-filled with your configured accounts.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={downloadTemplate} disabled={downloading}>
            <Download className="h-4 w-4 mr-2" />
            {downloading ? 'Generating…' : 'Download Template'}
          </Button>
        </div>

        <div
          className="flex flex-col items-center justify-center gap-4 py-12 border-2 border-dashed border-muted rounded-lg cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-10 w-10 text-muted-foreground" />
          <div className="text-center">
            <p className="text-sm font-medium">Click to select a CSV file</p>
            <p className="text-xs text-muted-foreground mt-1">Any column headers — you&apos;ll map them next</p>
          </div>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
        </div>
      </div>
    )
  }

  function renderMapping() {
    if (!parsed) return null
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{parsed.headers.length} columns</span> detected.
          Map each field — unneeded fields can be skipped.
        </p>

        {/* Standard field mapping */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Target Field</TableHead>
              <TableHead>Your Column</TableHead>
              <TableHead className="w-48">Sample Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MAPPING_FIELDS.map(field => {
              const selectedCol = mapping[field.key]
              const sampleVal = selectedCol && parsed.rows[0]
                ? parsed.rows[0][selectedCol]?.trim() || '—'
                : '—'
              const isAutoDetected = selectedCol !== null && selectedCol !== ''
              return (
                <TableRow key={field.key}>
                  <TableCell className="font-medium text-sm">
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                    {isAutoDetected && (
                      <Badge variant="secondary" className="ml-2 text-xs py-0 px-1.5 bg-green-100 text-green-700 border-green-200">
                        auto
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select value={getSelectValue(field.key)} onValueChange={v => setField(field.key, v)}>
                      <SelectTrigger className="w-52 h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP}>
                          <span className="text-muted-foreground italic">— skip this field —</span>
                        </SelectItem>
                        {parsed.headers.filter(h => h.trim() !== '').map(h => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono truncate max-w-[160px]">
                    {sampleVal}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        {/* Per-account column mapping */}
        {accounts.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Account Mappings{' '}
                <span className="font-normal normal-case">— map each account&apos;s CSV column</span>
              </p>
              {accounts.map(account => {
                const entry = accountColsMapping.find(ac => ac.marketplace_account_id === account.id)
                const csvCol = entry?.csv_col ?? ''
                const isAutoDetected = !!csvCol
                return (
                  <div key={account.id} className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 w-52 shrink-0">
                      <Badge variant="outline" className="text-xs shrink-0">
                        {PLATFORM_SHORT[account.platform] ?? account.platform}
                      </Badge>
                      <span className="text-sm truncate">{account.account_name}</span>
                      {isAutoDetected && (
                        <Badge className="ml-1 text-xs py-0 px-1.5 bg-green-100 text-green-700 border-green-200 shrink-0">
                          auto
                        </Badge>
                      )}
                    </div>
                    <Select
                      value={csvCol || SKIP}
                      onValueChange={v => {
                        const newCol = v === SKIP ? '' : v
                        setAccountColsMapping(prev => {
                          const without = prev.filter(ac => ac.marketplace_account_id !== account.id)
                          if (!newCol) return without
                          return [...without, { csv_col: newCol, marketplace_account_id: account.id, platform: account.platform }]
                        })
                      }}
                    >
                      <SelectTrigger className="w-52 h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP}>
                          <span className="text-muted-foreground italic">— skip —</span>
                        </SelectItem>
                        {parsed.headers.filter(h => h.trim() !== '').map(h => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {csvCol && parsed.rows[0] && (
                      <span className="text-xs text-muted-foreground font-mono truncate max-w-[120px]">
                        {parsed.rows[0][csvCol]?.trim() || '—'}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Variant attribute columns */}
        {mapping.parent_sku_name && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Variant Attributes <span className="text-muted-foreground font-normal normal-case">(optional)</span>
              </p>
              {variantAttrCols.map((attrRow, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select
                    value={attrRow.csv_col || SKIP}
                    onValueChange={v => setVariantAttrCols(prev =>
                      prev.map((r, idx) => idx === i ? { ...r, csv_col: v === SKIP ? '' : v } : r)
                    )}
                  >
                    <SelectTrigger className="w-44 h-8 text-sm"><SelectValue placeholder="CSV column" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP}><span className="text-muted-foreground italic">— pick column —</span></SelectItem>
                      {parsed.headers.filter(h => h.trim() !== '').map(h => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground text-sm">→</span>
                  <Input
                    className="w-32 h-8 text-sm"
                    placeholder="Attribute key"
                    value={attrRow.attr_key}
                    onChange={e => setVariantAttrCols(prev =>
                      prev.map((r, idx) => idx === i ? { ...r, attr_key: e.target.value } : r)
                    )}
                  />
                  <Button variant="ghost" size="sm" onClick={() => setVariantAttrCols(prev => prev.filter((_, idx) => idx !== i))}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {variantAttrCols.length < 3 && (
                <Button variant="ghost" size="sm" className="text-xs"
                  onClick={() => setVariantAttrCols(prev => [...prev, { csv_col: '', attr_key: '' }])}>
                  <Plus className="h-3 w-3 mr-1" /> Add attribute column
                </Button>
              )}
            </div>
          </>
        )}

        {/* Row preview */}
        {parsed.rows.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Preview — first {Math.min(parsed.rows.length, 5)} rows
              </p>
              <div className="overflow-x-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {MAPPING_FIELDS.filter(f => mapping[f.key]).map(f =>
                        <TableHead key={f.key} className="text-xs whitespace-nowrap">{f.label}</TableHead>
                      )}
                      {accountColsMapping.map(ac => {
                        const acct = accounts.find(a => a.id === ac.marketplace_account_id)
                        return (
                          <TableHead key={ac.marketplace_account_id} className="text-xs whitespace-nowrap">
                            {PLATFORM_SHORT[ac.platform]} · {acct?.account_name ?? '?'}
                          </TableHead>
                        )
                      })}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.rows.map((row, i) => (
                      <TableRow key={i}>
                        {MAPPING_FIELDS.filter(f => mapping[f.key]).map(f => {
                          const col = mapping[f.key]!
                          return (
                            <TableCell key={f.key} className="text-xs font-mono whitespace-nowrap max-w-[140px] truncate">
                              {row[col]?.trim() || <span className="text-muted-foreground">—</span>}
                            </TableCell>
                          )
                        })}
                        {accountColsMapping.map(ac => (
                          <TableCell key={ac.marketplace_account_id} className="text-xs font-mono whitespace-nowrap max-w-[140px] truncate">
                            {row[ac.csv_col]?.trim() || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}

        {!canImport && (
          <p className="text-sm text-destructive">
            ⚠ You must map the &ldquo;Master SKU Name&rdquo; field before importing.
          </p>
        )}
      </div>
    )
  }

  function renderImporting() {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <div className="h-10 w-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
        <p className="text-sm text-muted-foreground">Importing {parsed?.totalRows} rows…</p>
      </div>
    )
  }

  function renderResults() {
    if (!results) return null
    const hasErrors = results.errors.length > 0
    const total = results.created + results.updated
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          {total > 0
            ? <CheckCircle2 className="h-6 w-6 text-green-600 mt-0.5 shrink-0" />
            : <AlertCircle className="h-6 w-6 text-destructive mt-0.5 shrink-0" />}
          <div>
            <p className="font-medium">
              {total > 0 ? `${total} row${total !== 1 ? 's' : ''} imported` : 'No rows imported'}
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {results.created} created · {results.updated} updated
              {results.failed > 0 && ` · ${results.failed} failed`}
            </p>
          </div>
        </div>
        {hasErrors && (
          <div className="border rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium bg-destructive/5 hover:bg-destructive/10 transition-colors"
              onClick={() => setShowErrors(v => !v)}
            >
              <span className="text-destructive">{results.errors.length} error{results.errors.length !== 1 ? 's' : ''}</span>
              {showErrors ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {showErrors && (
              <div className="max-h-48 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Row</TableHead>
                      <TableHead className="w-40">SKU</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.errors.map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs tabular-nums">{e.row}</TableCell>
                        <TableCell className="text-xs font-mono truncate max-w-[160px]">{e.sku}</TableCell>
                        <TableCell className="text-xs text-destructive">{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'results' ? 'Import Complete' : 'Import Master SKUs from CSV'}
          </DialogTitle>
        </DialogHeader>

        <div className="py-2">
          {step === 'idle'      && renderIdle()}
          {step === 'mapping'   && renderMapping()}
          {step === 'importing' && renderImporting()}
          {step === 'results'   && renderResults()}
        </div>

        <DialogFooter>
          {step === 'idle' && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {step === 'mapping' && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleImport} disabled={!canImport}>
                Import {parsed?.totalRows ?? ''} rows →
              </Button>
            </>
          )}
          {step === 'results' && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
