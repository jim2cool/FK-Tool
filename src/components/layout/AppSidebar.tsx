'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Package, ShoppingCart, Receipt, Box, Calculator, Upload, BarChart3, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/catalog', label: 'Master Catalog', icon: Package },
  { href: '/purchases', label: 'Purchases', icon: ShoppingCart },
  { href: '/invoices', label: 'Invoices', icon: Receipt },
  { href: '/packaging', label: 'Packaging', icon: Box },
  { href: '/cogs', label: 'COGS', icon: Calculator },
  { href: '/imports', label: 'Import Data', icon: Upload },
  { href: '/inventory', label: 'Inventory & P&L', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function AppSidebar() {
  const pathname = usePathname()
  return (
    <aside className="w-56 min-h-screen bg-sidebar border-r flex flex-col">
      <div className="px-4 py-5 border-b">
        <h1 className="font-bold text-lg tracking-tight">FK Tool</h1>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
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
        ))}
      </nav>
    </aside>
  )
}
