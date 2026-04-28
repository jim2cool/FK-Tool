'use client'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import type { MarketplaceAccount } from '@/types'

interface Props {
  accounts: MarketplaceAccount[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function ChannelAccountSelector({ accounts, selectedIds, onChange }: Props) {
  const flipkart = accounts.filter(a => a.platform === 'flipkart')

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id])
  }
  function selectAll() { onChange(flipkart.map(a => a.id)) }
  function clearAll() { onChange([]) }

  const triggerLabel = selectedIds.length === 0
    ? 'Select accounts'
    : flipkart.length > 0 && selectedIds.length === flipkart.length
      ? 'All accounts'
      : `${selectedIds.length} accounts`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-56 justify-between">
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-4 w-4 ml-2 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuItem onSelect={selectAll}>Select all</DropdownMenuItem>
        <DropdownMenuItem onSelect={clearAll}>Clear all</DropdownMenuItem>
        <DropdownMenuSeparator />
        {flipkart.map(a => (
          <DropdownMenuCheckboxItem
            key={a.id}
            checked={selectedIds.includes(a.id)}
            onCheckedChange={() => toggle(a.id)}
          >
            {a.account_name}
          </DropdownMenuCheckboxItem>
        ))}
        {flipkart.length === 0 && (
          <DropdownMenuItem disabled>No Flipkart accounts</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
