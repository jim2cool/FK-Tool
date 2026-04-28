export interface ProxyTarget {
  master_product: string
  avg_bank_settlement: number | null
  account_name: string
}

export interface ProxyCandidate {
  master_product: string
  avg_bank_settlement: number
  delivery_rate: number
  est_return_cost_per_dispatched_unit: number
  account_name: string
  dispatched_units: number
}

export interface ProxyResult {
  delivery_rate: number
  est_return_cost_per_dispatched_unit: number
  proxy_master_product: string
  proxy_account_name: string
}

const RANGE = 0.25  // ±25%

/**
 * Find a similar-priced product to use as a benchmark proxy when the target
 * product has no historical P&L data.
 *
 * Returns null if:
 *   - target.avg_bank_settlement is null or <= 0
 *   - no candidate falls within ±25% of target settlement
 *
 * Tiebreakers (when multiple candidates are equidistant):
 *   1. Prefer candidate with more dispatched_units (statistical reliability)
 *   2. Prefer alphabetic master_product (deterministic fallback)
 */
export function findSimilarPricedProxy(
  target: ProxyTarget,
  candidates: ProxyCandidate[],
): ProxyResult | null {
  if (target.avg_bank_settlement == null || target.avg_bank_settlement <= 0) return null
  const targetPrice = target.avg_bank_settlement

  const min = targetPrice * (1 - RANGE)
  const max = targetPrice * (1 + RANGE)
  const inRange = candidates.filter(c => c.avg_bank_settlement >= min && c.avg_bank_settlement <= max)
  if (inRange.length === 0) return null

  // Sort by absolute price distance, then by -dispatched_units, then alphabetic
  const sorted = inRange.slice().sort((a, b) => {
    const dA = Math.abs(a.avg_bank_settlement - targetPrice)
    const dB = Math.abs(b.avg_bank_settlement - targetPrice)
    if (dA !== dB) return dA - dB
    if (b.dispatched_units !== a.dispatched_units) return b.dispatched_units - a.dispatched_units
    return a.master_product.localeCompare(b.master_product)
  })
  const winner = sorted[0]
  return {
    delivery_rate: winner.delivery_rate,
    est_return_cost_per_dispatched_unit: winner.est_return_cost_per_dispatched_unit,
    proxy_master_product: winner.master_product,
    proxy_account_name: winner.account_name,
  }
}
