import { PDFDocument } from 'pdf-lib'
import type { ResolvedLabel, LabelGroup } from './types'

/**
 * Find the Y coordinate of the dashed separator line between the shipping label
 * and the tax invoice. Uses pdf.js text extraction to locate "Tax Invoice" text
 * and crops just above it.
 *
 * Returns the Y coordinate (from bottom of page) where the crop should happen.
 * Falls back to 50% if detection fails.
 */
async function findLabelCropY(
  file: File,
  pageIndex: number,
): Promise<{ cropY: number; pageHeight: number; pageWidth: number }> {
  const pdfjsLib = await import('pdfjs-dist')
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(pageIndex + 1) // 1-indexed
  const viewport = page.getViewport({ scale: 1.0 })
  const pageHeight = viewport.height
  const pageWidth = viewport.width

  const textContent = await page.getTextContent()

  // Build a list of all text items with their Y positions (from bottom of page)
  const textItems: Array<{ text: string; y: number }> = []
  for (const item of textContent.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const ty = (item as { transform: number[] }).transform[5]
    textItems.push({ text: item.str.trim(), y: ty })
  }

  // Sort by Y position descending (top of page first)
  textItems.sort((a, b) => b.y - a.y)

  // DEBUG: log text items to console for diagnosis
  console.log(`[LabelCrop] Page ${pageIndex} — ${textItems.length} text items, page: ${pageWidth}x${pageHeight}`)
  for (const t of textItems) {
    console.log(`  y=${t.y.toFixed(1)} "${t.text}"`)
  }

  // Strategy 1: Find "Tax Invoice" or "Tax" near "Invoice" — marks the invoice section
  let invoiceY: number | null = null

  for (let i = 0; i < textItems.length; i++) {
    const t = textItems[i].text.toLowerCase()
    // Exact match on combined text
    if (t.includes('tax invoice')) {
      invoiceY = textItems[i].y
      break
    }
    // "Tax" followed by "Invoice" as separate text items at the same Y level
    if (t === 'tax' && i + 1 < textItems.length) {
      const next = textItems[i + 1]
      if (next.text.toLowerCase() === 'invoice' && Math.abs(next.y - textItems[i].y) < 5) {
        invoiceY = textItems[i].y
        break
      }
    }
  }

  if (invoiceY !== null) {
    const cropY = invoiceY + 15
    return { cropY, pageHeight, pageWidth }
  }

  // Strategy 2: Find "Not for resale" — this is the LAST line of the shipping label
  // Crop just below this text
  for (const item of textItems) {
    if (item.text.toLowerCase().includes('not for resale')) {
      // Crop a bit below "Not for resale" to include it, then cut
      const cropY = item.y - 5
      return { cropY, pageHeight, pageWidth }
    }
  }

  // Strategy 3: Find "Printed at" — also appears at the bottom of the label section
  for (const item of textItems) {
    if (item.text.toLowerCase().includes('printed at')) {
      const cropY = item.y - 5
      return { cropY, pageHeight, pageWidth }
    }
  }

  // Strategy 4: Look for the largest vertical gap in the middle of the page
  const yPositions = textItems.map(t => t.y).sort((a, b) => b - a)

  let maxGap = 0
  let gapY = pageHeight / 2

  for (let i = 0; i < yPositions.length - 1; i++) {
    const fromTop = pageHeight - yPositions[i]
    if (fromTop < pageHeight * 0.3 || fromTop > pageHeight * 0.7) continue

    const gap = yPositions[i] - yPositions[i + 1]
    if (gap > maxGap) {
      maxGap = gap
      gapY = yPositions[i + 1] + gap / 2
    }
  }

  if (maxGap > 20) {
    return { cropY: gapY, pageHeight, pageWidth }
  }

  // Final fallback: 50%
  return { cropY: pageHeight / 2, pageHeight, pageWidth }
}

/**
 * Given groups and the source PDF files, produce one cropped PDF per product group.
 * Each output PDF contains only the label portion (top section) of each page,
 * intelligently detecting the label/invoice boundary.
 */
export async function cropAndGroupLabels(
  groups: LabelGroup[],
  sourceFiles: File[],
): Promise<Map<string, Uint8Array>> {
  // Load all source PDFs into pdf-lib documents
  const sourceDocs: PDFDocument[] = []
  for (const file of sourceFiles) {
    const bytes = await file.arrayBuffer()
    const doc = await PDFDocument.load(bytes)
    sourceDocs.push(doc)
  }

  // Pre-compute crop positions for all pages we need
  const cropCache = new Map<string, { cropY: number; pageHeight: number; pageWidth: number }>()
  for (const group of groups) {
    for (const pageRef of group.pages) {
      const key = `${pageRef.fileIndex}-${pageRef.pageIndex}`
      if (!cropCache.has(key)) {
        cropCache.set(key, await findLabelCropY(sourceFiles[pageRef.fileIndex], pageRef.pageIndex))
      }
    }
  }

  const result = new Map<string, Uint8Array>()

  for (const group of groups) {
    const outputDoc = await PDFDocument.create()

    for (const pageRef of group.pages) {
      const sourceDoc = sourceDocs[pageRef.fileIndex]
      if (!sourceDoc) continue

      const key = `${pageRef.fileIndex}-${pageRef.pageIndex}`
      const cropInfo = cropCache.get(key)!

      // Target: 4x6 inch label (288 x 432 points)
      const LABEL_WIDTH = 288
      const LABEL_HEIGHT = 432

      // Step 1: Create a temp doc with just the cropped label
      const tempDoc = await PDFDocument.create()
      const [tempPage] = await tempDoc.copyPages(sourceDoc, [pageRef.pageIndex])
      const labelHeight = cropInfo.pageHeight - cropInfo.cropY
      tempPage.setCropBox(0, cropInfo.cropY, cropInfo.pageWidth, labelHeight)
      tempPage.setMediaBox(0, cropInfo.cropY, cropInfo.pageWidth, labelHeight)
      tempDoc.addPage(tempPage)

      // Step 2: Embed the cropped page into the output doc as a scaled image
      const tempBytes = await tempDoc.save()
      const embeddableDoc = await PDFDocument.load(tempBytes)
      const [embeddedPage] = await outputDoc.embedPages(embeddableDoc.getPages())

      // Step 3: Create a new 4x6 page and draw the embedded label scaled to fit
      const newPage = outputDoc.addPage([LABEL_WIDTH, LABEL_HEIGHT])
      const scale = Math.min(LABEL_WIDTH / embeddedPage.width, LABEL_HEIGHT / embeddedPage.height)
      const scaledW = embeddedPage.width * scale
      const scaledH = embeddedPage.height * scale
      // Center on the label
      const x = (LABEL_WIDTH - scaledW) / 2
      const y = (LABEL_HEIGHT - scaledH) / 2
      newPage.drawPage(embeddedPage, { x, y, width: scaledW, height: scaledH })
    }

    const pdfBytes = await outputDoc.save()
    const fileName = `${group.masterSkuName} — ${group.count} labels`
    result.set(fileName, pdfBytes)
  }

  return result
}

/**
 * Group resolved labels by master SKU.
 * Unmapped labels are excluded (handled separately by UnmappedSkuPanel).
 */
export function groupLabelsByProduct(labels: ResolvedLabel[]): LabelGroup[] {
  const groups = new Map<string, LabelGroup>()

  for (const label of labels) {
    if (!label.masterSkuId || !label.masterSkuName) continue

    const existing = groups.get(label.masterSkuId)
    if (existing) {
      existing.count++
      existing.pages.push({ fileIndex: label.fileIndex, pageIndex: label.pageIndex })
      if (label.paymentType === 'COD') existing.codCount++
      if (label.paymentType === 'PREPAID') existing.prepaidCount++

      const orgName = label.sellerName || 'Unknown'
      const orgEntry = existing.orgBreakdown.find(o => o.orgName === orgName)
      if (orgEntry) orgEntry.count++
      else existing.orgBreakdown.push({ orgName, count: 1 })
    } else {
      groups.set(label.masterSkuId, {
        masterSkuId: label.masterSkuId,
        masterSkuName: label.masterSkuName,
        count: 1,
        pages: [{ fileIndex: label.fileIndex, pageIndex: label.pageIndex }],
        orgBreakdown: [{ orgName: label.sellerName || 'Unknown', count: 1 }],
        codCount: label.paymentType === 'COD' ? 1 : 0,
        prepaidCount: label.paymentType === 'PREPAID' ? 1 : 0,
      })
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.count - a.count)
}
