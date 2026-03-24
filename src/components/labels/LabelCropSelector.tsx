'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'

export interface CropBox {
  /** All values are ratios (0-1) relative to the page dimensions */
  x: number
  y: number
  width: number
  height: number
}

interface LabelCropSelectorProps {
  file: File
  savedCrop: CropBox | null
  onCropConfirmed: (crop: CropBox) => void
  onCancel: () => void
}

const CANVAS_MAX_WIDTH = 500
const CANVAS_MAX_HEIGHT = 700

export function LabelCropSelector({ file, savedCrop, onCropConfirmed, onCancel }: LabelCropSelectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [drawing, setDrawing] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [cropBox, setCropBox] = useState<CropBox | null>(savedCrop)
  const [pageLoaded, setPageLoaded] = useState(false)

  // Render the first page of the PDF onto the canvas
  useEffect(() => {
    let cancelled = false
    async function renderPage() {
      const pdfjsLib = await import('pdfjs-dist')
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const page = await pdf.getPage(1)

      // Scale to fit within max dimensions
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

      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof page.render>[0]).promise

      if (cancelled) return
      setPageLoaded(true)

      // If we have a saved crop, draw it immediately
      if (savedCrop) {
        drawCropOverlay(overlay, savedCrop, viewport.width, viewport.height)
      }
    }
    renderPage()
    return () => { cancelled = true }
  }, [file, savedCrop])

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

    // Clear the crop area (make it bright)
    const cx = crop.x * w
    const cy = crop.y * h
    const cw = crop.width * w
    const ch = crop.height * h
    ctx.clearRect(cx, cy, cw, ch)

    // Draw border around crop area
    ctx.strokeStyle = '#f97316' // orange
    ctx.lineWidth = 2
    ctx.setLineDash([6, 3])
    ctx.strokeRect(cx, cy, cw, ch)

    // Corner handles
    ctx.setLineDash([])
    ctx.fillStyle = '#f97316'
    const handleSize = 8
    for (const [hx, hy] of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) {
      ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize)
    }
  }, [])

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

    // Clear overlay
    const overlay = overlayRef.current
    if (overlay) {
      const ctx = overlay.getContext('2d')!
      ctx.clearRect(0, 0, canvasSize.width, canvasSize.height)
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return
    const pos = getRelativePos(e)
    const box: CropBox = {
      x: Math.min(startPos.x, pos.x),
      y: Math.min(startPos.y, pos.y),
      width: Math.abs(pos.x - startPos.x),
      height: Math.abs(pos.y - startPos.y),
    }
    setCropBox(box)
  }

  const handleMouseUp = () => {
    setDrawing(false)
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        Draw a rectangle around the <strong>shipping label</strong> area on the first page.
        This crop will be applied to all pages.
        {savedCrop && (
          <span className="ml-2 text-orange-600 font-medium">
            Using saved crop area — drag to redraw if needed.
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className="relative inline-block border rounded-lg overflow-hidden bg-white cursor-crosshair"
      >
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

      <div className="flex items-center gap-3">
        <Button
          onClick={() => cropBox && onCropConfirmed(cropBox)}
          disabled={!cropBox}
        >
          Apply Crop & Sort Labels
        </Button>
        {savedCrop && (
          <Button
            variant="outline"
            onClick={() => onCropConfirmed(savedCrop)}
          >
            Use Saved Crop
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {cropBox && (
          <span className="text-xs text-muted-foreground">
            Crop: {(cropBox.width * 100).toFixed(0)}% x {(cropBox.height * 100).toFixed(0)}% of page
          </span>
        )}
      </div>
    </div>
  )
}
