'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMemo } from 'react'
import { LayoutDashboard, Package, ShoppingCart, Receipt, Box, Tags, Calculator, CalendarClock, Upload, BarChart3, Settings, ClipboardList, Truck, RotateCcw, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUserAccess } from '@/hooks/use-user-access'

type NavEntry =
  | { type: 'link'; href: string; label: string; icon: React.ComponentType<{ className?: string }> }
  | { type: 'separator' }

const navItems: NavEntry[] = [
  { type: 'link', href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { type: 'link', href: '/pnl', label: 'Profit & Loss', icon: BarChart3 },
  { type: 'link', href: '/orders-view', label: 'Orders', icon: ClipboardList },
  { type: 'link', href: '/dispatches', label: 'Dispatches', icon: Truck },
  { type: 'link', href: '/returns', label: 'Returns & Claims', icon: RotateCcw },
  { type: 'link', href: '/labels', label: 'Labels', icon: Tags },
  { type: 'link', href: '/daily-pnl', label: 'Daily P&L', icon: CalendarClock },
  { type: 'link', href: '/daily-pnl-v2', label: 'Daily P&L v2 (beta)', icon: Sparkles },
  { type: 'separator' },
  { type: 'link', href: '/catalog', label: 'Master Catalog', icon: Package },
  { type: 'link', href: '/purchases', label: 'Purchases', icon: ShoppingCart },
  { type: 'link', href: '/invoices', label: 'Invoices', icon: Receipt },
  { type: 'link', href: '/packaging', label: 'Packaging', icon: Box },
  { type: 'link', href: '/cogs', label: 'COGS', icon: Calculator },
  { type: 'link', href: '/imports', label: 'Import Data', icon: Upload },
  { type: 'link', href: '/settings', label: 'Settings', icon: Settings },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { canAccess, loading } = useUserAccess()

  // Filter nav items by page access, then clean up stray separators
  const visibleItems = useMemo(() => {
    if (loading) return navItems // show all while loading (middleware protects)

    const filtered = navItems.filter(item => {
      if (item.type === 'separator') return true
      const slug = item.href.slice(1) // strip leading /
      return canAccess(slug)
    })

    // Remove leading, trailing, and consecutive separators
    return filtered.filter((item, i, arr) => {
      if (item.type !== 'separator') return true
      if (i === 0 || i === arr.length - 1) return false
      return arr[i - 1]?.type !== 'separator'
    })
  }, [canAccess, loading])

  return (
    <aside className="w-56 min-h-screen bg-sidebar border-r flex flex-col">
      <div className="px-4 py-5 border-b">
        <h1 className="font-bold text-lg tracking-tight">FK Tool</h1>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {visibleItems.map((item, i) => {
          if (item.type === 'separator') {
            return <div key={`sep-${i}`} className="my-2 border-t border-border" />
          }
          const { href, label, icon: Icon } = item
          return (
            <Link key={href} href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                pathname === href
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}>
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
