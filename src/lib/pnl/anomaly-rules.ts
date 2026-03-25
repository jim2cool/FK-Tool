import type { ParsedPnlRow } from '@/lib/importers/pnl-xlsx-parser'

export interface AnomalyFlag {
  rule_key: string
  message: string
}

export const DEFAULT_ANOMALY_RULES = [
  {
    rule_key: 'reverse_shipping_on_cancel',
    name: 'Reverse shipping on cancelled order',
    description:
      "Flipkart charged reverse shipping for a cancelled order (not dispatched)",
  },
  {
    rule_key: 'reverse_shipping_on_rto',
    name: 'Reverse shipping on RTO',
    description:
      "Flipkart charged reverse shipping on a logistics return (should be Flipkart's cost)",
  },
  {
    rule_key: 'commission_on_return',
    name: 'Commission on returned order',
    description: 'Commission charged but order was fully returned',
  },
  {
    rule_key: 'settlement_mismatch',
    name: "Settlement doesn't match projected",
    description:
      'Actual settled amount differs from projected by more than \u20B91',
  },
]

export function detectAnomalies(
  row: ParsedPnlRow,
  enabledRules: Set<string>
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = []

  if (
    enabledRules.has('reverse_shipping_on_cancel') &&
    row.cancelledUnits > 0 &&
    row.reverseShippingFee < 0
  ) {
    flags.push({
      rule_key: 'reverse_shipping_on_cancel',
      message: `Reverse shipping fee (${row.reverseShippingFee}) charged on cancelled order`,
    })
  }

  if (
    enabledRules.has('reverse_shipping_on_rto') &&
    row.rtoUnits > 0 &&
    row.reverseShippingFee < 0
  ) {
    flags.push({
      rule_key: 'reverse_shipping_on_rto',
      message: `Reverse shipping fee (${row.reverseShippingFee}) charged on RTO return`,
    })
  }

  if (
    enabledRules.has('commission_on_return') &&
    row.netUnits <= 0 &&
    row.commissionFee < 0 &&
    row.orderStatus === 'returned'
  ) {
    flags.push({
      rule_key: 'commission_on_return',
      message: `Commission fee (${row.commissionFee}) charged on fully returned order`,
    })
  }

  if (
    enabledRules.has('settlement_mismatch') &&
    row.amountSettled !== 0 &&
    Math.abs(row.amountSettled - row.projectedSettlement) > 1
  ) {
    flags.push({
      rule_key: 'settlement_mismatch',
      message: `Settled ${row.amountSettled} vs projected ${row.projectedSettlement} (diff: ${(row.amountSettled - row.projectedSettlement).toFixed(2)})`,
    })
  }

  return flags
}
