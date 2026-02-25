import type { Platform, ReportType } from '@/types'

export interface FileSignature {
  platform: Platform
  reportType: ReportType
  requiredColumns: string[]   // all must be present (case-insensitive substring match)
  optionalColumns: string[]   // boost confidence if present
}

// Normalise: lowercase, trim, collapse spaces
export function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

export const SIGNATURES: FileSignature[] = [
  {
    platform: 'flipkart',
    reportType: 'dispatch_report',
    requiredColumns: ['order id', 'tracking id', 'dispatch date', 'sku'],
    optionalColumns: ['sub order id', 'courier', 'warehouse', 'quantity'],
  },
  {
    platform: 'flipkart',
    reportType: 'listings_settlement',
    requiredColumns: ['order id', 'sku', 'sale price', 'commission'],
    optionalColumns: ['sub order id', 'logistics fee', 'settlement amount', 'collection fee'],
  },
  {
    platform: 'flipkart',
    reportType: 'historical_orders',
    requiredColumns: ['order id', 'fsn', 'order date', 'status'],
    optionalColumns: ['sub order id', 'return type', 'customer name', 'quantity'],
  },
  {
    platform: 'flipkart',
    reportType: 'sku_mapping',
    requiredColumns: ['master sku', 'flipkart sku'],
    optionalColumns: ['amazon sku', 'd2c sku'],
  },
  {
    platform: 'flipkart',
    reportType: 'procurement',
    requiredColumns: ['master sku', 'quantity', 'unit cost', 'purchase date'],
    optionalColumns: ['packaging cost', 'other cost', 'supplier', 'warehouse'],
  },
  {
    platform: 'amazon',
    reportType: 'dispatch_report',
    requiredColumns: ['amazon-order-id', 'sku', 'quantity-shipped'],
    optionalColumns: ['ship-date', 'tracking-number', 'carrier-name'],
  },
  {
    platform: 'amazon',
    reportType: 'historical_orders',
    requiredColumns: ['amazon-order-id', 'asin', 'purchase-date', 'order-status'],
    optionalColumns: ['sku', 'quantity', 'item-price'],
  },
]
