'use client'
import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
import { useUserAccess } from '@/hooks/use-user-access'
import { TeamSection } from '@/components/settings/TeamSection'
import { EditAccountDialog } from '@/components/settings/EditAccountDialog'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import type { Warehouse, MarketplaceAccount, AccountWarehouseMapping, Platform } from '@/types'

const PLATFORMS: Platform[] = ['flipkart', 'amazon', 'd2c']
const PLATFORM_LABELS: Record<Platform, string> = {
  flipkart: 'Flipkart',
  amazon: 'Amazon India',
  d2c: 'D2C',
}

export default function SettingsPage() {
  const { isOwner } = useUserAccess()
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [accounts, setAccounts] = useState<MarketplaceAccount[]>([])
  const [mappings, setMappings] = useState<Set<string>>(new Set())
  const [whName, setWhName] = useState('')
  const [whLocation, setWhLocation] = useState('')
  const [acctName, setAcctName] = useState('')
  const [acctPlatform, setAcctPlatform] = useState<Platform>('flipkart')
  const [loading, setLoading] = useState(false)
  const [editingAccount, setEditingAccount] = useState<MarketplaceAccount | null>(null)
  const [archivedAccounts, setArchivedAccounts] = useState<MarketplaceAccount[]>([])
  const [showArchived, setShowArchived] = useState(false)

  const mappingKey = (accountId: string, warehouseId: string) => `${accountId}:${warehouseId}`

  const loadWarehouses = useCallback(async () => {
    const res = await fetch('/api/warehouses')
    if (res.ok) setWarehouses(await res.json())
  }, [])

  const loadAccounts = useCallback(async () => {
    const res = await fetch('/api/marketplace-accounts')
    if (res.ok) setAccounts(await res.json())
  }, [])

  const loadArchivedAccounts = useCallback(async () => {
    const res = await fetch('/api/marketplace-accounts?include_archived=true')
    if (res.ok) {
      const all: MarketplaceAccount[] = await res.json()
      setArchivedAccounts(all.filter(a => a.archived_at !== null))
    }
  }, [])

  const loadMappings = useCallback(async () => {
    const res = await fetch('/api/account-warehouse-mappings')
    if (res.ok) {
      const data: AccountWarehouseMapping[] = await res.json()
      setMappings(new Set(data.map(m => mappingKey(m.marketplace_account_id, m.warehouse_id))))
    }
  }, [])

  useEffect(() => {
    loadWarehouses()
    loadAccounts()
    loadArchivedAccounts()
    loadMappings()
  }, [loadWarehouses, loadAccounts, loadArchivedAccounts, loadMappings])

  async function toggleMapping(accountId: string, warehouseId: string) {
    const key = mappingKey(accountId, warehouseId)
    const exists = mappings.has(key)

    // Optimistic update
    setMappings(prev => {
      const next = new Set(prev)
      exists ? next.delete(key) : next.add(key)
      return next
    })

    const res = await fetch('/api/account-warehouse-mappings', {
      method: exists ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketplace_account_id: accountId, warehouse_id: warehouseId }),
    })
    if (!res.ok) {
      // Revert on failure
      setMappings(prev => {
        const next = new Set(prev)
        exists ? next.add(key) : next.delete(key)
        return next
      })
      toast.error('Failed to update mapping')
    }
  }

  async function addWarehouse(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/warehouses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: whName, location: whLocation || null }),
    })
    if (res.ok) {
      toast.success('Warehouse added')
      setWhName('')
      setWhLocation('')
      loadWarehouses()
    } else {
      const { error } = await res.json()
      toast.error(error)
    }
    setLoading(false)
  }

  async function deleteWarehouse(id: string) {
    const res = await fetch('/api/warehouses', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      toast.success('Warehouse removed')
      loadWarehouses()
      loadMappings()
    }
  }

  async function addAccount(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/marketplace-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: acctPlatform, account_name: acctName }),
    })
    if (res.ok) {
      toast.success('Account added')
      setAcctName('')
      loadAccounts()
    } else {
      const body = await res.json().catch(() => ({}))
      if (res.status === 409 && body.error === 'name_already_in_use') {
        toast.error(`An account named "${body.account_name}" already exists on ${PLATFORM_LABELS[acctPlatform]}.`)
      } else {
        toast.error(body.error ?? 'Failed to add account')
      }
    }
    setLoading(false)
  }

  async function deleteAccount(id: string) {
    const res = await fetch('/api/marketplace-accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) {
      if (body.archived) {
        toast.success('Account archived — historical data preserved. Restore via the Archived section.')
      } else {
        toast.success('Account removed')
      }
      loadAccounts()
      loadArchivedAccounts()
      loadMappings()
    } else {
      toast.error(body.error ?? 'Failed to remove account')
    }
  }

  async function restoreAccount(acct: MarketplaceAccount) {
    if (!window.confirm(`Restore account "${acct.account_name}"? It will reappear in account selectors across the app.`)) {
      return
    }
    const res = await fetch('/api/marketplace-accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: acct.id, action: 'restore' }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) {
      toast.success('Account restored')
      loadAccounts()
      loadArchivedAccounts()
    } else if (res.status === 409 && body.error === 'name_in_use_by_active_account') {
      toast.error(`Cannot restore — another active account ("${body.conflicting_account_name}") uses this name. Rename it first.`)
    } else {
      toast.error(body.error ?? 'Failed to restore account')
    }
  }

  async function forceDeleteAccount(acct: MarketplaceAccount) {
    const confirmed = window.confirm(
      `Permanently delete "${acct.account_name}"?\n\nThis will erase ALL associated orders, P&L records, SKU mappings, and dispatch history. This cannot be undone.`
    )
    if (!confirmed) return

    const res = await fetch('/api/marketplace-accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: acct.id, force: true }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) {
      toast.success(`"${acct.account_name}" permanently deleted`)
      loadArchivedAccounts()
      loadMappings()
    } else {
      toast.error(body.error ?? 'Failed to permanently delete account')
    }
  }

  const showGrid = accounts.length > 0 && warehouses.length > 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Settings</h2>
        <p className="text-muted-foreground text-sm">Manage your workspace, team, and accounts</p>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          {isOwner && <TabsTrigger value="team">Team</TabsTrigger>}
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <div className="max-w-2xl space-y-8">

      {/* Warehouses */}
      <Card>
        <CardHeader>
          <CardTitle>Warehouses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {warehouses.length === 0 && (
            <p className="text-sm text-muted-foreground">No warehouses yet.</p>
          )}
          {warehouses.map(wh => (
            <div key={wh.id} className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium">{wh.name}</p>
                {wh.location && <p className="text-xs text-muted-foreground">{wh.location}</p>}
              </div>
              <Button variant="ghost" size="sm" className="text-destructive"
                onClick={() => deleteWarehouse(wh.id)}>Remove</Button>
            </div>
          ))}
          <Separator />
          <form onSubmit={addWarehouse} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={whName} onChange={e => setWhName(e.target.value)}
                  placeholder="e.g. Delhi WH" required />
              </div>
              <div className="space-y-1">
                <Label>Location (optional)</Label>
                <Input value={whLocation} onChange={e => setWhLocation(e.target.value)}
                  placeholder="e.g. New Delhi" />
              </div>
            </div>
            <Button type="submit" size="sm" disabled={loading}>Add Warehouse</Button>
          </form>
        </CardContent>
      </Card>

      {/* Marketplace Accounts */}
      <Card>
        <CardHeader>
          <CardTitle>Marketplace Accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">No accounts yet.</p>
          )}
          {accounts.map(acct => {
            const previousCount = (acct.previous_names ?? []).length
            const mostRecentPrev = previousCount > 0 ? acct.previous_names[acct.previous_names.length - 1] : null
            const tooltipContent = mostRecentPrev
              ? `Previously: ${mostRecentPrev.name}${previousCount > 1 ? ` (+${previousCount - 1} earlier)` : ''}`
              : ''
            return (
              <div key={acct.id} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{PLATFORM_LABELS[acct.platform]}</Badge>
                  <span className="text-sm">{acct.account_name}</span>
                  {tooltipContent && <InfoTooltip content={tooltipContent} />}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingAccount(acct)}
                    aria-label={`Rename ${acct.account_name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => deleteAccount(acct.id)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            )
          })}
          {archivedAccounts.length > 0 && (
            <div className="border-t pt-3 mt-3">
              <button
                type="button"
                onClick={() => setShowArchived(s => !s)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {showArchived ? '▼' : '▶'} Archived accounts ({archivedAccounts.length})
              </button>
              {showArchived && (
                <ul className="mt-2 space-y-1">
                  {archivedAccounts.map(acct => (
                    <li key={acct.id} className="flex items-center justify-between py-1 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Badge variant="outline" className="opacity-70">{PLATFORM_LABELS[acct.platform]}</Badge>
                        <span>{acct.account_name}</span>
                        {acct.archived_at && (
                          <span className="text-xs">· Archived {new Date(acct.archived_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => restoreAccount(acct)}>Restore</Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => forceDeleteAccount(acct)}
                        >
                          Delete permanently
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Separator />
          <form onSubmit={addAccount} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Platform</Label>
                <select
                  value={acctPlatform}
                  onChange={e => setAcctPlatform(e.target.value as Platform)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  {PLATFORMS.map(p => (
                    <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Account name</Label>
                <Input value={acctName} onChange={e => setAcctName(e.target.value)}
                  placeholder="e.g. FK Main" required />
              </div>
            </div>
            <Button type="submit" size="sm" disabled={loading}>Add Account</Button>
          </form>
        </CardContent>
      </Card>

      {/* Account → Warehouse mapping grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Account → Warehouse
            <InfoTooltip content="Tick which warehouse(s) each account ships from. The master catalog uses this to show warehouse data for all mapped SKUs." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!showGrid ? (
            <p className="text-sm text-muted-foreground">
              Add at least one account and one warehouse above to configure mappings.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left font-medium text-muted-foreground pb-3 pr-6">Account</th>
                    {warehouses.map(wh => (
                      <th key={wh.id} className="text-center font-medium text-muted-foreground pb-3 px-4 whitespace-nowrap">
                        {wh.name}
                        {wh.location && <div className="text-xs font-normal">{wh.location}</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {accounts.map(acct => (
                    <tr key={acct.id}>
                      <td className="py-3 pr-6">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">{PLATFORM_LABELS[acct.platform]}</Badge>
                          <span>{acct.account_name}</span>
                        </div>
                      </td>
                      {warehouses.map(wh => (
                        <td key={wh.id} className="text-center py-3 px-4">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
                            checked={mappings.has(mappingKey(acct.id, wh.id))}
                            onChange={() => toggleMapping(acct.id, wh.id)}
                            aria-label={`${acct.account_name} ships from ${wh.name}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

          </div>
        </TabsContent>

        {isOwner && (
          <TabsContent value="team" className="mt-4">
            <TeamSection />
          </TabsContent>
        )}
      </Tabs>

      <EditAccountDialog
        account={editingAccount}
        onClose={() => setEditingAccount(null)}
        onRenamed={() => loadAccounts()}
      />
    </div>
  )
}
