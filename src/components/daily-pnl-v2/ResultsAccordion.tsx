'use client'
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ResultsTabs } from '@/components/daily-pnl/ResultsTabs'
import type { ResultsResponse } from '@/lib/daily-pnl/types'
import type { ResultsResponseV2 } from '@/lib/daily-pnl-v2/types'

interface Props {
  data: ResultsResponseV2
  dispatchFrom: string
  dispatchTo: string
}

function fmtINR(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function totalPnl(r: ResultsResponse | null): number {
  if (!r) return 0
  return r.consolidated.reduce((s, row) => s + (row.total_est_pnl ?? 0), 0)
}

function totalUnits(r: ResultsResponse | null): number {
  if (!r) return 0
  return r.consolidated.reduce((s, row) => s + row.quantity, 0)
}

export function ResultsAccordion({ data, dispatchFrom, dispatchTo }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ consolidated: true })

  function toggle(key: string) {
    setExpanded(p => ({ ...p, [key]: !p[key] }))
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Dispatch {dispatchFrom} → {dispatchTo} · Benchmark {data.benchmark_window.monthsLabel}
      </p>

      {/* Consolidated — open by default */}
      <Section
        keyName="consolidated"
        title="Consolidated"
        statsLine={`${fmtINR(totalPnl(data.consolidated))} · ${totalUnits(data.consolidated)} units`}
        expanded={!!expanded.consolidated}
        onToggle={() => toggle('consolidated')}
      >
        <ResultsTabs data={data.consolidated} from={dispatchFrom} to={dispatchTo} showAccountColumn />
      </Section>

      {/* Per-account — collapsed by default */}
      {data.per_account.map(acc => (
        <Section
          key={acc.marketplace_account_id}
          keyName={acc.marketplace_account_id}
          title={acc.account_name}
          statsLine={
            acc.has_orders_in_range && acc.results
              ? `${fmtINR(totalPnl(acc.results))} · ${totalUnits(acc.results)} units`
              : 'No orders in range'
          }
          expanded={!!expanded[acc.marketplace_account_id]}
          onToggle={() => toggle(acc.marketplace_account_id)}
        >
          {acc.results ? (
            <ResultsTabs data={acc.results} from={dispatchFrom} to={dispatchTo} />
          ) : (
            <p className="text-sm text-muted-foreground">No dispatched orders for this account in this date range.</p>
          )}
        </Section>
      ))}

      {data.warnings.length > 0 && (
        <ul className="text-xs text-amber-700 space-y-1">
          {data.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
        </ul>
      )}
    </div>
  )
}

function Section({ keyName, title, statsLine, expanded, onToggle, children }: {
  keyName: string
  title: string
  statsLine: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border rounded-lg">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-muted/40 transition-colors"
        aria-expanded={expanded}
        aria-controls={`section-${keyName}`}
      >
        <span className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="font-medium">{title}</span>
        </span>
        <span className="text-xs text-muted-foreground">{statsLine}</span>
      </button>
      {expanded && (
        <div id={`section-${keyName}`} className="px-4 pb-4 pt-1 border-t">
          {children}
        </div>
      )}
    </div>
  )
}
