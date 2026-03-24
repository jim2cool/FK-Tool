/** Data extracted from a single Flipkart label PDF page */
export interface ParsedLabel {
  /** Index of the source file in the uploaded files array */
  fileIndex: number
  /** Page index in the source PDF (0-based) */
  pageIndex: number
  /** Flipkart order ID (e.g., OD437024786226306100) */
  orderId: string
  /** Platform SKU ID as printed on label */
  platformSku: string
  /** Product description as printed on label */
  productDescription: string
  /** Seller/org name from "Sold By" field */
  sellerName: string
  /** GSTIN from label */
  gstin: string
  /** Courier name (e.g., "Expressbees E2E COD") */
  courier: string
  /** AWB tracking number */
  awbNumber: string
  /** Payment type */
  paymentType: 'COD' | 'PREPAID' | 'UNKNOWN'
  /** Handover By Date (HBD) */
  hbd: string | null
  /** Customer Promise Date (CPD) */
  cpd: string | null
  /** Customer pincode (extracted from address) */
  customerPincode: string | null
  /** Sale price from invoice section */
  salePrice: number | null
  /** Source PDF file name */
  sourceFile: string
}

/** A component of a combo product */
export interface ComboComponent {
  masterSkuId: string
  masterSkuName: string
  quantity: number
}

/** Result of resolving a platform SKU to a master SKU */
export interface ResolvedLabel extends ParsedLabel {
  masterSkuId: string | null
  masterSkuName: string | null
  marketplaceAccountId: string | null
  organizationId: string | null
  isCombo: boolean
  comboProductId: string | null
  comboProductName: string | null
  components: ComboComponent[] | null
}

/** Group of labels for the same master product */
export interface LabelGroup {
  masterSkuId: string
  masterSkuName: string
  count: number
  pages: Array<{ fileIndex: number; pageIndex: number }>
  orgBreakdown: Array<{ orgName: string; count: number }>
  codCount: number
  prepaidCount: number
}

/** Labels that couldn't be matched to a master SKU */
export interface UnmappedSku {
  platformSku: string
  productDescription: string
  count: number
  pages: Array<{ fileIndex: number; pageIndex: number }>
}

/** Full result of parsing + resolving a batch of label PDFs */
export interface LabelSortResult {
  groups: LabelGroup[]
  unmapped: UnmappedSku[]
  totalLabels: number
  stats: {
    totalOrders: number
    codCount: number
    prepaidCount: number
    orgBreakdown: Array<{ orgName: string; count: number }>
  }
}
