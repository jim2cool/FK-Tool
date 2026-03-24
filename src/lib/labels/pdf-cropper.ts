import { PDFDocument } from 'pdf-lib'
import type { ResolvedLabel, LabelGroup } from './types'
import type { CropBox, LabelSize } from '@/components/labels/LabelCropSelector'

/**
 * Crop and embed a region of source PDF pages into output pages at a target size.
 * Used for both label and invoice cropping.
 */
async function cropPagesToSize(
  groups: LabelGroup[],
  sourceDocs: PDFDocument[],
  cropBox: CropBox,
  targetWidth: number,
  targetHeight: number,
  fileNameSuffix: string,
): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>()

  for (const group of groups) {
    const outputDoc = await PDFDocument.create()

    for (const pageRef of group.pages) {
      const sourceDoc = sourceDocs[pageRef.fileIndex]
      if (!sourceDoc) continue

      const sourcePage = sourceDoc.getPage(pageRef.pageIndex)
      const { width: pageWidth, height: pageHeight } = sourcePage.getSize()

      const cropX = cropBox.x * pageWidth
      const cropW = cropBox.width * pageWidth
      const cropH = cropBox.height * pageHeight
      const cropY = pageHeight - (cropBox.y * pageHeight) - cropH

      const [embeddedPage] = await outputDoc.embedPages(
        [sourcePage],
        [{ left: cropX, bottom: cropY, right: cropX + cropW, top: cropY + cropH }],
      )

      const newPage = outputDoc.addPage([targetWidth, targetHeight])
      newPage.drawPage(embeddedPage, { x: 0, y: 0, width: targetWidth, height: targetHeight })
    }

    const pdfBytes = await outputDoc.save()
    const fileName = `${group.masterSkuName} — ${group.count} ${fileNameSuffix}`
    result.set(fileName, pdfBytes)
  }

  return result
}

/**
 * Load source PDF files into pdf-lib documents (shared between label and invoice cropping).
 */
async function loadSourceDocs(sourceFiles: File[]): Promise<PDFDocument[]> {
  const docs: PDFDocument[] = []
  for (const file of sourceFiles) {
    const bytes = await file.arrayBuffer()
    docs.push(await PDFDocument.load(bytes))
  }
  return docs
}

/**
 * Crop labels from source PDFs using user-defined crop box.
 */
export async function cropAndGroupLabels(
  groups: LabelGroup[],
  sourceFiles: File[],
  cropBox: CropBox,
  labelSize?: LabelSize,
): Promise<Map<string, Uint8Array>> {
  const sourceDocs = await loadSourceDocs(sourceFiles)
  return cropPagesToSize(
    groups, sourceDocs, cropBox,
    labelSize?.widthPt ?? 288, labelSize?.heightPt ?? 432,
    'labels',
  )
}

/**
 * Crop invoices from source PDFs using user-defined invoice crop box.
 */
export async function cropAndGroupInvoices(
  groups: LabelGroup[],
  sourceFiles: File[],
  invoiceCrop: CropBox,
  invoiceSize?: LabelSize,
): Promise<Map<string, Uint8Array>> {
  const sourceDocs = await loadSourceDocs(sourceFiles)
  return cropPagesToSize(
    groups, sourceDocs, invoiceCrop,
    invoiceSize?.widthPt ?? 595, invoiceSize?.heightPt ?? 842,
    'invoices',
  )
}

/**
 * Group resolved labels by master SKU.
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
