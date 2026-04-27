'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Package, RotateCcw, DollarSign, Landmark } from 'lucide-react'
import type { ReportType } from './types'

const REPORTS: { type: ReportType; label: string; description: string; icon: typeof Package }[] = [
  { type: 'orders',     label: 'Orders Report',     description: 'Lifecycle data — dispatch, delivery, return dates', icon: Package },
  { type: 'returns',    label: 'Returns Report',    description: 'RTO/RVP details with reasons',                       icon: RotateCcw },
  { type: 'pnl',        label: 'P&L Report',        description: 'Fee breakdown — commission, shipping, taxes',        icon: DollarSign },
  { type: 'settlement', label: 'Settlement Report', description: 'Bank settlement and NEFT IDs',                       icon: Landmark },
]

interface Props {
  selected: ReportType | null
  onSelect: (rt: ReportType) => void
  onNext: () => void
  onCancel: () => void
}

const HIDE_HINT_KEY = 'fk-tool:bulk-import:hide-source-hint-until'

export function StepReportType({ selected, onSelect, onNext, onCancel }: Props) {
  const [showHint, setShowHint] = useState(true)

  useEffect(() => {
    try {
      const ts = window.localStorage.getItem(HIDE_HINT_KEY)
      if (ts && Number(ts) > Date.now()) setShowHint(false)
    } catch { /* localStorage may be unavailable */ }
  }, [])

  function dismissHint() {
    try {
      const thirty = 30 * 24 * 60 * 60 * 1000
      window.localStorage.setItem(HIDE_HINT_KEY, String(Date.now() + thirty))
    } catch { /* ignore */ }
    setShowHint(false)
  }

  return (
    <div className="space-y-4">
      {showHint && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs flex items-start justify-between gap-3">
          <p>First time? Each report type comes from a different page in Flipkart Seller Hub. Match the file you have to the correct type below.</p>
          <button type="button" onClick={dismissHint} className="text-muted-foreground hover:text-foreground">Hide</button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {REPORTS.map(r => {
          const Icon = r.icon
          const isSelected = selected === r.type
          return (
            <button
              key={r.type}
              type="button"
              onClick={() => onSelect(r.type)}
              className={[
                'rounded-lg border p-4 text-left transition-colors',
                isSelected ? 'border-primary bg-primary/5' : 'hover:border-primary/50',
              ].join(' ')}
            >
              <Icon className="h-5 w-5 mb-2 text-primary" />
              <p className="font-medium text-sm">{r.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>
            </button>
          )
        })}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={onNext} disabled={!selected}>Next: Drop files →</Button>
      </div>
    </div>
  )
}
