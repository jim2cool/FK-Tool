import { PDFDocument } from 'pdf-lib'
import type { ResolvedLabel, LabelGroup } from './types'
import type { CropBox, LabelSize } from '@/components/labels/LabelCropSelector'

/**
 * Given groups, source PDF files, a user-defined crop box, and a label size,
 * produce one cropped PDF per product group.
 * Each output page matches the selected label size exactly, edge-to-edge.
 */
export async function cropAndGroupLabels(
  groups: LabelGroup[],
  sourceFiles: File[],
  cropBox: CropBox,
  labelSize?: LabelSize,
): Promise<Map<string, Uint8Array>> {
  const LABEL_WIDTH = labelSize?.widthPt ?? 288
  const LABEL_HEIGHT = labelSize?.heightPt ?? 432

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

      // Create output page at exact label size, stretch to fill edge-to-edge
      // Since crop box is aspect-ratio locked to the label size, this fills perfectly
      const newPage = outputDoc.addPage([LABEL_WIDTH, LABEL_HEIGHT])
      newPage.drawPage(embeddedPage, { x: 0, y: 0, width: LABEL_WIDTH, height: LABEL_HEIGHT })
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
