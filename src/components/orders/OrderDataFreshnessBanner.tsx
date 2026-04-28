'use client'
import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DataFreshnessResponse } from '@/app/api/orders/data-freshness/route'

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Props {
  onUploadClick?: () => void
}

export function OrderDataFreshnessBanner({ onUploadClick }: Props) {
  const [data, setData] = useState<DataFreshnessResponse | null>(null)

  useEffect(() => {
    fetch('/api/orders/data-freshness')
      .then(r => r.ok ? r.json() : null)
      .then((d: DataFreshnessResponse | null) => setData(d))
      .catch(() => null)
  }, [])

  if (!data || !data.stale || data.in_flight_count === 0) return null

  const days = data.settled_through ? daysAgo(data.settled_through) : null

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
      <div className="flex-1 min-w-0">
        <span className="font-medium">Order statuses current through {data.settled_through ? fmt(data.settled_through) : 'unknown'}</span>
        <span className="text-amber-700">
          {days !== null ? ` (${days}d ago)` : ''} — {data.in_flight_count.toLocaleString()} orders placed after that are still in transit or return-pending in the DB.
          Re-upload a fresh export to get current statuses.
        </span>
      </div>
      {onUploadClick && (
        <Button size="sm" variant="outline" className="shrink-0 border-amber-300 text-amber-900 hover:bg-amber-100" onClick={onUploadClick}>
          <RefreshCw className="h-3 w-3 mr-1" />
          Upload
        </Button>
      )}
    </div>
  )
}
