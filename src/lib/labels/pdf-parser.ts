import type { ParsedLabel } from './types'

let pdfjsInitialized = false

/**
 * Parse all pages of a Flipkart label PDF and extract structured data.
 * Each page = 1 order (label on top, invoice on bottom).
 */
export async function parseLabelPdf(
  file: File,
  fileIndex: number = 0,
): Promise<ParsedLabel[]> {
  // Dynamic import to avoid SSR/prerender issues (pdfjs-dist needs DOMMatrix)
  const pdfjsLib = await import('pdfjs-dist')

  if (!pdfjsInitialized && typeof window !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
    pdfjsInitialized = true
  }

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const labels: ParsedLabel[] = []

  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1) // pdf.js pages are 1-indexed
    const textContent = await page.getTextContent()
    const text = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')

    const label = extractLabelFields(text, fileIndex, i, file.name)
    if (label) {
      labels.push(label)
    }
  }

  return labels
}

/**
 * Extract structured fields from the raw text of a single label page.
 *
 * Flipkart label layout (verified from sample):
 * - Line 1: "STD [Courier Name] [SURFACE/EXPRESS] E"
 * - Line 2: "[Order ID] [COD/PREPAID]"
 * - Seller: "Sold By [Org Name], [address]"
 * - GSTIN: "GSTIN: [number]"
 * - SKU row: "[qty] [platform_sku] | [product description] [qty]"
 * - AWB: numeric string near bottom of label section
 * - HBD/CPD: "HBD: DD - MM" / "CPD: DD - MM"
 */
function extractLabelFields(
  text: string,
  fileIndex: number,
  pageIndex: number,
  sourceFile: string,
): ParsedLabel | null {
  // Order ID: starts with OD followed by digits
  const orderIdMatch = text.match(/OD\d{15,25}/)
  if (!orderIdMatch) return null // Not a valid Flipkart label page
  const orderId = orderIdMatch[0]

  // Payment type: COD or PREPAID appears near the order ID
  const paymentType = text.includes('PREPAID')
    ? 'PREPAID' as const
    : text.includes('COD')
      ? 'COD' as const
      : 'UNKNOWN' as const

  // Courier: appears right after "STD" at the start
  const courierMatch = text.match(/STD\s+(.+?)(?:\s+SURFACE|\s+EXPRESS)/)
  const courier = courierMatch?.[1]?.trim() ?? 'Unknown'

  // Seller name: "Sold By [NAME]," or "Sold By:[NAME],"
  const sellerMatch = text.match(/Sold [Bb]y[:\s]*([A-Z][A-Z0-9\s&.]+?)(?:,|\s+first|\s+Ground|\s+Floor)/)
  const sellerName = sellerMatch?.[1]?.trim() ?? 'Unknown'

  // GSTIN: "GSTIN: XXXXXXXXXXXX" (15 chars)
  const gstinMatch = text.match(/GSTIN:\s*([A-Z0-9]{15})/)
  const gstin = gstinMatch?.[1] ?? ''

  // SKU ID and Description: appears in "SKU ID | Description" section
  const skuMatch = text.match(/SKU ID\s*\|\s*Description\s*QTY\s*(\d+)\s*(.+?)\s*\|\s*(.+?)(?:\s+\d+\s|$)/)
  let platformSku = ''
  let productDescription = ''
  if (skuMatch) {
    platformSku = skuMatch[2]?.trim() ?? ''
    productDescription = skuMatch[3]?.trim() ?? ''
  } else {
    // Fallback: try to find the SKU row without header
    const skuFallback = text.match(/\d\s+([^\|]+?)\s*\|\s*([^\d]+?)(?:\s+\d)/)
    if (skuFallback) {
      platformSku = skuFallback[1]?.trim() ?? ''
      productDescription = skuFallback[2]?.trim() ?? ''
    }
  }

  // AWB Number: long numeric string (10-15 digits) that appears after the SKU section
  const awbMatch = text.match(/\b(\d{10,15})\b/)
  const awbNumber = awbMatch?.[1] ?? ''

  // HBD and CPD: "HBD: DD - MM" format
  const hbdMatch = text.match(/HBD:\s*(\d{2}\s*-\s*\d{2})/)
  const hbd = hbdMatch?.[1]?.replace(/\s/g, '') ?? null

  const cpdMatch = text.match(/CPD:\s*(\d{2}\s*-\s*\d{2})/)
  const cpd = cpdMatch?.[1]?.replace(/\s/g, '') ?? null

  // Customer pincode: 6-digit Indian pincode from address section
  const pincodeMatches = text.match(/\b(\d{6})\b/g)
  const customerPincode = pincodeMatches && pincodeMatches.length > 0
    ? pincodeMatches[0]
    : null

  // Sale price: from invoice section, look for "Total" column value
  const priceMatch = text.match(/TOTAL PRICE:\s*([\d,.]+)/)
  const salePrice = priceMatch
    ? parseFloat(priceMatch[1].replace(/,/g, ''))
    : null

  return {
    fileIndex,
    pageIndex,
    orderId,
    platformSku,
    productDescription,
    sellerName,
    gstin,
    courier,
    awbNumber,
    paymentType,
    hbd,
    cpd,
    customerPincode,
    salePrice,
    sourceFile,
  }
}
