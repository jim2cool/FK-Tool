'use client'
import { useRef, useState } from 'react'
import Papa from 'papaparse'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { Upload, CheckCircle2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import type { CsvColumnMapping } from '@/lib/importers/sku-mapping-importer'

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'idle' | 'mapping' | 'importing' | 'results'

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
  key: keyof CsvColumnMapping
  label: string
  required: boolean
}

const MAPPING_FIELDS: MappingField[] = [
  { key: 'master_sku_name', label: 'Master SKU Name', required: true },
  { key: 'flipkart_sku',    label: 'Flipkart SKU',    required: false },
  { key: 'amazon_sku',      label: 'Amazon SKU',      required: false },
  { key: 'd2c_sku',         label: 'D2C SKU',         required: false },
  { key: 'description',     label: 'Description',     required: false },
]

// ─── Fuzzy auto-detection ─────────────────────────────────────────────────────

const SYNONYMS: Record<keyof CsvColumnMapping, string[]> = {
  master_sku_name: ['mastersku', 'masterskuname', 'skuname', 'productname', 'itemname', 'title', 'name', 'sku', 'product', 'skuid'],
  flipkart_sku:    ['flipkart', 'fksku', 'fklisting', 'fkid', 'flipkartsku', 'flipkartlisting', 'fklistingid'],
  amazon_sku:      ['amazon', 'amazonsku', 'asin', 'amz', 'amzsku', 'amazonasin', 'amazonlisting'],
  d2c_sku:         ['d2c', 'd2csku', 'websitesku', 'directsku', 'ownsite', 'shopifysku', 'websiteid'],
  description:     ['description', 'desc', 'details', 'productdescription', 'itemdescription', 'skudescription'],
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function autoDetect(headers: string[]): CsvColumnMapping {
  const mapping: CsvColumnMapping = {
    master_sku_name: '',
    flipkart_sku: null,
    amazon_sku: null,
    d2c_sku: null,
    description: null,
  }

  for (const field of Object.keys(SYNONYMS) as Array<keyof CsvColumnMapping>) {
    const synonyms = SYNONYMS[field]
    const match = headers.find(h => h.trim() !== '' && synonyms.includes(normalise(h)))
    if (match) {
      ;(mapping as unknown as Record<string, string | null>)[field] = match
    }
  }

  return mapping
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
  const [mapping, setMapping] = useState<CsvColumnMapping>({ master_sku_name: '', flipkart_sku: null, amazon_sku: null, d2c_sku: null, description: null })
  const [results, setResults] = useState<ImportResults | null>(null)
  const [showErrors, setShowErrors] = useState(false)

  function handleClose() {
    if (step === 'importing') return  // don't allow close while importing
    setStep('idle')
    setParsed(null)
    setResults(null)
    setShowErrors(false)
    onOpenChange(false)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.csv')) {
      toast.error('Please select a CSV file')
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      const rawText = ev.target?.result as string
      const { data: allData, meta } = Papa.parse<Record<string, string>>(rawText, {
        header: true,
        skipEmptyLines: true,
      })
      const headers = meta.fields ?? []

      setParsed({ headers, rows: allData.slice(0, 5), totalRows: allData.length, rawText })
      setMapping(autoDetect(headers))
      setStep('mapping')
    }
    reader.readAsText(file)
    // Reset so same file can be re-picked
    e.target.value = ''
  }

  function setField(key: keyof CsvColumnMapping, value: string) {
    setMapping(prev => ({
      ...prev,
      [key]: value === SKIP ? null : value,
    }))
  }

  function getSelectValue(key: keyof CsvColumnMapping): string {
    const v = mapping[key]
    return (v === null || v === '') ? SKIP : v
  }

  const canImport = !!mapping.master_sku_name

  async function handleImport() {
    if (!parsed || !canImport) return
    setStep('importing')

    try {
      const res = await fetch('/api/catalog/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: parsed.rawText, mapping }),
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
    )
  }

  function renderMapping() {
    if (!parsed) return null
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{parsed.headers.length} columns</span> detected in your file.
          Map each field below — unneeded fields can be skipped.
        </p>

        {/* Mapping table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Target Field</TableHead>
              <TableHead>Your Column</TableHead>
              <TableHead className="w-52">Sample Value</TableHead>
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
                    <Select
                      value={getSelectValue(field.key)}
                      onValueChange={v => setField(field.key, v)}
                    >
                      <SelectTrigger className="w-52 h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
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
                  <TableCell className="text-sm text-muted-foreground font-mono truncate max-w-[200px]">
                    {sampleVal}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

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
                      {MAPPING_FIELDS
                        .filter(f => mapping[f.key])
                        .map(f => <TableHead key={f.key} className="text-xs whitespace-nowrap">{f.label}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.rows.map((row, i) => (
                      <TableRow key={i}>
                        {MAPPING_FIELDS
                          .filter(f => mapping[f.key])
                          .map(f => {
                            const col = mapping[f.key]!
                            return (
                              <TableCell key={f.key} className="text-xs font-mono whitespace-nowrap max-w-[160px] truncate">
                                {row[col]?.trim() || <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            )
                          })}
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
              {total > 0
                ? `${total} row${total !== 1 ? 's' : ''} imported`
                : 'No rows imported'}
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

  // ─── Dialog layout ───────────────────────────────────────────────────────────

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
