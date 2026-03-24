import { PDFDocument } from 'pdf-lib'
import type { ResolvedLabel, LabelGroup } from './types'
import type { CropBox } from '@/components/labels/LabelCropSelector'

/**
 * Given groups, source PDF files, and a user-defined crop box,
 * produce one cropped PDF per product group.
 * Each output page is exactly 4x6 inches (288x432pt) for label printers.
 */
export async function cropAndGroupLabels(
  groups: LabelGroup[],
  sourceFiles: File[],
  cropBox: CropBox,
): Promise<Map<string, Uint8Array>> {
  // Target: 4x6 inch label (288 x 432 points)
  const LABEL_WIDTH = 288
  const LABEL_HEIGHT = 432

  // Load all source PDFs into pdf-lib documents
  const sourceDocs: PDFDocument[] = []
  for (const file of sourceFiles) {
    const bytes = await file.arrayBuffer()
    const doc = await PDFDocument.load(bytes)
    sourceDocs.push(doc)
  }

  const result = new Map<string, Uint8Array>()

  for (const group of groups) {
    const outputDoc = await PDFDocument.create()

    for (const pageRef of group.pages) {
      const sourceDoc = sourceDocs[pageRef.fileIndex]
      if (!sourceDoc) continue

      const sourcePage = sourceDoc.getPage(pageRef.pageIndex)
      const { width: pageWidth, height: pageHeight } = sourcePage.getSize()

      // Convert ratio-based crop box to PDF coordinates
      // CropBox ratios: x/y from top-left corner (canvas coordinates)
      // pdf-lib: x/y from bottom-left corner
      const cropX = cropBox.x * pageWidth
      const cropW = cropBox.width * pageWidth
      const cropH = cropBox.height * pageHeight
      // Flip Y: canvas y=0 is top, pdf y=0 is bottom
      const cropY = pageHeight - (cropBox.y * pageHeight) - cropH

      // Use embedPages with boundingBox to clip directly — no temp doc needed
      const [embeddedPage] = await outputDoc.embedPages(
        [sourcePage],
        [{ left: cropX, bottom: cropY, right: cropX + cropW, top: cropY + cropH }],
      )

      // Create a new 4x6 page and draw the embedded label scaled to fit
      const newPage = outputDoc.addPage([LABEL_WIDTH, LABEL_HEIGHT])
      const scale = Math.min(LABEL_WIDTH / embeddedPage.width, LABEL_HEIGHT / embeddedPage.height)
      const scaledW = embeddedPage.width * scale
      const scaledH = embeddedPage.height * scale
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
