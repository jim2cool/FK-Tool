'use client'
import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RefreshCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ChannelAccountSelector } from '@/components/daily-pnl/ChannelAccountSelector'
import { UploadPanel } from '@/components/daily-pnl/UploadPanel'
import { ResultsTabs } from '@/components/daily-pnl/ResultsTabs'
import type { MarketplaceAccount, Platform, ResultsResponse } from '@/lib/daily-pnl/types'

function yesterday() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export default function DailyPnlPage() {
  const [accounts, setAccounts]     = useState<MarketplaceAccount[]>([])
  const [platform, setPlatform]     = useState<Platform>('flipkart')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [from, setFrom]             = useState(yesterday)
  const [to, setTo]                 = useState(yesterday)
  const [results, setResults]       = useState<ResultsResponse | null>(null)
  const [loading, setLoading]       = useState(false)

  useEffect(() => {
    // Use the existing marketplace-accounts endpoint — same one used in Settings
    fetch('/api/marketplace-accounts')
      .then(r => r.json())
      .then((data: MarketplaceAccount[]) => {
        setAccounts(data ?? [])
        // Auto-select first Flipkart account
        const first = (data ?? []).find(a => a.platform === 'flipkart')
        if (first) setSelectedId(first.id)
      })
      .catch(() => toast.error('Failed to load accounts'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When platform changes, reset selected account to first account on that platform
  function handlePlatformChange(p: Platform) {
    setPlatform(p)
    setSelectedId(null)
    setResults(null)
    const first = accounts.find(a => a.platform === p)
    if (first) setSelectedId(first.id)
  }

  const compute = useCallback(async () => {
    if (!selectedId) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/daily-pnl/results?marketplace_account_id=${selectedId}&from=${from}&to=${to}`
      )
      if (!res.ok) throw new Error((await res.json()).error)
      setResults(await res.json())
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [selectedId, from, to])

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold">Daily P&L Estimator</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload channel exports for a seller account and get estimated P&L per master product for any dispatch date range.
          Uses 60–90 days of P&L History to estimate delivery rates and return costs.
        </p>
      </div>

      {/* Channel + Account + Date range */}
      <div className="flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Channel & Account</Label>
          <ChannelAccountSelector
            accounts={accounts}
            platform={platform}
            selectedId={selectedId}
            onPlatformChange={handlePlatformChange}
            onSelect={id => { setSelectedId(id); setResults(null) }}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={from} onChange={e => { setFrom(e.target.value); setResults(null) }} className="w-36" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={to} onChange={e => { setTo(e.target.value); setResults(null) }} className="w-36" />
        </div>
        <Button onClick={compute} disabled={!selectedId || platform !== 'flipkart' || loading}>
          {loading
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Computing…</>
            : <><RefreshCw className="h-4 w-4 mr-2" />Compute</>}
        </Button>
      </div>

      {/* Upload panel */}
      {selectedId && (
        <div className="space-y-2">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Upload Reports</h2>
          <UploadPanel
            marketplaceAccountId={selectedId}
            platform={platform}
            onAnyUploaded={() => setResults(null)}
          />
        </div>
      )}

      {/* Empty state */}
      {!selectedId && (
        <div className="border rounded-lg p-12 text-center text-muted-foreground">
          <p className="text-lg font-medium">Select a channel and account to get started</p>
          <p className="text-sm mt-1">
            Accounts are managed in <a href="/settings" className="underline">Settings</a>.
            Each account corresponds to one seller profile (e.g. NuvioShop, NuvioCentral).
          </p>
        </div>
      )}
      {selectedId && !results && !loading && (
        <div className="border rounded-lg p-12 text-center text-muted-foreground">
          <p className="text-lg font-medium">Upload your reports, then click Compute</p>
          <p className="text-sm mt-1">
            COGS and Listing replace previous uploads. Orders and P&L History are appended with deduplication.
          </p>
        </div>
      )}

      {/* Results */}
      {results && <ResultsTabs data={results} from={from} to={to} />}
    </div>
  )
}
