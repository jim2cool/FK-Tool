'use client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { ChannelAccountSelector } from './ChannelAccountSelector'
import type { MarketplaceAccount, Platform } from '@/types'

interface Props {
  accounts: MarketplaceAccount[]
  channel: Platform
  selectedAccountIds: string[]
  dispatchFrom: string
  dispatchTo: string
  onChannelChange: (p: Platform) => void
  onAccountsChange: (ids: string[]) => void
  onDispatchFromChange: (s: string) => void
  onDispatchToChange: (s: string) => void
  onContinue: () => void
}

export function ConfigurationCard(props: Props) {
  const canContinue = props.selectedAccountIds.length > 0 && !!props.dispatchFrom && !!props.dispatchTo
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <h2 className="text-lg font-bold">Daily P&amp;L Estimator</h2>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Channel</Label>
          <Select value={props.channel} onValueChange={(v) => props.onChannelChange(v as Platform)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="flipkart">Flipkart</SelectItem>
              <SelectItem value="amazon" disabled>Amazon 🔜</SelectItem>
              <SelectItem value="d2c" disabled>D2C 🔜</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Accounts</Label>
          <ChannelAccountSelector
            accounts={props.accounts}
            selectedIds={props.selectedAccountIds}
            onChange={props.onAccountsChange}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs flex items-center gap-1">
            Dispatch date
            <InfoTooltip content="When the order was shipped from your warehouse — not when ordered or delivered." />
          </Label>
          <div className="flex gap-2">
            <Input type="date" value={props.dispatchFrom} onChange={(e) => props.onDispatchFromChange(e.target.value)} className="w-36" />
            <Input type="date" value={props.dispatchTo} onChange={(e) => props.onDispatchToChange(e.target.value)} className="w-36" />
          </div>
        </div>
        <Button onClick={props.onContinue} disabled={!canContinue}>Continue</Button>
      </div>
    </div>
  )
}
