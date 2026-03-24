'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { Trash2 } from 'lucide-react'

export interface LabelSize {
  name: string
  widthIn: number
  heightIn: number
  widthPt: number
  heightPt: number
  aspect: number
  custom?: boolean
}

export const LABEL_SIZES: LabelSize[] = [
  { name: '4 x 6 in', widthIn: 4, heightIn: 6, widthPt: 288, heightPt: 432, aspect: 4 / 6 },
  { name: '4 x 4 in', widthIn: 4, heightIn: 4, widthPt: 288, heightPt: 288, aspect: 1 },
  { name: '3 x 5 in', widthIn: 3, heightIn: 5, widthPt: 216, heightPt: 360, aspect: 3 / 5 },
  { name: '2 x 1 in', widthIn: 2, heightIn: 1, widthPt: 144, heightPt: 72, aspect: 2 / 1 },
  { name: 'A4', widthIn: 8.27, heightIn: 11.69, widthPt: 595, heightPt: 842, aspect: 595 / 842 },
]

export const INVOICE_SIZE: LabelSize = LABEL_SIZES.find(s => s.name === 'A4')!

export interface CropBox {
  x: number
  y: number
  width: number
  height: number
}

export interface CropProfile {
  name: string
  labelSize: string
  crop: CropBox
  includeInvoice?: boolean
  invoiceCrop?: CropBox
  invoiceSize?: string
}

const PROFILES_STORAGE_KEY = 'fk-label-crop-profiles'

export function loadProfiles(): CropProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch { return [] }
}

export function saveProfiles(profiles: CropProfile[]) {
  try { localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles)) } catch { /* ignore */ }
}

interface LabelCropSelectorProps {
  file: File
  profiles: CropProfile[]
  mode?: 'save' | 'sort'
  /** Pre-populate for editing an existing profile */
  editProfile?: CropProfile
  onCropConfirmed: (crop: CropBox, labelSize: LabelSize, profileName: string, invoiceOpts?: { includeInvoice: boolean; invoiceCrop?: CropBox; invoiceSize?: string }) => void
  onCancel: () => void
  onProfilesChanged: (profiles: CropProfile[]) => void
}

const CANVAS_MAX_WIDTH = 500
const CANVAS_MAX_HEIGHT = 700

export function LabelCropSelector({ file, profiles, mode = 'save', editProfile, onCropConfirmed, onCancel, onProfilesChanged }: LabelCropSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [pdfPageAspect, setPdfPageAspect] = useState(1)
  const [drawing, setDrawing] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [pageLoaded, setPageLoaded] = useState(false)

  // Step: 'label' = drawing label crop, 'invoice' = drawing invoice crop
  const [step, setStep] = useState<'label' | 'invoice'>('label')
  const [cropBox, setCropBox] = useState<CropBox | null>(editProfile?.crop ?? null)
  const [invoiceCrop, setInvoiceCrop] = useState<CropBox | null>(editProfile?.invoiceCrop ?? null)
  const [includeInvoice, setIncludeInvoice] = useState(editProfile?.includeInvoice ?? false)

  const [selectedLabelSize, setSelectedLabelSize] = useState<string>(editProfile?.labelSize ?? LABEL_SIZES[0].name)
  const [selectedInvoiceSize, setSelectedInvoiceSize] = useState<string>(editProfile?.invoiceSize ?? 'A4')
  const [selectedProfile, setSelectedProfile] = useState<string>(editProfile?.name ?? '')
  const [newProfileName, setNewProfileName] = useState(editProfile?.name ?? '')
  const [showSaveInput, setShowSaveInput] = useState(false)

  // Custom size inputs
  const [showCustomSize, setShowCustomSize] = useState(false)
  const [customW, setCustomW] = useState('')
  const [customH, setCustomH] = useState('')

  const labelSize = selectedLabelSize === 'Custom'
    ? { name: 'Custom', widthIn: parseFloat(customW) || 4, heightIn: parseFloat(customH) || 6, widthPt: (parseFloat(customW) || 4) * 72, heightPt: (parseFloat(customH) || 6) * 72, aspect: (parseFloat(customW) || 4) / (parseFloat(customH) || 6) } as LabelSize
    : LABEL_SIZES.find(s => s.name === selectedLabelSize) ?? LABEL_SIZES[0]

  const invoiceSize = LABEL_SIZES.find(s => s.name === selectedInvoiceSize) ?? INVOICE_SIZE

  const activeCrop = step === 'label' ? cropBox : invoiceCrop
  const activeSize = step === 'label' ? labelSize : invoiceSize

  // Load profile into crop box when selected from dropdown
  useEffect(() => {
    if (!selectedProfile || editProfile) return
    const profile = profiles.find(p => p.name === selectedProfile)
    if (profile) {
      setCropBox(profile.crop)
      setSelectedLabelSize(profile.labelSize)
      setIncludeInvoice(profile.includeInvoice ?? false)
      setInvoiceCrop(profile.invoiceCrop ?? null)
      setSelectedInvoiceSize(profile.invoiceSize ?? 'A4')
    }
  }, [selectedProfile, profiles, editProfile])

  // Render PDF page
  useEffect(() => {
    let cancelled = false
    async function renderPage() {
      const pdfjsLib = await import('pdfjs-dist')
      if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      }
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const page = await pdf.getPage(1)

      const unscaledViewport = page.getViewport({ scale: 1.0 })
      const scaleX = CANVAS_MAX_WIDTH / unscaledViewport.width
      const scaleY = CANVAS_MAX_HEIGHT / unscaledViewport.height
      const scale = Math.min(scaleX, scaleY)
      const viewport = page.getViewport({ scale })

      if (cancelled) return
      const canvas = canvasRef.current
      const overlay = overlayRef.current
      if (!canvas || !overlay) return

      canvas.width = viewport.width
      canvas.height = viewport.height
      overlay.width = viewport.width
      overlay.height = viewport.height
      setCanvasSize({ width: viewport.width, height: viewport.height })
      setPdfPageAspect(unscaledViewport.width / unscaledViewport.height)

      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof page.render>[0]).promise

      if (cancelled) return
      setPageLoaded(true)
    }
    renderPage()
    return () => { cancelled = true }
  }, [file])

  // Draw overlay
  const drawOverlay = useCallback((w: number, h: number) => {
    const overlay = overlayRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')!
    ctx.clearRect(0, 0, w, h)

    // Dim background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
    ctx.fillRect(0, 0, w, h)

    // Draw label crop (orange)
    if (cropBox) {
      const cx = cropBox.x * w, cy = cropBox.y * h, cw = cropBox.width * w, ch = cropBox.height * h
      ctx.clearRect(cx, cy, cw, ch)
      ctx.strokeStyle = step === 'label' ? '#f97316' : '#f9731680'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.strokeRect(cx, cy, cw, ch)
      ctx.setLineDash([])
      ctx.fillStyle = step === 'label' ? '#f97316' : '#f9731680'
      ctx.font = '11px sans-serif'
      ctx.fillText(`Label (${labelSize.widthIn}" x ${labelSize.heightIn}")`, cx + 4, cy - 6)
    }

    // Draw invoice crop (blue)
    if (invoiceCrop && includeInvoice) {
      const cx = invoiceCrop.x * w, cy = invoiceCrop.y * h, cw = invoiceCrop.width * w, ch = invoiceCrop.height * h
      // Re-dim then clear invoice area (may overlap with label clear)
      if (!cropBox) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
        ctx.fillRect(cx, cy, cw, ch)
      }
      ctx.clearRect(cx, cy, cw, ch)
      ctx.strokeStyle = step === 'invoice' ? '#3b82f6' : '#3b82f680'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.strokeRect(cx, cy, cw, ch)
      ctx.setLineDash([])
      ctx.fillStyle = step === 'invoice' ? '#3b82f6' : '#3b82f680'
      ctx.font = '11px sans-serif'
      ctx.fillText(`Invoice (${invoiceSize.name})`, cx + 4, cy - 6)
    }
  }, [cropBox, invoiceCrop, includeInvoice, step, labelSize, invoiceSize])

  useEffect(() => {
    if (canvasSize.width === 0) return
    drawOverlay(canvasSize.width, canvasSize.height)
  }, [cropBox, invoiceCrop, includeInvoice, step, canvasSize, drawOverlay])

  const getRelativePos = (e: React.MouseEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / canvasSize.width, y: (e.clientY - rect.top) / canvasSize.height }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    setStartPos(getRelativePos(e))
    setDrawing(true)
    if (step === 'label') setCropBox(null)
    else setInvoiceCrop(null)
    if (!editProfile) setSelectedProfile('')
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return
    const pos = getRelativePos(e)
    const targetAspect = activeSize.aspect / pdfPageAspect

    let rawW = Math.abs(pos.x - startPos.x)
    let rawH = Math.abs(pos.y - startPos.y)
    if (rawW / targetAspect > rawH) rawH = rawW / targetAspect
    else rawW = rawH * targetAspect

    const left = pos.x < startPos.x ? Math.max(0, startPos.x - rawW) : startPos.x
    const top = pos.y < startPos.y ? Math.max(0, startPos.y - rawH) : startPos.y
    rawW = Math.min(rawW, 1 - left)
    rawH = Math.min(rawH, 1 - top)

    const box = { x: left, y: top, width: rawW, height: rawH }
    if (step === 'label') setCropBox(box)
    else setInvoiceCrop(box)
  }

  const handleMouseUp = () => setDrawing(false)

  function handleSaveProfile() {
    if (!newProfileName.trim() || !cropBox) return
    const name = newProfileName.trim()
    const existing = profiles.filter(p => p.name !== name)
    const profile: CropProfile = {
      name,
      labelSize: selectedLabelSize === 'Custom' ? `${customW} x ${customH} in` : selectedLabelSize,
      crop: cropBox,
      includeInvoice,
      invoiceCrop: includeInvoice ? invoiceCrop ?? undefined : undefined,
      invoiceSize: includeInvoice ? selectedInvoiceSize : undefined,
    }
    const updated = [...existing, profile]
    onProfilesChanged(updated)
    saveProfiles(updated)
    setSelectedProfile(name)
    setNewProfileName('')
    setShowSaveInput(false)
    // Signal done
    onCropConfirmed(cropBox, labelSize, name, { includeInvoice, invoiceCrop: invoiceCrop ?? undefined, invoiceSize: selectedInvoiceSize })
  }

  function handleDeleteProfile(name: string) {
    const updated = profiles.filter(p => p.name !== name)
    onProfilesChanged(updated)
    saveProfiles(updated)
    if (selectedProfile === name) setSelectedProfile('')
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        {step === 'label'
          ? <>Select label size, then draw a rectangle around the <strong>shipping label</strong> area.</>
          : <>Now draw a rectangle around the <strong>invoice</strong> area.</>
        }
      </div>

      {/* Controls row */}
      <div className="flex items-end gap-4 flex-wrap">
        {/* Label size */}
        <div>
          <label className="text-xs font-medium mb-1 block text-muted-foreground">Label Size</label>
          <Select value={showCustomSize ? 'Custom' : selectedLabelSize} onValueChange={v => {
            if (v === 'Custom') { setShowCustomSize(true); setSelectedLabelSize('Custom') }
            else { setShowCustomSize(false); setSelectedLabelSize(v); setCropBox(null); setSelectedProfile('') }
          }}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LABEL_SIZES.filter(s => s.name !== 'A4').map(s => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}
              <SelectItem value="Custom">Custom...</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {showCustomSize && (
          <div className="flex items-center gap-1">
            <Input className="w-16 h-9" placeholder="W" value={customW} onChange={e => setCustomW(e.target.value)} />
            <span className="text-xs text-muted-foreground">x</span>
            <Input className="w-16 h-9" placeholder="H" value={customH} onChange={e => setCustomH(e.target.value)} />
            <span className="text-xs text-muted-foreground">in</span>
          </div>
        )}

        {/* Include invoice toggle */}
        <div className="flex items-center gap-2 self-end pb-1.5">
          <Checkbox
            id="include-invoice"
            checked={includeInvoice}
            onCheckedChange={c => { setIncludeInvoice(!!c); if (!c) { setStep('label'); setInvoiceCrop(null) } }}
          />
          <label htmlFor="include-invoice" className="text-xs font-medium text-muted-foreground cursor-pointer">
            Include Invoice
            <InfoTooltip content="Enable if this platform requires separate invoice printing (e.g., Amazon). You'll draw a second crop area for the invoice section." />
          </label>
        </div>

        {/* Saved profiles dropdown (not in edit mode) */}
        {!editProfile && profiles.length > 0 && (
          <div>
            <label className="text-xs font-medium mb-1 block text-muted-foreground">Load Profile</label>
            <div className="flex items-center gap-2">
              <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {profiles.map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedProfile && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDeleteProfile(selectedProfile)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Step indicator for invoice — always visible when invoice enabled */}
      {includeInvoice && (
        <div className="flex gap-2">
          <Button variant={step === 'label' ? 'default' : 'outline'} size="sm" onClick={() => setStep('label')}>
            1. Label Crop {cropBox ? '(done)' : ''}
          </Button>
          <Button variant={step === 'invoice' ? 'default' : 'outline'} size="sm" onClick={() => setStep('invoice')}>
            2. Invoice Crop {invoiceCrop ? '(done)' : ''}
          </Button>
        </div>
      )}

      {/* Canvas */}
      <div className="relative inline-block border rounded-lg overflow-hidden bg-white cursor-crosshair">
        <canvas ref={canvasRef} className="block" />
        <canvas
          ref={overlayRef}
          className="absolute top-0 left-0 block"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { if (drawing) setDrawing(false) }}
        />
        {!pageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/80">
            <span className="text-sm text-muted-foreground">Loading preview...</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 flex-wrap">
        {mode === 'save' ? (
          <>
            <Input
              className="w-[200px] h-9"
              placeholder="Profile name (e.g. Flipkart)"
              value={newProfileName}
              onChange={e => setNewProfileName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveProfile()}
            />
            <Button
              onClick={handleSaveProfile}
              disabled={!cropBox || !newProfileName.trim() || (includeInvoice && !invoiceCrop)}
            >
              {editProfile ? 'Update Profile' : 'Save Profile'}
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => cropBox && onCropConfirmed(cropBox, labelSize, selectedProfile, { includeInvoice, invoiceCrop: invoiceCrop ?? undefined, invoiceSize: selectedInvoiceSize })}
              disabled={!cropBox || (includeInvoice && !invoiceCrop)}
            >
              Apply Crop & Sort Labels
            </Button>
            {cropBox && !showSaveInput && (
              <Button variant="outline" size="sm" onClick={() => setShowSaveInput(true)}>Save as Profile</Button>
            )}
            {showSaveInput && (
              <div className="flex items-center gap-2">
                <Input className="w-[180px] h-8" placeholder="Profile name" value={newProfileName}
                  onChange={e => setNewProfileName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSaveProfile()} autoFocus />
                <Button size="sm" onClick={handleSaveProfile} disabled={!newProfileName.trim()}>Save</Button>
                <Button variant="ghost" size="sm" onClick={() => setShowSaveInput(false)}>Cancel</Button>
              </div>
            )}
          </>
        )}

        <Button variant="ghost" onClick={onCancel}>Cancel</Button>

        {activeCrop && (
          <span className="text-xs text-muted-foreground">
            {activeSize.widthIn}" x {activeSize.heightIn}" — {(activeCrop.width * 100).toFixed(0)}% x {(activeCrop.height * 100).toFixed(0)}% of page
          </span>
        )}
      </div>
    </div>
  )
}
