'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { LabelUploadZone } from '@/components/labels/LabelUploadZone'
import { LabelPreviewTable } from '@/components/labels/LabelPreviewTable'
import { UnmappedSkuPanel } from '@/components/labels/UnmappedSkuPanel'
import { LabelCropSelector, type CropBox, type CropProfile, type LabelSize, LABEL_SIZES, INVOICE_SIZE, fetchProfiles, deleteProfile, updateProfile } from '@/components/labels/LabelCropSelector'
import { parseLabelPdf } from '@/lib/labels/pdf-parser'
import { cropAndGroupLabels, cropAndGroupInvoices, groupLabelsByProduct } from '@/lib/labels/pdf-cropper'
import type { ParsedLabel, ResolvedLabel, LabelGroup, LabelSortResult, UnmappedSku } from '@/lib/labels/types'
import { Trash2, Pencil } from 'lucide-react'

interface Warehouse { id: string; name: string }
interface MasterSkuOption { id: string; name: string }

// ─── Tab 1: Sort Labels ───────────────────────────────────────────────

type SortState = 'idle' | 'parsing' | 'resolving' | 'ready' | 'ingesting'

function SortLabelsTab({ profiles, onNeedProfile }: {
  profiles: CropProfile[]
  onNeedProfile: () => void
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [masterSkus, setMasterSkus] = useState<MasterSkuOption[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('')
  const [selectedProfileName, setSelectedProfileName] = useState<string>(profiles[0]?.name ?? '')
  const [state, setState] = useState<SortState>('idle')
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [resolvedLabels, setResolvedLabels] = useState<ResolvedLabel[]>([])
  const [sortResult, setSortResult] = useState<LabelSortResult | null>(null)
  const [userRole] = useState<'owner' | 'admin' | 'manager' | 'staff' | 'member'>('owner')

  const activeProfile = profiles.find(p => p.name === selectedProfileName)

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

  useEffect(() => {
    if (profiles.length > 0 && !profiles.find(p => p.name === selectedProfileName)) {
      setSelectedProfileName(profiles[0].name)
    }
  }, [profiles, selectedProfileName])

  const handleFilesSelected = useCallback(async (files: File[]) => {
    if (!selectedWarehouse) { toast.error('Please select a warehouse first'); return }
    if (!activeProfile) { toast.error('Please create a crop profile first'); onNeedProfile(); return }

    setUploadedFiles(files)
    setState('parsing')

    try {
      const allLabels: ParsedLabel[] = []
      for (let fi = 0; fi < files.length; fi++) {
        const labels = await parseLabelPdf(files[fi], fi)
        allLabels.push(...labels)
      }

      if (allLabels.length === 0) { toast.error('No valid Flipkart labels found'); setState('idle'); return }

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
        isCombo: boolean; comboProductId: string | null; comboProductName: string | null
        components: Array<{ masterSkuId: string; masterSkuName: string; quantity: number }> | null
      }>()
      for (const r of resolvedMap) skuLookup.set(r.platformSku, r)

      const resolved: ResolvedLabel[] = allLabels.map(label => {
        const lookup = skuLookup.get(label.platformSku)
        return {
          ...label,
          masterSkuId: lookup?.masterSkuId ?? null,
          masterSkuName: lookup?.masterSkuName ?? null,
          marketplaceAccountId: lookup?.marketplaceAccountId ?? null,
          organizationId: lookup?.organizationId ?? null,
          isCombo: lookup?.isCombo ?? false,
          comboProductId: lookup?.comboProductId ?? null,
          comboProductName: lookup?.comboProductName ?? null,
          components: lookup?.components ?? null,
        }
      })

      setResolvedLabels(resolved)
      setSortResult(buildSortResult(resolved))
      setState('ready')
    } catch (e) { toast.error((e as Error).message); setState('idle') }
  }, [selectedWarehouse, activeProfile, onNeedProfile])

  const getLabelSize = (): LabelSize => {
    if (!activeProfile) return LABEL_SIZES[0]
    return LABEL_SIZES.find(s => s.name === activeProfile.labelSize) ?? LABEL_SIZES[0]
  }

  const getInvoiceSize = (): LabelSize => {
    if (!activeProfile?.invoiceSize) return INVOICE_SIZE
    return LABEL_SIZES.find(s => s.name === activeProfile.invoiceSize) ?? INVOICE_SIZE
  }

  async function handleDownloadGroup(group: LabelGroup) {
    if (!activeProfile) return
    try {
      const pdfs = await cropAndGroupLabels([group], uploadedFiles, activeProfile.crop, getLabelSize())
      for (const [fn, bytes] of pdfs) downloadPdf(bytes, `${fn}.pdf`)
    } catch { toast.error('Failed to generate PDF') }
  }

  async function handleDownloadInvoiceGroup(group: LabelGroup) {
    if (!activeProfile?.invoiceCrop) return
    try {
      const pdfs = await cropAndGroupInvoices([group], uploadedFiles, activeProfile.invoiceCrop, getInvoiceSize())
      for (const [fn, bytes] of pdfs) downloadPdf(bytes, `${fn}.pdf`)
    } catch { toast.error('Failed to generate invoice PDF') }
  }

  async function handleDownloadAll() {
    if (!sortResult || !activeProfile) return
    try {
      const pdfs = await cropAndGroupLabels(sortResult.groups, uploadedFiles, activeProfile.crop, getLabelSize())
      for (const [fn, bytes] of pdfs) downloadPdf(bytes, `${fn}.pdf`)
      toast.success(`Downloaded ${pdfs.size} label PDFs`)
    } catch { toast.error('Failed to generate PDFs') }
  }

  async function handleDownloadAllInvoices() {
    if (!sortResult || !activeProfile?.invoiceCrop) return
    try {
      const pdfs = await cropAndGroupInvoices(sortResult.groups, uploadedFiles, activeProfile.invoiceCrop, getInvoiceSize())
      for (const [fn, bytes] of pdfs) downloadPdf(bytes, `${fn}.pdf`)
      toast.success(`Downloaded ${pdfs.size} invoice PDFs`)
    } catch { toast.error('Failed to generate invoice PDFs') }
  }

  async function handleIngest() {
    if (!sortResult || !selectedWarehouse) return
    setState('ingesting')
    try {
      const today = new Date().toISOString().split('T')[0]

      // Build ingest labels: expand combos into one entry per component
      const ingestLabels: Array<{
        orderId: string; masterSkuId: string; marketplaceAccountId: string | null
        quantity: number; salePrice: number | null; paymentType: string
        platformSku: string; dispatchDate: string; courier: string; awbNumber: string
        isCombo?: boolean; components?: Array<{ masterSkuId: string; quantity: number }>
      }> = []

      for (const l of resolvedLabels) {
        if (l.isCombo && l.components?.length) {
          // Combo: send as combo for server to expand
          ingestLabels.push({
            orderId: l.orderId,
            masterSkuId: '', // not used for combos
            marketplaceAccountId: l.marketplaceAccountId,
            quantity: 1,
            salePrice: l.salePrice,
            paymentType: l.paymentType,
            platformSku: l.platformSku,
            dispatchDate: today,
            courier: l.courier,
            awbNumber: l.awbNumber,
            isCombo: true,
            components: l.components.map(c => ({ masterSkuId: c.masterSkuId, quantity: c.quantity })),
          })
        } else if (l.masterSkuId) {
          ingestLabels.push({
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
          })
        }
      }

      const res = await fetch('/api/labels/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId: selectedWarehouse,
          labels: ingestLabels,
        }),
      })

      if (!res.ok) throw new Error('Failed to save order data')
      const { created, skipped } = await res.json()
      toast.success(`Saved ${created} orders (${skipped} already existed)`)
    } catch (e) { toast.error((e as Error).message) }
    finally { setState('ready') }
  }

  function handleSkuMapped(platformSku: string, result: import('@/components/labels/UnmappedSkuPanel').MappingResult) {
    const updated = resolvedLabels.map(l => {
      if (l.platformSku !== platformSku) return l
      if (result.type === 'simple') {
        return { ...l, masterSkuId: result.masterSkuId, masterSkuName: result.masterSkuName, isCombo: false, comboProductId: null, comboProductName: null, components: null }
      }
      // Combo mapping
      return { ...l, masterSkuId: null, masterSkuName: null, isCombo: true, comboProductId: result.comboProductId, comboProductName: result.comboProductName, components: result.components }
    })
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
    <div className="space-y-6">
      <div className="flex items-end gap-4 flex-wrap">
        <div>
          <label className="text-xs font-medium mb-1 block text-muted-foreground">
            Warehouse <InfoTooltip content="Select the warehouse these labels are being dispatched from." />
          </label>
          <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse} disabled={state !== 'idle'}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select warehouse..." /></SelectTrigger>
            <SelectContent>
              {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs font-medium mb-1 block text-muted-foreground">
            Crop Profile <InfoTooltip content="Select a saved crop profile. Manage profiles in the Crop Profiles tab." />
          </label>
          {profiles.length > 0 ? (
            <Select value={selectedProfileName} onValueChange={setSelectedProfileName} disabled={state !== 'idle'}>
              <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {profiles.map(p => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name} ({p.labelSize}){p.includeInvoice ? ' + Invoice' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Button variant="outline" size="sm" className="h-9" onClick={onNeedProfile}>Create Crop Profile</Button>
          )}
        </div>
      </div>

      {state === 'idle' && (
        <LabelUploadZone onFilesSelected={handleFilesSelected} disabled={!selectedWarehouse || !activeProfile} />
      )}

      {state === 'idle' && (!selectedWarehouse || !activeProfile) && (
        <div className="text-center py-4 text-muted-foreground text-sm">
          {!selectedWarehouse && !activeProfile ? 'Select a warehouse and crop profile to get started.'
            : !selectedWarehouse ? 'Select a warehouse above.'
            : 'Create a crop profile in the "Crop Profiles" tab first.'}
        </div>
      )}

      {state === 'parsing' && <div className="text-center py-8 text-muted-foreground">Parsing label PDFs...</div>}
      {state === 'resolving' && <div className="text-center py-8 text-muted-foreground">Matching SKUs to master catalog...</div>}

      {(state === 'ready' || state === 'ingesting') && sortResult && (
        <div className="space-y-6">
          <UnmappedSkuPanel unmapped={sortResult.unmapped} masterSkus={masterSkus} userRole={userRole} onMapped={handleSkuMapped} />

          {sortResult.groups.length > 0 ? (
            <LabelPreviewTable
              result={sortResult}
              hasInvoice={activeProfile?.includeInvoice && !!activeProfile?.invoiceCrop}
              onDownloadGroup={handleDownloadGroup}
              onDownloadInvoiceGroup={handleDownloadInvoiceGroup}
              onDownloadAll={handleDownloadAll}
              onDownloadAllInvoices={handleDownloadAllInvoices}
            />
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
    </div>
  )
}

// ─── Tab 2: Crop Profiles ─────────────────────────────────────────────

function CropProfilesTab({ profiles, onProfilesChanged }: {
  profiles: CropProfile[]
  onProfilesChanged: (profiles: CropProfile[]) => void
}) {
  const [creatorStep, setCreatorStep] = useState<'closed' | 'upload' | 'crop'>('closed')
  const [sampleFile, setSampleFile] = useState<File | null>(null)
  const [editingProfile, setEditingProfile] = useState<CropProfile | null>(null)
  const [creatorKey, setCreatorKey] = useState(0)
  const [renamingProfile, setRenamingProfile] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  async function handleDeleteProfile(name: string) {
    const profile = profiles.find(p => p.name === name)
    if (profile?.id) {
      const ok = await deleteProfile(profile.id)
      if (!ok) { toast.error('Failed to delete profile'); return }
    }
    const updated = profiles.filter(p => p.name !== name)
    onProfilesChanged(updated)
    toast.success(`Deleted profile "${name}"`)
  }

  function handleEditProfile(profile: CropProfile) {
    setEditingProfile(profile)
    setSampleFile(null)
    setCreatorStep('upload')
    setCreatorKey(k => k + 1)
  }

  function handleFileSelected(files: File[]) {
    setSampleFile(files[0])
    setCreatorStep('crop')
  }

  function handleCropConfirmed() {
    setSampleFile(null)
    setCreatorStep('closed')
    setEditingProfile(null)
  }

  function handleCreatorCancel() {
    setSampleFile(null)
    setCreatorStep('closed')
    setEditingProfile(null)
  }

  function handleStartCreate() {
    setEditingProfile(null)
    setSampleFile(null)
    setCreatorStep('upload')
    setCreatorKey(k => k + 1)
  }

  function handleStartRename(name: string) {
    setRenamingProfile(name)
    setRenameValue(name)
  }

  async function handleConfirmRename(oldName: string) {
    const newName = renameValue.trim()
    if (!newName || newName === oldName) { setRenamingProfile(null); return }
    if (profiles.some(p => p.name === newName)) { toast.error(`Profile "${newName}" already exists`); return }
    const profile = profiles.find(p => p.name === oldName)
    if (profile?.id) {
      const result = await updateProfile(profile.id, { name: newName })
      if (!result) { toast.error('Failed to rename profile'); return }
    }
    const updated = profiles.map(p => p.name === oldName ? { ...p, name: newName } : p)
    onProfilesChanged(updated)
    setRenamingProfile(null)
    toast.success(`Renamed to "${newName}"`)
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Crop profiles define how to extract the shipping label (and optionally invoice) from each PDF page.
        <InfoTooltip content="Each platform may have a different label layout. Create one profile per layout (e.g., 'Flipkart', 'Amazon'). Enable 'Include Invoice' for platforms that require separate invoice printing." />
      </p>

      {profiles.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Profile Name</th>
                <th className="text-left px-4 py-2 font-medium">Label Size</th>
                <th className="text-left px-4 py-2 font-medium">Invoice</th>
                <th className="text-left px-4 py-2 font-medium">Crop Area</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => (
                <tr key={p.name} className="border-t">
                  <td className="px-4 py-2 font-medium">
                    {renamingProfile === p.name ? (
                      <input
                        className="border rounded px-2 py-0.5 text-sm w-full max-w-[200px]"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleConfirmRename(p.name); if (e.key === 'Escape') setRenamingProfile(null) }}
                        onBlur={() => handleConfirmRename(p.name)}
                        autoFocus
                      />
                    ) : (
                      <span className="cursor-pointer hover:underline" onClick={() => handleStartRename(p.name)}>{p.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{p.labelSize}</td>
                  <td className="px-4 py-2 text-muted-foreground">{p.includeInvoice ? `Yes (${p.invoiceSize ?? 'A4'})` : 'No'}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {(p.crop.width * 100).toFixed(0)}% x {(p.crop.height * 100).toFixed(0)}%
                  </td>
                  <td className="px-4 py-2 text-right space-x-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEditProfile(p)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteProfile(p.name)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {profiles.length === 0 && creatorStep === 'closed' && (
        <div className="text-center py-8 border rounded-lg bg-muted/30">
          <p className="text-muted-foreground mb-3">No crop profiles yet. Create one to start sorting labels.</p>
          <Button onClick={handleStartCreate}>Create First Profile</Button>
        </div>
      )}

      {creatorStep === 'closed' && profiles.length > 0 && (
        <Button variant="outline" onClick={handleStartCreate}>Create New Profile</Button>
      )}

      {creatorStep === 'upload' && (
        <div className="space-y-3">
          <h3 className="font-medium">{editingProfile ? `Edit Profile: ${editingProfile.name}` : 'Upload a sample PDF'}</h3>
          <p className="text-sm text-muted-foreground">Upload any label PDF to use as a reference for drawing the crop area.</p>
          <LabelUploadZone key={creatorKey} onFilesSelected={handleFileSelected} disabled={false} />
          <Button variant="ghost" onClick={handleCreatorCancel}>Cancel</Button>
        </div>
      )}

      {creatorStep === 'crop' && sampleFile && (
        <LabelCropSelector
          key={creatorKey}
          file={sampleFile}
          profiles={profiles}
          mode="save"
          editProfile={editingProfile ?? undefined}
          onCropConfirmed={handleCropConfirmed}
          onCancel={handleCreatorCancel}
          onProfilesChanged={onProfilesChanged}
        />
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────

export default function LabelsPage() {
  const [profiles, setProfiles] = useState<CropProfile[]>([])
  const [activeTab, setActiveTab] = useState('sort')

  useEffect(() => { fetchProfiles().then(setProfiles) }, [])

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Label Sorting</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload label PDFs to sort by product for dispatch. Labels are cropped and grouped automatically.
          <InfoTooltip content="Upload the label PDFs you download from your marketplace. The system parses each label, matches it to your master catalog, and outputs sorted PDFs — one per product — ready for your label printer." />
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="sort">Sort Labels</TabsTrigger>
          <TabsTrigger value="profiles">
            Crop Profiles {profiles.length > 0 && <span className="ml-1 text-xs text-muted-foreground">({profiles.length})</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sort">
          <SortLabelsTab profiles={profiles} onNeedProfile={() => setActiveTab('profiles')} />
        </TabsContent>

        <TabsContent value="profiles">
          <CropProfilesTab profiles={profiles} onProfilesChanged={setProfiles} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

function buildSortResult(labels: ResolvedLabel[]): LabelSortResult {
  const groups = groupLabelsByProduct(labels)
  const unmappedMap = new Map<string, UnmappedSku>()
  for (const label of labels) {
    // Combo labels are resolved (not unmapped), even though masterSkuId is null
    if (!label.masterSkuId && !label.isCombo) {
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
