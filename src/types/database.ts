export type Platform = 'flipkart' | 'amazon' | 'd2c'
export type ConnectorMode = 'csv' | 'api'
export type OrderStatus = 'pending' | 'dispatched' | 'delivered' | 'returned' | 'cancelled'
export type ReturnType = 'customer' | 'logistics' | 'cancellation'
export type ImportStatus = 'pending' | 'processing' | 'complete' | 'failed'
export type ReportType =
  | 'dispatch_report'
  | 'listings_settlement'
  | 'historical_orders'
  | 'sku_mapping'
  | 'procurement'

export type UserRole = 'owner' | 'admin' | 'manager' | 'staff' | 'member'

export interface Tenant {
  id: string
  name: string
  created_at: string
}

export interface Organization {
  id: string
  tenant_id: string
  name: string
  legal_name: string | null
  gst_number: string | null
  billing_address: string | null
  created_at: string
}

export interface UserProfile {
  id: string
  tenant_id: string
  email: string
  role: UserRole
  organization_id: string | null
  created_at: string
}

export interface Warehouse {
  id: string
  tenant_id: string
  name: string
  location: string | null
  created_at: string
}

export interface MarketplaceAccount {
  id: string
  tenant_id: string
  platform: Platform
  account_name: string
  mode: ConnectorMode
  organization_id: string | null
  created_at: string
}

export interface MasterSku {
  id: string
  tenant_id: string
  name: string
  description: string | null
  parent_id: string | null
  variant_attributes: Record<string, string> | null
  is_archived: boolean
  shrinkage_rate: number   // default 0.02
  delivery_rate: number    // default 1.0
  created_at: string
}

export interface SkuMapping {
  id: string
  tenant_id: string
  master_sku_id: string
  platform: Platform
  platform_sku: string
  marketplace_account_id: string | null
  created_at: string
}

export interface Purchase {
  id: string
  tenant_id: string
  master_sku_id: string
  warehouse_id: string
  quantity: number
  unit_purchase_price: number
  supplier: string | null
  purchase_date: string
  received_date: string | null
  hsn_code: string | null
  gst_rate_slab: string | null  // e.g. "18%"
  tax_paid: boolean
  invoice_number: string | null
  created_at: string
  lot_id: string | null
}

export interface Dispatch {
  id: string
  tenant_id: string
  master_sku_id: string
  warehouse_id: string
  marketplace_account_id: string | null
  order_id: string
  platform_sku: string | null
  quantity: number
  dispatch_date: string
  created_at: string
}

export interface Order {
  id: string
  tenant_id: string
  platform_order_id: string
  master_sku_id: string | null
  marketplace_account_id: string | null
  quantity: number
  sale_price: number
  order_date: string
  status: OrderStatus
  created_at: string
}

export interface OrderFinancial {
  id: string
  tenant_id: string
  order_id: string
  sale_price: number
  commission_amount: number
  commission_rate: number
  logistics_cost: number
  other_deductions: number
  projected_settlement: number
  actual_settlement: number | null
  settlement_variance: number | null
  created_at: string
}

export interface Return {
  id: string
  tenant_id: string
  order_id: string | null
  master_sku_id: string | null
  warehouse_id: string | null
  return_type: ReturnType
  causes_deduction: boolean
  deduction_amount: number
  return_date: string
  created_at: string
}

export interface SkuFinancialProfile {
  id: string
  tenant_id: string
  master_sku_id: string
  platform: Platform
  avg_commission_rate: number
  avg_logistics_cost: number
  avg_return_rate: number
  avg_net_settlement_pct: number
  sample_size: number
  last_computed_at: string
  created_at: string
}

export interface FreightInvoice {
  id: string
  tenant_id: string
  freight_invoice_number: string | null
  purchase_invoice_number: string
  total_amount: number
  tax_paid: boolean
  gst_rate_slab: string
  vendor: string | null
  freight_date: string
  notes: string | null
  created_at: string
}

export interface PackagingMaterial {
  id: string
  tenant_id: string
  name: string
  unit: string
  unit_cost: number
  created_at: string
  updated_at: string
}

export interface SkuPackagingConfig {
  id: string
  tenant_id: string
  master_sku_id: string
  packaging_material_id: string
  qty_per_dispatch: number
  created_at: string
}

export interface PackagingPurchase {
  id: string
  tenant_id: string
  packaging_material_id: string
  invoice_number: string | null
  quantity: number
  unit_cost: number
  tax_paid: boolean
  gst_rate_slab: string
  vendor: string | null
  purchase_date: string
  created_at: string
}

export interface Import {
  id: string
  tenant_id: string
  file_name: string
  file_path: string
  detected_marketplace: Platform | null
  detected_report_type: ReportType | null
  status: ImportStatus
  rows_processed: number
  rows_failed: number
  error_log: string | null
  imported_by: string | null
  created_at: string
}
