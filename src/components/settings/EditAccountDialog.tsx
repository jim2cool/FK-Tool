'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { MarketplaceAccount, Platform } from '@/types'

const PLATFORM_LABELS: Record<Platform, string> = {
  flipkart: 'Flipkart',
  amazon: 'Amazon India',
  d2c: 'D2C',
}

interface Props {
  account: MarketplaceAccount | null
  onClose: () => void
  onRenamed: () => void
}

const MAX_VISIBLE_HISTORY = 5

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export function EditAccountDialog({ account, onClose, onRenamed }: Props) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [recycleConfirm, setRecycleConfirm] = useState<{ conflicting: string; expected: string } | null>(null)

  useEffect(() => {
    if (account) {
      setName(account.account_name)
      setError(null)
      setSaving(false)
      setShowAllHistory(false)
      setRecycleConfirm(null)
    }
  }, [account])

  if (!account) return null

  const trimmedName = name.trim().replace(/\s+/g, ' ')
  const isDirty = trimmedName !== account.account_name && trimmedName.length > 0
  const canSave = isDirty && !saving

  const previous = (account.previous_names ?? []).slice().reverse()
  const historyToShow = showAllHistory ? previous : previous.slice(0, MAX_VISIBLE_HISTORY)

  async function attemptSave(forceRecycle = false) {
    if (!account) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/marketplace-accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: account.id,
          account_name: name,
          expected_current_name: account.account_name,
          force_recycle: forceRecycle || undefined,
        }),
      })

      const body = await res.json().catch(() => ({}))

      if (res.status === 200 && body.warning === 'name_recently_used_by_another_account') {
        setRecycleConfirm({
          conflicting: body.conflicting_account_name,
          expected: body.expected_current_name,
        })
        setSaving(false)
        return
      }

      if (!res.ok) {
        if (res.status === 409 && body.error === 'stale_edit') {
          setError(`This account was changed by someone else. Current name is now "${body.current_name}". Refresh and try again.`)
        } else if (res.status === 409 && body.error === 'name_already_in_use') {
          setError(`An account named "${body.account_name}" already exists on ${PLATFORM_LABELS[account.platform]}.`)
        } else {
          setError(body.error ?? 'Save failed. Please try again.')
        }
        setSaving(false)
        return
      }

      toast.success('Account renamed')
      onRenamed()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  function handleConfirmRecycle() {
    setRecycleConfirm(null)
    attemptSave(true)
  }

  return (
    <Dialog open={!!account} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Account</DialogTitle>
        </DialogHeader>

        {recycleConfirm ? (
          <div className="space-y-4 text-sm">
            <p>
              The name <span className="font-medium">{trimmedName}</span> was previously used by another account
              {' '}<span className="font-medium">{recycleConfirm.conflicting}</span>.
              Reusing it may make older reports ambiguous when matched by name.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRecycleConfirm(null)}>Go back</Button>
              <Button onClick={handleConfirmRecycle}>Use it anyway</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="account-name-input">Account name</Label>
              <Input
                id="account-name-input"
                autoFocus
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSave) attemptSave()
                  if (e.key === 'Escape') onClose()
                }}
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground">
                Old names are kept on record so historical reports stay traceable.
              </p>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Channel</Label>
              <p className="text-sm">{PLATFORM_LABELS[account.platform]} <span className="text-xs text-muted-foreground">(not editable)</span></p>
            </div>

            {previous.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Previously known as</Label>
                <ul className="text-sm space-y-1 max-h-40 overflow-y-auto" aria-label="Previous names for this account">
                  {historyToShow.map((p, i) => (
                    <li key={`${p.name}-${p.changed_at}-${i}`} className="text-muted-foreground">
                      • {p.name} <span className="text-xs">(until {fmtDate(p.changed_at)})</span>
                    </li>
                  ))}
                </ul>
                {previous.length > MAX_VISIBLE_HISTORY && !showAllHistory && (
                  <button
                    type="button"
                    className="text-xs text-primary underline"
                    onClick={() => setShowAllHistory(true)}
                  >
                    Show all ({previous.length})
                  </button>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button onClick={() => attemptSave()} disabled={!canSave}>
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : 'Save'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
