'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table'
import { toast } from 'sonner'
import { Copy, Plus, Trash2, Loader2 } from 'lucide-react'

const CATEGORIES = [
  { value: 'salary', label: 'Salary' },
  { value: 'rent', label: 'Rent' },
  { value: 'software', label: 'Software' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'other', label: 'Other' },
] as const

type OverheadItem = {
  id?: string
  category: string
  name: string
  amount: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  month: string
  onSaved: () => void
}

const formatINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

function getMonthOptions() {
  const options: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = 5; i >= -1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
    options.push({ value, label })
  }
  return options
}

function getPreviousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function OverheadsDialog({ open, onOpenChange, month, onSaved }: Props) {
  const [selectedMonth, setSelectedMonth] = useState(month)
  const [items, setItems] = useState<OverheadItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)

  const monthOptions = getMonthOptions()

  const fetchOverheads = useCallback(async (m: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/pnl/overheads?month=${m}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setItems(
        (data.overheads ?? []).map((o: { id: string; category: string; name: string; amount: number }) => ({
          id: o.id,
          category: o.category,
          name: o.name,
          amount: Number(o.amount),
        }))
      )
    } catch {
      toast.error('Failed to load overheads')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setSelectedMonth(month)
      fetchOverheads(month)
    }
  }, [open, month, fetchOverheads])

  const handleMonthChange = (m: string) => {
    setSelectedMonth(m)
    fetchOverheads(m)
  }

  const total = items.reduce((s, i) => s + (Number(i.amount) || 0), 0)

  const addItem = () => {
    setItems(prev => [...prev, { category: 'other', name: '', amount: 0 }])
  }

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, field: keyof OverheadItem, value: string | number) => {
    setItems(prev => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)))
  }

  const handleSave = async () => {
    const valid = items.every(i => i.name.trim() && i.amount > 0)
    if (!valid) {
      toast.error('Every item needs a name and amount greater than 0')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/pnl/overheads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth, items }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Save failed')
      }
      toast.success('Overheads saved')
      onSaved()
      onOpenChange(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = async () => {
    const prevMonth = getPreviousMonth(selectedMonth)
    setCopying(true)
    try {
      const res = await fetch('/api/pnl/overheads/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceMonth: prevMonth, targetMonth: selectedMonth }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Copy failed')
      }
      toast.success(`Copied overheads from ${prevMonth}`)
      fetchOverheads(selectedMonth)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Copy failed')
    } finally {
      setCopying(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Monthly Overheads</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Month selector + copy button */}
          <div className="flex items-center gap-3">
            <Select value={selectedMonth} onValueChange={handleMonthChange}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map(o => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={copying || items.length > 0}
              title={items.length > 0 ? 'Clear current items first' : 'Copy from previous month'}
            >
              {copying ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
              Copy prev month
            </Button>
          </div>

          {/* Items table */}
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[130px]">Category</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[120px] text-right">Amount</TableHead>
                    <TableHead className="w-[40px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                        No overhead items yet. Add one below or copy from the previous month.
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item, idx) => (
                      <TableRow key={item.id ?? `new-${idx}`}>
                        <TableCell className="p-1">
                          <Select
                            value={item.category}
                            onValueChange={v => updateItem(idx, 'category', v)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CATEGORIES.map(c => (
                                <SelectItem key={c.value} value={c.value}>
                                  {c.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="p-1">
                          <Input
                            className="h-8 text-sm"
                            placeholder="e.g. Team CTC"
                            value={item.name}
                            onChange={e => updateItem(idx, 'name', e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="p-1">
                          <Input
                            className="h-8 text-sm text-right"
                            type="number"
                            min={0}
                            step={100}
                            value={item.amount || ''}
                            onChange={e => updateItem(idx, 'amount', parseFloat(e.target.value) || 0)}
                          />
                        </TableCell>
                        <TableCell className="p-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeItem(idx)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {items.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={2} className="font-semibold">
                        Total
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatINR(total)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>

              <Button variant="outline" size="sm" onClick={addItem} className="w-full">
                <Plus className="h-4 w-4 mr-1" /> Add Item
              </Button>

              <Button className="w-full" onClick={handleSave} disabled={saving || items.length === 0}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Save Overheads
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
