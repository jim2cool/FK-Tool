'use client'

import { RotateCcw } from 'lucide-react'

export default function ReturnsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Returns & Claims</h1>
        <p className="text-sm text-muted-foreground">
          Track returns (RTO/RVP), grade returned products, file claims, and recover your money.
        </p>
      </div>
      <div className="rounded-lg border border-dashed p-12 text-center">
        <RotateCcw className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
        <h2 className="text-lg font-semibold">Coming soon</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          This page will show return tracking with aging, RTO vs RVP breakdown,
          product grading (usable/damaged), claim eligibility detection, and guided
          claim filing with recovery tracking. For now, return data is imported via
          the P&L Import Data dialog and visible in the Orders page.
        </p>
      </div>
    </div>
  )
}
