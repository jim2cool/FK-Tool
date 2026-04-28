import { addDays, endOfMonth, format, startOfMonth, subMonths } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

export const DEFAULT_LAG_DAYS = 20
export const DEFAULT_TZ = 'Asia/Kolkata'
export const DEFAULT_MONTHS_REQUIRED = 2

export interface BenchmarkWindow {
  from: string         // YYYY-MM-DD
  to: string           // YYYY-MM-DD
  months: string[]     // ['2026-02', '2026-03']
  monthsLabel: string  // 'Feb–Mar 2026'
  rationale: string
}

/**
 * Compute the recommended P&L benchmark window:
 *   - "today" is taken from IST (Asia/Kolkata) regardless of server clock
 *   - latest finalised month M = the latest M where end_of_month(M) + lagDays <= today
 *   - window spans the previous `monthsRequired` finalised months
 *
 * Edge cases (verified by unit tests):
 *   today=2026-04-25 → window Feb–Mar 2026 (Mar finalised on Apr 20)
 *   today=2026-04-20 → window Feb–Mar 2026 (boundary inclusive)
 *   today=2026-04-19 → window Jan–Feb 2026 (Mar not yet finalised)
 *   today=2026-03-31 → window Jan–Feb 2026 (Feb finalised on Mar 20)
 *   today=2026-01-05 → window Oct–Nov 2025 (cross-year)
 *   today=2026-01-20 → window Nov–Dec 2025 (cross-year boundary)
 */
export function computeBenchmarkWindow(
  utcNow: Date,
  lagDays: number = DEFAULT_LAG_DAYS,
  monthsRequired: number = DEFAULT_MONTHS_REQUIRED,
  tz: string = DEFAULT_TZ,
): BenchmarkWindow {
  const today = toZonedTime(utcNow, tz)
  const latestFinalised = findLatestFinalisedMonth(today, lagDays)
  const windowStart = startOfMonth(subMonths(latestFinalised, monthsRequired - 1))
  const windowEnd = endOfMonth(latestFinalised)

  const months = enumerateMonths(windowStart, windowEnd)
  const monthsLabel = formatMonthsLabel(windowStart, windowEnd)

  return {
    from: format(windowStart, 'yyyy-MM-dd'),
    to: format(windowEnd, 'yyyy-MM-dd'),
    months,
    monthsLabel,
    rationale: `Today is ${format(today, 'MMM d, yyyy')} (${tz}). Most recent finalised P&L = ${format(latestFinalised, 'MMM yyyy')} (${lagDays}-day lag rule). Recommended window = previous ${monthsRequired} finalised months.`,
  }
}

function findLatestFinalisedMonth(today: Date, lagDays: number): Date {
  const todayStr = format(today, 'yyyy-MM-dd')
  let m = startOfMonth(today)
  while (true) {
    const finalisedDate = addDays(endOfMonth(m), lagDays)
    // Compare by date string (YYYY-MM-DD) so the boundary day is inclusive.
    // endOfMonth returns 23:59:59.999, so a direct timestamp comparison would
    // incorrectly exclude the boundary day when today's time < midnight.
    if (format(finalisedDate, 'yyyy-MM-dd') <= todayStr) return m
    m = subMonths(m, 1)
  }
}

function enumerateMonths(start: Date, end: Date): string[] {
  const out: string[] = []
  let cursor = startOfMonth(start)
  const stop = startOfMonth(end)
  while (cursor <= stop) {
    out.push(format(cursor, 'yyyy-MM'))
    cursor = startOfMonth(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
  }
  return out
}

function formatMonthsLabel(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear()
  const startLabel = format(start, sameYear ? 'MMM' : 'MMM yyyy')
  const endLabel = format(end, 'MMM yyyy')
  return `${startLabel}–${endLabel}`
}
