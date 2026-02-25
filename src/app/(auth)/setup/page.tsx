'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

export default function SetupPage() {
  const router = useRouter()
  const [tenantName, setTenantName] = useState('')
  const [warehouseName, setWarehouseName] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantName, warehouseName }),
    })
    if (res.ok) {
      router.push('/dashboard')
      router.refresh()
    } else {
      const { error } = await res.json()
      toast.error(error)
    }
    setLoading(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up your workspace</CardTitle>
        <p className="text-sm text-muted-foreground">One-time setup for your team</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSetup} className="space-y-4">
          <div className="space-y-1">
            <Label>Business / Brand name</Label>
            <Input value={tenantName} onChange={e => setTenantName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label>First warehouse name</Label>
            <Input value={warehouseName} onChange={e => setWarehouseName(e.target.value)}
              placeholder="e.g. Delhi WH" required />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Setting up...' : 'Complete setup'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
