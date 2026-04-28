'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConfigurationCard } from '@/components/daily-pnl-v2/ConfigurationCard'
import { BenchmarkStatusCard } from '@/components/daily-pnl-v2/BenchmarkStatusCard'
import { PerAccountUploadSection } from '@/components/daily-pnl-v2/PerAccountUploadSection'
import { ResultsAccordion } from '@/components/daily-pnl-v2/ResultsAccordion'
import { EmptyState } from '@/components/daily-pnl-v2/EmptyState'
import { OrderDataFreshnessBanner } from '@/components/orders/OrderDataFreshnessBanner'
import type { MarketplaceAccount, Platform } from '@/types'
import type { BenchmarkStatusResponse, ResultsResponseV2 } from '@/lib/daily-pnl-v2/types'

const STORAGE_KEY = 'fk-tool:daily-pnl-v2:last-config'

function yesterday(): string {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export default function DailyPnlV2Page() {
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [channel, setChannel] = useState<Platform>('flipkart')
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [dispatchFrom, setDispatchFrom] = useState(yesterday())
  const [dispatchTo, setDispatchTo] = useState(yesterday())

  const [continued, setContinued] = useState(false)
  const [benchmarkStatus, setBenchmarkStatus] = useState<BenchmarkStatusResponse | null>(null)
  const [benchmarkLoading, setBenchmarkLoading] = useState(false)
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null)

  const [results, setResults] = useState<ResultsResponseV2 | null>(null)
  const [computing, setComputing] = useState(false)

  // Load accounts + restore last config from localStorage
  useEffect(() => {
    fetch('/api/marketplace-accounts')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load accounts')))
      .then((data: MarketplaceAccount[]) => {
        setAccounts(data ?? [])
        setAccountsLoaded(true)
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY)
          if (raw) {
            const last = JSON.parse(raw) as { channel?: Platform; accountIds?: string[]; from?: string; to?: string }
            if (last.channel) setChannel(last.channel)
            if (last.accountIds) {
              const stillExist = last.accountIds.filter(id => (data ?? []).some((a: MarketplaceAccount) => a.id === id))
              if (stillExist.length > 0) setSelectedAccountIds(stillExist)
            }
            if (last.from) setDispatchFrom(last.from)
            if (last.to) setDispatchTo(last.to)
          }
        } catch { /* ignore */ }
      })
      .catch(e => {
        toast.error((e as Error).message)
        setAccountsLoaded(true)
      })
  }, [])

  // Persist config on change
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        channel, accountIds: selectedAccountIds, from: dispatchFrom, to: dispatchTo,
      }))
    } catch { /* ignore */ }
  }, [channel, selectedAccountIds, dispatchFrom, dispatchTo])

  const loadBenchmarkStatus = useCallback(async () => {
    if (selectedAccountIds.length === 0) return
    setBenchmarkLoading(true)
    setBenchmarkError(null)
    try {
      const url = `/api/daily-pnl-v2/benchmark-status?marketplace_account_ids=${selectedAccountIds.join(',')}`
      const res = await fetch(url)
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      setBenchmarkStatus(await res.json())
    } catch (e) {
      setBenchmarkError((e as Error).message)
    } finally {
      setBenchmarkLoading(false)
    }
  }, [selectedAccountIds])

  const handleContinue = useCallback(async () => {
    setContinued(true)
    setResults(null)
    await loadBenchmarkStatus()
  }, [loadBenchmarkStatus])

  // Re-fetch benchmark status when config changes after Continue
  useEffect(() => {
    if (continued && selectedAccountIds.length > 0) {
      setResults(null)
      loadBenchmarkStatus()
    }
  }, [selectedAccountIds, dispatchFrom, dispatchTo]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleBulkImporterOpen() {
    window.location.href = '/pnl?intent=bulk-import'
  }

  const handleCompute = useCallback(async () => {
    setComputing(true)
    setResults(null)
    try {
      const url = `/api/daily-pnl-v2/results?marketplace_account_ids=${selectedAccountIds.join(',')}&from=${dispatchFrom}&to=${dispatchTo}`
      const res = await fetch(url)
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      setResults(await res.json())
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setComputing(false)
    }
  }, [selectedAccountIds, dispatchFrom, dispatchTo])

  const computeDisabled = useMemo(() => {
    if (computing) return true
    if (!benchmarkStatus) return true
    return !benchmarkStatus.per_account.some(a => a.cogs_present && a.listing_present)
  }, [benchmarkStatus, computing])

  const flipkartAccounts = accounts.filter(a => a.platform === 'flipkart')
  if (accountsLoaded && flipkartAccounts.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-bold">Daily P&amp;L Estimator</h1>
        <EmptyState />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <OrderDataFreshnessBanner onUploadClick={handleBulkImporterOpen} />

      <ConfigurationCard
        accounts={accounts}
        channel={channel}
        selectedAccountIds={selectedAccountIds}
        dispatchFrom={dispatchFrom}
        dispatchTo={dispatchTo}
        onChannelChange={setChannel}
        onAccountsChange={setSelectedAccountIds}
        onDispatchFromChange={setDispatchFrom}
        onDispatchToChange={setDispatchTo}
        onContinue={handleContinue}
      />

      {continued && (
        <BenchmarkStatusCard
          data={benchmarkStatus}
          loading={benchmarkLoading}
          error={benchmarkError}
          onRetry={loadBenchmarkStatus}
          onOpenBulkImporter={handleBulkImporterOpen}
        />
      )}

      {continued && benchmarkStatus && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Per-Account Uploads</h2>
          {benchmarkStatus.per_account.map(a => {
            const cogsAge = a.cogs_last_updated_at ? Math.floor((Date.now() - new Date(a.cogs_last_updated_at).getTime()) / 86400000) : null
            const listingAge = a.listing_last_updated_at ? Math.floor((Date.now() - new Date(a.listing_last_updated_at).getTime()) / 86400000) : null
            return (
              <PerAccountUploadSection
                key={a.marketplace_account_id}
                marketplaceAccountId={a.marketplace_account_id}
                accountName={a.account_name}
                platform={channel}
                cogsLastUpdatedDays={cogsAge}
                listingLastUpdatedDays={listingAge}
                cogsPresent={a.cogs_present}
                listingPresent={a.listing_present}
                onAnyUploaded={loadBenchmarkStatus}
              />
            )
          })}
        </div>
      )}

      {continued && benchmarkStatus && (
        <div className="sticky bottom-0 bg-background border-t py-3 flex justify-end">
          <Button onClick={handleCompute} disabled={computeDisabled}>
            {computing
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Computing…</>
              : 'Compute'}
          </Button>
        </div>
      )}

      {results && (
        <ResultsAccordion
          data={results}
          dispatchFrom={dispatchFrom}
          dispatchTo={dispatchTo}
        />
      )}
    </div>
  )
}
