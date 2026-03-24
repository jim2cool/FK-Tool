'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Trash2 } from 'lucide-react'

export interface LabelSize {
  name: string
  /** Width in inches */
  widthIn: number
  /** Height in inches */
  heightIn: number
  /** Width in PDF points (1 inch = 72pt) */
  widthPt: number
  /** Height in PDF points */
  heightPt: number
  /** Aspect ratio (width / height) */
  aspect: number
}

export const LABEL_SIZES: LabelSize[] = [
  { name: '4 x 6 in', widthIn: 4, heightIn: 6, widthPt: 288, heightPt: 432, aspect: 4 / 6 },
  { name: '4 x 4 in', widthIn: 4, heightIn: 4, widthPt: 288, heightPt: 288, aspect: 1 },
  { name: '3 x 5 in', widthIn: 3, heightIn: 5, widthPt: 216, heightPt: 360, aspect: 3 / 5 },
  { name: '2 x 1 in', widthIn: 2, heightIn: 1, widthPt: 144, heightPt: 72, aspect: 2 / 1 },
]

export interface CropBox {
  /** All values are ratios (0-1) relative to the page dimensions */
  x: number
  y: number
  width: number
  height: number
}

export interface CropProfile {
  name: string
  labelSize: string
  crop: CropBox
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
  /** 'save' = profile creation (Crop Profiles tab), 'sort' = direct sorting (Sort tab fallback) */
  mode?: 'save' | 'sort'
  onCropConfirmed: (crop: CropBox, labelSize: LabelSize, profileName: string) => void
  onCancel: () => void
  onProfilesChanged: (profiles: CropProfile[]) => void
}

const CANVAS_MAX_WIDTH = 500
const CANVAS_MAX_HEIGHT = 700

export function LabelCropSelector({ file, profiles, mode = 'save', onCropConfirmed, onCancel, onProfilesChanged }: LabelCropSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [pdfPageAspect, setPdfPageAspect] = useState(1) // actual PDF page w/h ratio
  const [drawing, setDrawing] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [cropBox, setCropBox] = useState<CropBox | null>(null)
  const [pageLoaded, setPageLoaded] = useState(false)

  const [selectedLabelSize, setSelectedLabelSize] = useState<string>(LABEL_SIZES[0].name)
  const [selectedProfile, setSelectedProfile] = useState<string>('')
  const [newProfileName, setNewProfileName] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)

  const labelSize = LABEL_SIZES.find(s => s.name === selectedLabelSize) ?? LABEL_SIZES[0]

  // Load profile into crop box when selected
  useEffect(() => {
    if (!selectedProfile) return
    const profile = profiles.find(p => p.name === selectedProfile)
    if (profile) {
      setCropBox(profile.crop)
      setSelectedLabelSize(profile.labelSize)
    }
  }, [selectedProfile, profiles])

  // Render the first page of the PDF onto the canvas
  useEffect(() => {
    let cancelled = false
    async function renderPage() {
      const pdfjsLib = await import('pdfjs-dist')
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

  // Draw the crop overlay
  const drawCropOverlay = useCallback((
    overlay: HTMLCanvasElement,
    crop: CropBox,
    w: number,
    h: number,
  ) => {
    const ctx = overlay.getContext('2d')!
    ctx.clearRect(0, 0, w, h)

    // Dim everything outside the crop
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillRect(0, 0, w, h)

    // Clear the crop area
    const cx = crop.x * w
    const cy = crop.y * h
    const cw = crop.width * w
    const ch = crop.height * h
    ctx.clearRect(cx, cy, cw, ch)

    // Border
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 3])
    ctx.strokeRect(cx, cy, cw, ch)

    // Corner handles
    ctx.setLineDash([])
    ctx.fillStyle = '#f97316'
    const hs = 8
    for (const [hx, hy] of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs)
    }

    // Dimensions label
    ctx.fillStyle = '#f97316'
    ctx.font = '11px sans-serif'
    ctx.fillText(`${labelSize.widthIn}" x ${labelSize.heightIn}"`, cx + 4, cy - 6)
  }, [labelSize])

  // Redraw overlay when cropBox changes
  useEffect(() => {
    if (!cropBox || !overlayRef.current || canvasSize.width === 0) return
    drawCropOverlay(overlayRef.current, cropBox, canvasSize.width, canvasSize.height)
  }, [cropBox, canvasSize, drawCropOverlay])

  const getRelativePos = (e: React.MouseEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / canvasSize.width,
      y: (e.clientY - rect.top) / canvasSize.height,
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getRelativePos(e)
    setStartPos(pos)
    setDrawing(true)
    setCropBox(null)
    setSelectedProfile('')

    const overlay = overlayRef.current
    if (overlay) {
      const ctx = overlay.getContext('2d')!
      ctx.clearRect(0, 0, canvasSize.width, canvasSize.height)
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return
    const pos = getRelativePos(e)

    // Lock to label aspect ratio
    // aspect = width/height in label units, but we need to convert to page-ratio space
    // In page-ratio space, 1 unit of x = pageWidth, 1 unit of y = pageHeight
    // So aspect in ratio-space = (label_w/label_h) * (pageHeight/pageWidth)
    const targetAspect = labelSize.aspect / pdfPageAspect

    let rawW = Math.abs(pos.x - startPos.x)
    let rawH = Math.abs(pos.y - startPos.y)

    // Determine which dimension the user is dragging more
    if (rawW / targetAspect > rawH) {
      rawH = rawW / targetAspect
    } else {
      rawW = rawH * targetAspect
    }

    // Clamp to page bounds
    const left = pos.x < startPos.x ? Math.max(0, startPos.x - rawW) : startPos.x
    const top = pos.y < startPos.y ? Math.max(0, startPos.y - rawH) : startPos.y
    rawW = Math.min(rawW, 1 - left)
    rawH = Math.min(rawH, 1 - top)

    setCropBox({ x: left, y: top, width: rawW, height: rawH })
  }

  const handleMouseUp = () => {
    setDrawing(false)
  }

  function handleSaveProfile() {
    if (!newProfileName.trim() || !cropBox) return
    const name = newProfileName.trim()
    const existing = profiles.filter(p => p.name !== name)
    const updated = [...existing, { name, labelSize: selectedLabelSize, crop: cropBox }]
    onProfilesChanged(updated)
    saveProfiles(updated)
    setSelectedProfile(name)
    setNewProfileName('')
    setShowSaveInput(false)
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
        Select label size, then draw a rectangle around the <strong>shipping label</strong> area.
        The box locks to the label aspect ratio. This crop applies to all pages.
      </div>

      {/* Controls row */}
      <div className="flex items-end gap-4 flex-wrap">
        {/* Label size */}
        <div>
          <label className="text-xs font-medium mb-1 block text-muted-foreground">Label Size</label>
          <Select value={selectedLabelSize} onValueChange={v => { setSelectedLabelSize(v); setCropBox(null); setSelectedProfile('') }}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LABEL_SIZES.map(s => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Saved profiles */}
        <div>
          <label className="text-xs font-medium mb-1 block text-muted-foreground">Saved Profiles</label>
          <div className="flex items-center gap-2">
            <Select value={selectedProfile} onValueChange={setSelectedProfile}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select profile..." /></SelectTrigger>
              <SelectContent>
                {profiles.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No saved profiles</div>
                )}
                {profiles.map(p => (
                  <div key={p.name} className="flex items-center justify-between">
                    <SelectItem value={p.name}>{p.name} ({p.labelSize})</SelectItem>
                  </div>
                ))}
              </SelectContent>
            </Select>
            {selectedProfile && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDeleteProfile(selectedProfile)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            )}
          </div>
        </div>
      </div>

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
          /* Profile creation mode — always show name input + save */
          <>
            <Input
              className="w-[200px] h-9"
              placeholder="Profile name (e.g. Flipkart)"
              value={newProfileName}
              onChange={e => setNewProfileName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveProfile()}
            />
            <Button onClick={handleSaveProfile} disabled={!cropBox || !newProfileName.trim()}>
              Save Profile
            </Button>
          </>
        ) : (
          /* Sort mode — apply crop directly */
          <>
            <Button
              onClick={() => cropBox && onCropConfirmed(cropBox, labelSize, selectedProfile)}
              disabled={!cropBox}
            >
              Apply Crop & Sort Labels
            </Button>
            {cropBox && !showSaveInput && (
              <Button variant="outline" size="sm" onClick={() => setShowSaveInput(true)}>
                Save as Profile
              </Button>
            )}
            {showSaveInput && (
              <div className="flex items-center gap-2">
                <Input
                  className="w-[180px] h-8"
                  placeholder="Profile name (e.g. Flipkart)"
                  value={newProfileName}
                  onChange={e => setNewProfileName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveProfile()}
                  autoFocus
                />
                <Button size="sm" onClick={handleSaveProfile} disabled={!newProfileName.trim()}>Save</Button>
                <Button variant="ghost" size="sm" onClick={() => setShowSaveInput(false)}>Cancel</Button>
              </div>
            )}
          </>
        )}

        <Button variant="ghost" onClick={onCancel}>Cancel</Button>

        {cropBox && (
          <span className="text-xs text-muted-foreground">
            {labelSize.widthIn}" x {labelSize.heightIn}" — {(cropBox.width * 100).toFixed(0)}% x {(cropBox.height * 100).toFixed(0)}% of page
          </span>
        )}
      </div>
    </div>
  )
}
