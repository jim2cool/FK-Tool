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

  // Look for "Tax Invoice" text — this marks the start of the invoice section.
  // The dashed line is just above it. We want to crop AT the dashed line.
  // Also check for "- - - -" dashed line pattern.
  let invoiceY: number | null = null

  for (const item of textContent.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const text = item.str.trim()

    // pdf.js transform: [scaleX, skewX, skewY, scaleY, translateX, translateY]
    // translateY is from the BOTTOM of the page in pdf.js coordinates
    const ty = (item as { transform: number[] }).transform[5]

    // "Tax Invoice" marks the invoice section start
    if (text.toLowerCase().includes('tax invoice')) {
      // Convert to distance from bottom: in pdf.js, ty IS from bottom
      invoiceY = ty
      break
    }
  }

  if (invoiceY !== null) {
    // Add a small margin above "Tax Invoice" to include the dashed line gap
    // invoiceY is from the bottom of the page
    // We want to crop everything below this point + a small buffer
    const cropY = invoiceY + 10 // 10pt above the "Tax Invoice" text
    return { cropY, pageHeight, pageWidth }
  }

  // Fallback: try to find the dashed separator by looking for a large vertical
  // gap in text items in the middle portion of the page
  const yPositions = textContent.items
    .filter((item): item is typeof item & { transform: number[] } =>
      'str' in item && item.str.trim().length > 0)
    .map(item => item.transform[5])
    .sort((a, b) => b - a) // top to bottom (highest Y first)

  // Look for the largest gap in the middle 40% of the page
  let maxGap = 0
  let gapY = pageHeight / 2

  for (let i = 0; i < yPositions.length - 1; i++) {
    const y = yPositions[i]
    // Only consider gaps in the middle portion of the page (30%-70% from top)
    const fromTop = pageHeight - y
    if (fromTop < pageHeight * 0.3 || fromTop > pageHeight * 0.7) continue

    const gap = yPositions[i] - yPositions[i + 1]
    if (gap > maxGap) {
      maxGap = gap
      gapY = yPositions[i + 1] + gap / 2 // middle of the gap
    }
  }

  // If we found a significant gap (> 20pt), use it
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
