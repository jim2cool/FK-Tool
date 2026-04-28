import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

const FINAL_STATUSES = new Set(['delivered', 'returned', 'cancelled'])
const FINAL_PCT_THRESHOLD = 0.90  // a day is "settled" when ≥90% of its orders are final
const MIN_ORDERS_PER_DAY  = 3     // ignore days with fewer orders (noise)
const STALE_THRESHOLD_DAYS = 5    // don't warn if settled_through is within last 5 days

export interface DataFreshnessResponse {
  settled_through: string | null    // most recent order_date where ≥90% of orders are final
  in_flight_count: number           // orders after that date still in non-final status
  last_uploaded_at: string | null   // when the most recent order row was inserted
  stale: boolean                    // true if settled_through is > STALE_THRESHOLD_DAYS ago
}

export async function GET() {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 90)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    // Fetch only date + status for last 90 days — two tiny columns
    const { data: rows, error } = await supabase
      .from('orders')
      .select('order_date, status')
      .eq('tenant_id', tenantId)
      .gte('order_date', cutoffStr)

    if (error) throw error

    // Group by date
    const byDate = new Map<string, { total: number; final: number }>()
    for (const o of (rows ?? [])) {
      const d = String(o.order_date ?? '').slice(0, 10)
      if (!d) continue
      const entry = byDate.get(d) ?? { total: 0, final: 0 }
      entry.total++
      if (FINAL_STATUSES.has(o.status ?? '')) entry.final++
      byDate.set(d, entry)
    }

    // settled_through = most recent date that qualifies
    const settledDates = [...byDate.entries()]
      .filter(([, v]) => v.total >= MIN_ORDERS_PER_DAY && v.final / v.total >= FINAL_PCT_THRESHOLD)
      .map(([d]) => d)
      .sort()

    const settledThrough = settledDates.length > 0 ? settledDates[settledDates.length - 1] : null

    // in-flight = non-final orders placed AFTER the settled frontier
    let inFlightCount = 0
    if (settledThrough) {
      for (const [d, v] of byDate) {
        if (d > settledThrough) inFlightCount += v.total - v.final
      }
    }

    // When was data last uploaded
    const { data: lastRow } = await supabase
      .from('orders')
      .select('created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const staleThreshold = new Date()
    staleThreshold.setDate(staleThreshold.getDate() - STALE_THRESHOLD_DAYS)
    const stale = !settledThrough || settledThrough < staleThreshold.toISOString().slice(0, 10)

    return NextResponse.json({
      settled_through: settledThrough,
      in_flight_count: inFlightCount,
      last_uploaded_at: lastRow?.created_at ?? null,
      stale,
    } satisfies DataFreshnessResponse)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
