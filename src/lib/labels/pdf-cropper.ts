import { PDFDocument } from 'pdf-lib'
import type { ResolvedLabel, LabelGroup } from './types'

/**
 * Given groups and the source PDF files, produce one cropped PDF per product group.
 * Each output PDF contains only the label portion (top half) of each page.
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

  const result = new Map<string, Uint8Array>()

  for (const group of groups) {
    const outputDoc = await PDFDocument.create()

    for (const pageRef of group.pages) {
      const sourceDoc = sourceDocs[pageRef.fileIndex]
      if (!sourceDoc) continue

      const sourcePage = sourceDoc.getPage(pageRef.pageIndex)
      const { width, height } = sourcePage.getSize()

      // Copy the page to our output document
      const [copiedPage] = await outputDoc.copyPages(sourceDoc, [pageRef.pageIndex])

      // Crop to top half only (the shipping label)
      // pdf-lib setCropBox(x, y, width, height) — y is from bottom edge
      copiedPage.setCropBox(0, height / 2, width, height / 2)
      copiedPage.setMediaBox(0, height / 2, width, height / 2)

      outputDoc.addPage(copiedPage)
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
