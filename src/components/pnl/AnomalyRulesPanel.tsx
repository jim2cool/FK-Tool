'use client'

import { useState, useEffect, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2 } from 'lucide-react'

interface AnomalyRule {
  id: string
  name: string
  description: string
  enabled: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AnomalyRulesPanel({ open, onOpenChange }: Props) {
  const [rules, setRules] = useState<AnomalyRule[]>([])
  const [loading, setLoading] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false

    async function fetchRules() {
      setLoading(true)
      try {
        const res = await fetch('/api/pnl/anomaly-rules')
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setRules(data.rules ?? data)
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchRules()
    return () => { cancelled = true }
  }, [open])

  const handleToggle = useCallback(async (ruleId: string, enabled: boolean) => {
    // Optimistic update
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled } : r))
    setTogglingId(ruleId)

    try {
      const res = await fetch(`/api/pnl/anomaly-rules/${ruleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) {
        // Revert on failure
        setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled: !enabled } : r))
      }
    } catch {
      // Revert on error
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled: !enabled } : r))
    } finally {
      setTogglingId(null)
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Anomaly Detection Rules</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading rules...</span>
          </div>
        ) : rules.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No anomaly rules configured yet.
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-20 text-center">Enabled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="text-sm font-medium">{rule.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{rule.description}</TableCell>
                    <TableCell className="text-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={rule.enabled}
                        disabled={togglingId === rule.id}
                        onClick={() => handleToggle(rule.id, !rule.enabled)}
                        className={`
                          relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full
                          border-2 border-transparent transition-colors
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                          disabled:cursor-not-allowed disabled:opacity-50
                          ${rule.enabled ? 'bg-primary' : 'bg-input'}
                        `}
                      >
                        <span
                          className={`
                            pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform
                            ${rule.enabled ? 'translate-x-4' : 'translate-x-0'}
                          `}
                        />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
