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
import { useUserAccess } from '@/hooks/use-user-access'
import { TeamSection } from '@/components/settings/TeamSection'
import type { Warehouse, MarketplaceAccount, Platform } from '@/types'

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
  const [whName, setWhName] = useState('')
  const [whLocation, setWhLocation] = useState('')
  const [acctName, setAcctName] = useState('')
  const [acctPlatform, setAcctPlatform] = useState<Platform>('flipkart')
  const [loading, setLoading] = useState(false)

  const loadWarehouses = useCallback(async () => {
    const res = await fetch('/api/warehouses')
    if (res.ok) setWarehouses(await res.json())
  }, [])

  const loadAccounts = useCallback(async () => {
    const res = await fetch('/api/marketplace-accounts')
    if (res.ok) setAccounts(await res.json())
  }, [])

  useEffect(() => {
    loadWarehouses()
    loadAccounts()
  }, [loadWarehouses, loadAccounts])

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
      const { error } = await res.json()
      toast.error(error)
    }
    setLoading(false)
  }

  async function deleteAccount(id: string) {
    const res = await fetch('/api/marketplace-accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      toast.success('Account removed')
      loadAccounts()
    }
  }

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
          {accounts.map(acct => (
            <div key={acct.id} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{PLATFORM_LABELS[acct.platform]}</Badge>
                <span className="text-sm">{acct.account_name}</span>
              </div>
              <Button variant="ghost" size="sm" className="text-destructive"
                onClick={() => deleteAccount(acct.id)}>Remove</Button>
            </div>
          ))}
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

          </div>
        </TabsContent>

        {isOwner && (
          <TabsContent value="team" className="mt-4">
            <TeamSection />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
