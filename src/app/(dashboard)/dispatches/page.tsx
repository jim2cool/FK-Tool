'use client'

import { Truck } from 'lucide-react'

export default function DispatchesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Dispatches</h1>
        <p className="text-sm text-muted-foreground">
          Track daily dispatches, pending shipments, and delivery performance.
        </p>
      </div>
      <div className="rounded-lg border border-dashed p-12 text-center">
        <Truck className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
        <h2 className="text-lg font-semibold">Coming soon</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          This page will show your daily dispatch queue, pending shipments, delivery SLA tracking,
          and dispatch performance metrics. For now, dispatches are created automatically when you
          sort labels on the Labels page.
        </p>
      </div>
    </div>
  )
}
