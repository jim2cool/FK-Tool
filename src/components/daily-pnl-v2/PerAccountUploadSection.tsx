'use client'
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { UploadPanel } from '@/components/daily-pnl/UploadPanel'
import type { Platform } from '@/lib/daily-pnl/types'

interface Props {
  marketplaceAccountId: string
  accountName: string
  platform: Platform
  cogsLastUpdatedDays: number | null
  listingLastUpdatedDays: number | null
  cogsPresent: boolean
  listingPresent: boolean
  onAnyUploaded: () => void
}

export function PerAccountUploadSection(props: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <p className="font-medium text-sm">{props.accountName}</p>

      {/* Orders is the only required-per-day upload — always visible */}
      <UploadPanel
        marketplaceAccountId={props.marketplaceAccountId}
        platform={props.platform}
        onAnyUploaded={props.onAnyUploaded}
        onlyShow={['orders']}
      />

      {/* Listing + COGS — collapsed disclosure */}
      <button
        type="button"
        onClick={() => setShowAdvanced(s => !s)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Listing &amp; COGS
        {!props.listingPresent && <span className="text-destructive ml-2">(Listing missing)</span>}
        {!props.cogsPresent && <span className="text-destructive ml-2">(COGS missing)</span>}
        {props.listingPresent && props.listingLastUpdatedDays != null && (
          <span className="ml-2">· Listing {props.listingLastUpdatedDays}d old</span>
        )}
      </button>

      {showAdvanced && (
        <UploadPanel
          marketplaceAccountId={props.marketplaceAccountId}
          platform={props.platform}
          onAnyUploaded={props.onAnyUploaded}
          onlyShow={['listing', 'cogs']}
        />
      )}
    </div>
  )
}
