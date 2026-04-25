'use client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { MarketplaceAccount, Platform } from '@/lib/daily-pnl/types'

const PLATFORMS: { value: Platform; label: string; supported: boolean }[] = [
  { value: 'flipkart', label: 'Flipkart', supported: true },
  { value: 'amazon',   label: 'Amazon',   supported: false },
  { value: 'd2c',      label: 'D2C',      supported: false },
]

interface Props {
  accounts: MarketplaceAccount[]
  platform: Platform
  selectedId: string | null
  onPlatformChange: (p: Platform) => void
  onSelect: (id: string) => void
}

export function ChannelAccountSelector({ accounts, platform, selectedId, onPlatformChange, onSelect }: Props) {
  const filtered = accounts.filter(a => a.platform === platform)

  return (
    <div className="flex gap-3 items-center flex-wrap">
      {/* Platform selector */}
      <div className="flex gap-1">
        {PLATFORMS.map(p => (
          <button
            key={p.value}
            onClick={() => onPlatformChange(p.value)}
            disabled={!p.supported}
            className={[
              'px-3 py-1.5 rounded-md text-sm font-medium border transition-colors',
              platform === p.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border text-muted-foreground hover:border-primary/50',
              !p.supported && 'opacity-40 cursor-not-allowed',
            ].join(' ')}
          >
            {p.label}
            {!p.supported && <span className="ml-1 text-xs opacity-70">🔜</span>}
          </button>
        ))}
      </div>

      {/* Account dropdown — filtered by platform */}
      {platform === 'flipkart' ? (
        filtered.length > 0 ? (
          <Select value={selectedId ?? ''} onValueChange={onSelect}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              {filtered.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">
            No Flipkart accounts found. Add one in <a href="/settings" className="underline">Settings</a>.
          </p>
        )
      ) : (
        <Badge variant="outline" className="text-muted-foreground">
          {PLATFORMS.find(p => p.value === platform)?.label} support coming soon
        </Badge>
      )}
    </div>
  )
}
