'use client'

import { useState, useEffect, useCallback } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { toast } from 'sonner'
import { LabelUploadZone } from '@/components/labels/LabelUploadZone'
import { LabelPreviewTable } from '@/components/labels/LabelPreviewTable'
import { UnmappedSkuPanel } from '@/components/labels/UnmappedSkuPanel'
import { parseLabelPdf } from '@/lib/labels/pdf-parser'
import { cropAndGroupLabels, groupLabelsByProduct } from '@/lib/labels/pdf-cropper'
import type { ParsedLabel, ResolvedLabel, LabelGroup, LabelSortResult, UnmappedSku } from '@/lib/labels/types'

interface Warehouse { id: string; name: string }
interface MasterSkuOption { id: string; name: string }

type PageState = 'idle' | 'parsing' | 'resolving' | 'ready' | 'ingesting'

export default function LabelsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [masterSkus, setMasterSkus] = useState<MasterSkuOption[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('')
  const [state, setState] = useState<PageState>('idle')
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [resolvedLabels, setResolvedLabels] = useState<ResolvedLabel[]>([])
  const [sortResult, setSortResult] = useState<LabelSortResult | null>(null)
  const [userRole] = useState<'owner' | 'admin' | 'manager' | 'staff' | 'member'>('owner')

  useEffect(() => {
    Promise.all([
      fetch('/api/warehouses').then(r => r.json()),
      fetch('/api/catalog/master-skus').then(r => r.json()),
    ]).then(([wh, skus]) => {
      setWarehouses(Array.isArray(wh) ? wh : [])
      const flat = (skus ?? []).flatMap((s: { id: string; name: string; variants?: Array<{ id: string; name: string }> }) =>
        [{ id: s.id, name: s.name }, ...(s.variants ?? []).map((v: { id: string; name: string }) => ({ id: v.id, name: v.name }))]
      )
      setMasterSkus(flat)
    }).catch(() => toast.error('Failed to load reference data'))
  }, [])

  const handleFilesSelected = useCallback(async (files: File[]) => {
    if (!selectedWarehouse) {
      toast.error('Please select a warehouse first')
      return
    }

    setUploadedFiles(files)
    setState('parsing')

    try {
      const allLabels: ParsedLabel[] = []
      for (let fi = 0; fi < files.length; fi++) {
        const labels = await parseLabelPdf(files[fi], fi)
        allLabels.push(...labels)
      }

      if (allLabels.length === 0) {
        toast.error('No valid Flipkart labels found in the uploaded PDFs')
        setState('idle')
        return
      }

      toast.success(`Parsed ${allLabels.length} labels from ${files.length} file(s)`)
      setState('resolving')

      const uniqueItems = Array.from(
        new Map(allLabels.map(l => [l.platformSku, { platformSku: l.platformSku, gstin: l.gstin }])).values()
      )

      const res = await fetch('/api/labels/resolve-skus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: uniqueItems }),
      })

      if (!res.ok) throw new Error('Failed to resolve SKUs')
      const { resolved: resolvedMap } = await res.json()

      const skuLookup = new Map<string, {
        masterSkuId: string | null; masterSkuName: string | null
        marketplaceAccountId: string | null; organizationId: string | null
      }>()
      for (const r of resolvedMap) skuLookup.set(r.platformSku, r)

      const resolved: ResolvedLabel[] = allLabels.map(label => ({
        ...label,
        masterSkuId: skuLookup.get(label.platformSku)?.masterSkuId ?? null,
        masterSkuName: skuLookup.get(label.platformSku)?.masterSkuName ?? null,
        marketplaceAccountId: skuLookup.get(label.platformSku)?.marketplaceAccountId ?? null,
        organizationId: skuLookup.get(label.platformSku)?.organizationId ?? null,
      }))

      setResolvedLabels(resolved)
      setSortResult(buildSortResult(resolved))
      setState('ready')
    } catch (e) {
      toast.error((e as Error).message)
      setState('idle')
    }
  }, [selectedWarehouse])

  async function handleDownloadGroup(group: LabelGroup) {
    try {
      const croppedPdfs = await cropAndGroupLabels([group], uploadedFiles)
      for (const [fileName, bytes] of croppedPdfs) downloadPdf(bytes, `${fileName}.pdf`)
    } catch { toast.error('Failed to generate PDF') }
  }

  async function handleDownloadAll() {
    if (!sortResult) return
    try {
      const croppedPdfs = await cropAndGroupLabels(sortResult.groups, uploadedFiles)
      for (const [fileName, bytes] of croppedPdfs) downloadPdf(bytes, `${fileName}.pdf`)
      toast.success(`Downloaded ${croppedPdfs.size} PDFs`)
    } catch { toast.error('Failed to generate PDFs') }
  }

  async function handleIngest() {
    if (!sortResult || !selectedWarehouse) return
    setState('ingesting')
    try {
      const mappedLabels = resolvedLabels.filter(l => l.masterSkuId)
      const today = new Date().toISOString().split('T')[0]

      const res = await fetch('/api/labels/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId: selectedWarehouse,
          labels: mappedLabels.map(l => ({
            orderId: l.orderId,
            masterSkuId: l.masterSkuId,
            marketplaceAccountId: l.marketplaceAccountId,
            quantity: 1,
            salePrice: l.salePrice,
            paymentType: l.paymentType,
            platformSku: l.platformSku,
            dispatchDate: today,
            courier: l.courier,
            awbNumber: l.awbNumber,
          })),
        }),
      })

      if (!res.ok) throw new Error('Failed to save order data')
      const { created, skipped } = await res.json()
      toast.success(`Saved ${created} orders (${skipped} already existed)`)
    } catch (e) { toast.error((e as Error).message) }
    finally { setState('ready') }
  }

  function handleSkuMapped(platformSku: string, masterSkuId: string) {
    const skuName = masterSkus.find(s => s.id === masterSkuId)?.name ?? ''
    const updated = resolvedLabels.map(l =>
      l.platformSku === platformSku ? { ...l, masterSkuId, masterSkuName: skuName } : l
    )
    setResolvedLabels(updated)
    setSortResult(buildSortResult(updated))
  }

  function handleReset() {
    setState('idle')
    setUploadedFiles([])
    setResolvedLabels([])
    setSortResult(null)
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Label Sorting</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload Flipkart label PDFs to sort by product for dispatch. Labels are cropped and grouped automatically.
          <InfoTooltip content="Upload the label PDFs you download from Flipkart Seller Hub. The system parses each label, matches it to your master catalog, and outputs sorted PDFs — one per product — ready for your label printer." />
        </p>
      </div>

      <div className="mb-6 max-w-xs">
        <label className="text-sm font-medium mb-1.5 block">
          Warehouse
          <InfoTooltip content="Select the warehouse these labels are being dispatched from. This info is not on the labels so you need to select it." />
        </label>
        <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse} disabled={state !== 'idle'}>
          <SelectTrigger><SelectValue placeholder="Select warehouse..." /></SelectTrigger>
          <SelectContent>
            {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {state === 'idle' && (
        <LabelUploadZone onFilesSelected={handleFilesSelected} disabled={!selectedWarehouse} />
      )}

      {state === 'parsing' && <div className="text-center py-8 text-muted-foreground">Parsing label PDFs...</div>}
      {state === 'resolving' && <div className="text-center py-8 text-muted-foreground">Matching SKUs to master catalog...</div>}

      {(state === 'ready' || state === 'ingesting') && sortResult && (
        <div className="space-y-6">
          <UnmappedSkuPanel unmapped={sortResult.unmapped} masterSkus={masterSkus} userRole={userRole} onMapped={handleSkuMapped} />

          {sortResult.groups.length > 0 ? (
            <LabelPreviewTable result={sortResult} onDownloadGroup={handleDownloadGroup} onDownloadAll={handleDownloadAll} />
          ) : (
            <div className="text-center py-8 text-muted-foreground">No labels could be matched to products. Map the unknown SKUs above first.</div>
          )}

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={handleReset}>Upload New Files</Button>
            {sortResult.groups.length > 0 && (
              <Button onClick={handleIngest} disabled={state === 'ingesting'}>
                {state === 'ingesting' ? 'Saving...' : `Save ${sortResult.groups.reduce((s, g) => s + g.count, 0)} Orders to Database`}
              </Button>
            )}
          </div>
        </div>
      )}

      {state === 'idle' && !selectedWarehouse && (
        <div className="text-center py-8 text-muted-foreground text-sm mt-4">
          Select a warehouse above, then upload your Flipkart label PDFs to get started.
        </div>
      )}
    </div>
  )
}

function buildSortResult(labels: ResolvedLabel[]): LabelSortResult {
  const groups = groupLabelsByProduct(labels)
  const unmappedMap = new Map<string, UnmappedSku>()
  for (const label of labels) {
    if (!label.masterSkuId) {
      const existing = unmappedMap.get(label.platformSku)
      if (existing) { existing.count++; existing.pages.push({ fileIndex: label.fileIndex, pageIndex: label.pageIndex }) }
      else unmappedMap.set(label.platformSku, { platformSku: label.platformSku, productDescription: label.productDescription, count: 1, pages: [{ fileIndex: label.fileIndex, pageIndex: label.pageIndex }] })
    }
  }
  return {
    groups,
    unmapped: Array.from(unmappedMap.values()),
    totalLabels: labels.length,
    stats: {
      totalOrders: labels.length,
      codCount: labels.filter(l => l.paymentType === 'COD').length,
      prepaidCount: labels.filter(l => l.paymentType === 'PREPAID').length,
      orgBreakdown: Object.entries(
        labels.reduce((acc, l) => { const n = l.sellerName || 'Unknown'; acc[n] = (acc[n] || 0) + 1; return acc }, {} as Record<string, number>)
      ).map(([orgName, count]) => ({ orgName, count })),
    },
  }
}

function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
