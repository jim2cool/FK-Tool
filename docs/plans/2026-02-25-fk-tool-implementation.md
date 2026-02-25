# FK Tool — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build FK Tool Phase 1 — a web app that replaces the manual inventory and settlement tracking workflow for Flipkart (primary), Amazon India, and D2C channels.

**Architecture:** Modular monolith — Next.js App Router (frontend + API routes) + Supabase (PostgreSQL, Auth, Storage, pg_cron). Connector abstraction layer separates business logic from data source (CSV today, API later). Multi-tenant from day one.

**Tech Stack:** Next.js 15, TypeScript, Supabase, Tailwind CSS, shadcn/ui, xlsx, papaparse, recharts, zod, react-dropzone, date-fns

**Design doc:** `docs/plans/2026-02-25-fk-tool-design.md`

---

## Phase 0: Project Setup

### Task 0.1: Scaffold Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`

**Step 1: Initialise project**
```bash
cd /c/Users/shash/Documents/FK-Tool
npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*" --no-git
```
When prompted: Yes to App Router, No to Turbopack (for compatibility).

**Step 2: Install dependencies**
```bash
npm install @supabase/supabase-js @supabase/ssr
npm install xlsx papaparse date-fns zod recharts react-dropzone
npm install @types/papaparse --save-dev
```

**Step 3: Install shadcn/ui**
```bash
npx shadcn@latest init
```
Choose: Default style, Neutral base color, yes to CSS variables.

**Step 4: Add core shadcn components**
```bash
npx shadcn@latest add button input label card table badge dialog sheet sidebar toast sonner form select separator skeleton
```

**Step 5: Verify dev server starts**
```bash
npm run dev
```
Expected: Server starts at http://localhost:3000, default Next.js page loads.

**Step 6: Commit**
```bash
git init
git add .
git commit -m "chore: scaffold Next.js project with dependencies"
```

---

### Task 0.2: Configure Supabase client

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/middleware.ts`
- Create: `.env.local`

**Step 1: Create `.env.local`**
```bash
NEXT_PUBLIC_SUPABASE_URL=https://aorcopafrixqlbgckrpu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<get from Supabase dashboard>
SUPABASE_SERVICE_ROLE_KEY=<get from Supabase dashboard>
```
Get keys from: Supabase Dashboard → FK-Tool project → Settings → API.

**Step 2: Create browser client**
```typescript
// src/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

**Step 3: Create server client**
```typescript
// src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
```

**Step 4: Create middleware**
```typescript
// src/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isAuthRoute = request.nextUrl.pathname.startsWith('/login')
  const isApiRoute = request.nextUrl.pathname.startsWith('/api')

  if (!user && !isAuthRoute && !isApiRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

**Step 5: Commit**
```bash
git add src/lib/supabase/ src/middleware.ts .env.local
git commit -m "chore: configure Supabase client, server, middleware"
```

---

### Task 0.3: Create shared TypeScript types

**Files:**
- Create: `src/types/database.ts`
- Create: `src/types/index.ts`

**Step 1: Write database types**
```typescript
// src/types/database.ts
export type Platform = 'flipkart' | 'amazon' | 'd2c'
export type ConnectorMode = 'csv' | 'api'
export type OrderStatus = 'pending' | 'dispatched' | 'delivered' | 'returned' | 'cancelled'
export type ReturnType = 'customer' | 'logistics' | 'cancellation'
export type ImportStatus = 'pending' | 'processing' | 'complete' | 'failed'
export type ReportType =
  | 'dispatch_report'
  | 'listings_settlement'
  | 'historical_orders'
  | 'sku_mapping'
  | 'procurement'

export interface Tenant {
  id: string
  name: string
  created_at: string
}

export interface Warehouse {
  id: string
  tenant_id: string
  name: string
  location: string | null
  created_at: string
}

export interface MarketplaceAccount {
  id: string
  tenant_id: string
  platform: Platform
  account_name: string
  mode: ConnectorMode
  created_at: string
}

export interface MasterSku {
  id: string
  tenant_id: string
  name: string
  description: string | null
  created_at: string
}

export interface SkuMapping {
  id: string
  tenant_id: string
  master_sku_id: string
  platform: Platform
  platform_sku: string
  marketplace_account_id: string | null
  created_at: string
}

export interface Purchase {
  id: string
  tenant_id: string
  master_sku_id: string
  warehouse_id: string
  quantity: number
  unit_cost: number
  packaging_cost: number
  other_cost: number
  total_cogs: number
  supplier: string | null
  purchase_date: string
  received_date: string | null
  created_at: string
}

export interface Dispatch {
  id: string
  tenant_id: string
  master_sku_id: string
  warehouse_id: string
  marketplace_account_id: string | null
  order_id: string
  platform_sku: string | null
  quantity: number
  dispatch_date: string
  created_at: string
}

export interface Order {
  id: string
  tenant_id: string
  platform_order_id: string
  master_sku_id: string | null
  marketplace_account_id: string | null
  quantity: number
  sale_price: number
  order_date: string
  status: OrderStatus
  created_at: string
}

export interface OrderFinancial {
  id: string
  tenant_id: string
  order_id: string
  sale_price: number
  commission_amount: number
  commission_rate: number
  logistics_cost: number
  other_deductions: number
  projected_settlement: number
  actual_settlement: number | null
  settlement_variance: number | null
  created_at: string
}

export interface Return {
  id: string
  tenant_id: string
  order_id: string | null
  master_sku_id: string | null
  warehouse_id: string | null
  return_type: ReturnType
  causes_deduction: boolean
  deduction_amount: number
  return_date: string
  created_at: string
}

export interface SkuFinancialProfile {
  id: string
  tenant_id: string
  master_sku_id: string
  platform: Platform
  avg_commission_rate: number
  avg_logistics_cost: number
  avg_return_rate: number
  avg_net_settlement_pct: number
  sample_size: number
  last_computed_at: string
  created_at: string
}

export interface Import {
  id: string
  tenant_id: string
  file_name: string
  file_path: string
  detected_marketplace: Platform | null
  detected_report_type: ReportType | null
  status: ImportStatus
  rows_processed: number
  rows_failed: number
  error_log: string | null
  imported_by: string | null
  created_at: string
}
```

**Step 2: Create barrel export**
```typescript
// src/types/index.ts
export * from './database'
```

**Step 3: Commit**
```bash
git add src/types/
git commit -m "chore: add shared TypeScript types"
```

---

## Phase 1: Foundation (Module 1)

### Task 1.1: Database migrations — Foundation tables

**Step 1: Apply tenants + users migration**

Run via Supabase MCP (project_id: `aorcopafrixqlbgckrpu`):
```sql
-- Migration: create_foundation_tables
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE marketplace_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('flipkart', 'amazon', 'd2c')),
  account_name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'csv' CHECK (mode IN ('csv', 'api')),
  api_key_enc TEXT,
  api_secret_enc TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own tenant" ON tenants
  FOR ALL USING (id IN (
    SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users see own profile" ON user_profiles
  FOR ALL USING (id = auth.uid());

CREATE POLICY "Tenant-scoped warehouses" ON warehouses
  FOR ALL USING (tenant_id IN (
    SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Tenant-scoped marketplace_accounts" ON marketplace_accounts
  FOR ALL USING (tenant_id IN (
    SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
  ));
```

**Step 2: Verify tables exist**
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```
Expected: tenants, user_profiles, warehouses, marketplace_accounts

---

### Task 1.2: Auth — Login page

**Files:**
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/layout.tsx`

**Step 1: Create auth layout**
```typescript
// src/app/(auth)/layout.tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}
```

**Step 2: Create login page**
```typescript
// src/app/(auth)/login/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      toast.error(error.message)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">FK Tool</CardTitle>
        <p className="text-sm text-muted-foreground">Sign in to your account</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email}
              onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password}
              onChange={e => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

**Step 3: Add Toaster to root layout**
```typescript
// src/app/layout.tsx — add inside <body>:
import { Toaster } from '@/components/ui/sonner'
// ...
<Toaster />
```

**Step 4: Test manually**
- Navigate to http://localhost:3000/login
- Confirm login form renders
- Create a test user in Supabase Dashboard → Authentication → Users → Add user
- Sign in with test user → should redirect to /dashboard (404 is fine for now)

**Step 5: Commit**
```bash
git add src/app/(auth)/
git commit -m "feat(auth): add login page with Supabase Auth"
```

---

### Task 1.3: First-time setup — Tenant + profile creation

**Files:**
- Create: `src/app/(auth)/setup/page.tsx`
- Create: `src/app/api/setup/route.ts`

**Step 1: Create setup API route**
```typescript
// src/app/api/setup/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check if profile already exists
  const { data: existing } = await supabase
    .from('user_profiles').select('id').eq('id', user.id).single()
  if (existing) return NextResponse.json({ error: 'Already set up' }, { status: 400 })

  const { tenantName, warehouseName } = await request.json()

  // Create tenant
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants').insert({ name: tenantName }).select().single()
  if (tenantError) return NextResponse.json({ error: tenantError.message }, { status: 500 })

  // Create user profile
  await supabase.from('user_profiles').insert({
    id: user.id, tenant_id: tenant.id, email: user.email!, role: 'admin'
  })

  // Create first warehouse
  await supabase.from('warehouses').insert({
    tenant_id: tenant.id, name: warehouseName
  })

  return NextResponse.json({ success: true })
}
```

**Step 2: Create setup page**
```typescript
// src/app/(auth)/setup/page.tsx
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
```

**Step 3: Update middleware to redirect new users to /setup**

In `src/middleware.ts`, after getting `user`, add:
```typescript
// After: const { data: { user } } = await supabase.auth.getUser()
if (user) {
  const isSetupRoute = request.nextUrl.pathname === '/setup'
  const { data: profile } = await supabase
    .from('user_profiles').select('id').eq('id', user.id).single()
  if (!profile && !isSetupRoute && !isApiRoute) {
    return NextResponse.redirect(new URL('/setup', request.url))
  }
}
```

**Step 4: Commit**
```bash
git add src/app/(auth)/setup/ src/app/api/setup/
git commit -m "feat(auth): add first-time tenant and warehouse setup flow"
```

---

### Task 1.4: Dashboard shell — Sidebar + layout

**Files:**
- Create: `src/app/(dashboard)/layout.tsx`
- Create: `src/components/layout/AppSidebar.tsx`
- Create: `src/app/(dashboard)/dashboard/page.tsx`

**Step 1: Create app sidebar**
```typescript
// src/components/layout/AppSidebar.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Package, ShoppingCart, Upload, BarChart3, Settings, Warehouse } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/catalog', label: 'Master Catalog', icon: Package },
  { href: '/purchases', label: 'Purchases', icon: ShoppingCart },
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
```

**Step 2: Create dashboard layout**
```typescript
// src/app/(dashboard)/layout.tsx
import { AppSidebar } from '@/components/layout/AppSidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  )
}
```

**Step 3: Create placeholder dashboard page**
```typescript
// src/app/(dashboard)/dashboard/page.tsx
export default function DashboardPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">Dashboard</h2>
      <p className="text-muted-foreground">Welcome to FK Tool. Modules load here as they are built.</p>
    </div>
  )
}
```

**Step 4: Verify**
- Log in → complete setup → see dashboard with sidebar
- All nav links render, sidebar highlights active route

**Step 5: Commit**
```bash
git add src/app/(dashboard)/ src/components/layout/
git commit -m "feat(shell): add sidebar navigation and dashboard layout"
```

---

### Task 1.5: Settings — Warehouses & Marketplace Accounts

**Files:**
- Create: `src/app/(dashboard)/settings/page.tsx`
- Create: `src/app/api/warehouses/route.ts`
- Create: `src/app/api/marketplace-accounts/route.ts`

**Step 1: Warehouse API**
```typescript
// src/app/api/warehouses/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

async function getTenantId(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from('user_profiles').select('tenant_id').eq('id', userId).single()
  return data?.tenant_id
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = await getTenantId(supabase, user.id)
  const { data } = await supabase.from('warehouses').select('*').eq('tenant_id', tenantId).order('created_at')
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = await getTenantId(supabase, user.id)
  const { name, location } = await request.json()
  const { data, error } = await supabase.from('warehouses')
    .insert({ tenant_id: tenantId, name, location }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await request.json()
  await supabase.from('warehouses').delete().eq('id', id)
  return NextResponse.json({ success: true })
}
```

**Step 2: Marketplace accounts API**
```typescript
// src/app/api/marketplace-accounts/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { Platform } from '@/types'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('user_profiles').select('tenant_id').eq('id', user.id).single()
  const { data } = await supabase.from('marketplace_accounts')
    .select('*').eq('tenant_id', profile!.tenant_id).order('platform')
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await supabase.from('user_profiles').select('tenant_id').eq('id', user.id).single()
  const { platform, account_name }: { platform: Platform; account_name: string } = await request.json()
  const { data, error } = await supabase.from('marketplace_accounts')
    .insert({ tenant_id: profile!.tenant_id, platform, account_name, mode: 'csv' })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

**Step 3: Settings page (warehouses + accounts UI)**

Build `src/app/(dashboard)/settings/page.tsx` as a client component with two sections: Warehouses (list, add, delete) and Marketplace Accounts (list, add). Use `Card`, `Button`, `Input`, `Badge` from shadcn/ui. Fetch from the APIs above.

**Step 4: Test manually**
- Add a Flipkart account, add two warehouses — verify they persist in Supabase

**Step 5: Commit**
```bash
git add src/app/(dashboard)/settings/ src/app/api/warehouses/ src/app/api/marketplace-accounts/
git commit -m "feat(settings): warehouses and marketplace accounts management"
```

---

## Phase 2: Master Catalog & SKU Mapping (Module 2)

### Task 2.1: Database migration — Catalog tables

```sql
-- Migration: create_catalog_tables
CREATE TABLE master_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sku_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  master_sku_id UUID NOT NULL REFERENCES master_skus(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('flipkart', 'amazon', 'd2c')),
  platform_sku TEXT NOT NULL,
  marketplace_account_id UUID REFERENCES marketplace_accounts(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, platform, platform_sku)
);

ALTER TABLE master_skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE sku_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant-scoped master_skus" ON master_skus
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant-scoped sku_mappings" ON sku_mappings
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

CREATE INDEX idx_sku_mappings_platform_sku ON sku_mappings(tenant_id, platform, platform_sku);
```

---

### Task 2.2: Master SKU API routes

**Files:**
- Create: `src/app/api/catalog/master-skus/route.ts`
- Create: `src/app/api/catalog/sku-mappings/route.ts`
- Create: `src/lib/db/tenant.ts`

**Step 1: Create tenant helper**
```typescript
// src/lib/db/tenant.ts
import { createClient } from '@/lib/supabase/server'

export async function getTenantId(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data } = await supabase.from('user_profiles')
    .select('tenant_id').eq('id', user.id).single()
  if (!data) throw new Error('Profile not found')
  return data.tenant_id
}
```

**Step 2: Master SKUs CRUD route**
```typescript
// src/app/api/catalog/master-skus/route.ts
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')
    let query = supabase.from('master_skus').select(`
      *, sku_mappings(id, platform, platform_sku, marketplace_account_id)
    `).eq('tenant_id', tenantId).eq('is_archived', false).order('name')
    if (search) query = query.ilike('name', `%${search}%`)
    const { data, error } = await query
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { name, description } = await request.json()
    const { data, error } = await supabase.from('master_skus')
      .insert({ tenant_id: tenantId, name, description }).select().single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { id, name, description } = await request.json()
    const { data, error } = await supabase.from('master_skus')
      .update({ name, description }).eq('id', id).eq('tenant_id', tenantId).select().single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

**Step 3: SKU Mappings route**
```typescript
// src/app/api/catalog/sku-mappings/route.ts
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'
import { NextResponse } from 'next/server'
import type { Platform } from '@/types'

export async function POST(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { master_sku_id, platform, platform_sku, marketplace_account_id }:
      { master_sku_id: string; platform: Platform; platform_sku: string; marketplace_account_id?: string } =
      await request.json()
    const { data, error } = await supabase.from('sku_mappings')
      .insert({ tenant_id: tenantId, master_sku_id, platform, platform_sku, marketplace_account_id })
      .select().single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const tenantId = await getTenantId()
    const supabase = await createClient()
    const { id } = await request.json()
    await supabase.from('sku_mappings').delete().eq('id', id).eq('tenant_id', tenantId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

**Step 4: Commit**
```bash
git add src/app/api/catalog/ src/lib/db/
git commit -m "feat(catalog): master SKU and SKU mapping API routes"
```

---

### Task 2.3: Master Catalog UI

**Files:**
- Create: `src/app/(dashboard)/catalog/page.tsx`
- Create: `src/components/catalog/SkuMappingDialog.tsx`

Build the catalog page with:
- Search bar filtering master SKUs
- Table: Name, Flipkart SKU, Amazon SKU, D2C SKU, Actions
- "Add Master SKU" button → inline form
- Each row expandable to add/edit SKU mappings via `SkuMappingDialog`
- Badge per platform showing mapped SKU or "Not mapped"

**Step: Commit**
```bash
git add src/app/(dashboard)/catalog/ src/components/catalog/
git commit -m "feat(catalog): master catalog and SKU mapping UI"
```

---

### Task 2.4: Bulk SKU Mapping import (CSV)

**Files:**
- Create: `src/lib/importers/sku-mapping-importer.ts`

```typescript
// src/lib/importers/sku-mapping-importer.ts
import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/db/tenant'

// Expected CSV columns: master_sku_name, flipkart_sku, amazon_sku, d2c_sku
export async function importSkuMappingCsv(csvText: string) {
  const tenantId = await getTenantId()
  const supabase = await createClient()
  const { data } = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })

  let processed = 0, failed = 0
  const errors: string[] = []

  for (const row of data) {
    const masterSkuName = row['master_sku_name']?.trim()
    if (!masterSkuName) { failed++; continue }

    // Upsert master SKU
    const { data: sku } = await supabase.from('master_skus')
      .upsert({ tenant_id: tenantId, name: masterSkuName }, { onConflict: 'tenant_id,name' })
      .select('id').single()
    if (!sku) { failed++; errors.push(`Failed to upsert: ${masterSkuName}`); continue }

    const platforms: Array<{ platform: string; col: string }> = [
      { platform: 'flipkart', col: 'flipkart_sku' },
      { platform: 'amazon', col: 'amazon_sku' },
      { platform: 'd2c', col: 'd2c_sku' },
    ]
    for (const { platform, col } of platforms) {
      const platformSku = row[col]?.trim()
      if (!platformSku) continue
      await supabase.from('sku_mappings').upsert({
        tenant_id: tenantId, master_sku_id: sku.id,
        platform, platform_sku: platformSku
      }, { onConflict: 'tenant_id,platform,platform_sku' })
    }
    processed++
  }
  return { processed, failed, errors }
}
```

Add a "Bulk Import CSV" button on the catalog page that accepts a CSV file and calls this importer via an API route.

**Step: Commit**
```bash
git add src/lib/importers/sku-mapping-importer.ts
git commit -m "feat(catalog): bulk SKU mapping CSV import"
```

---

## Phase 3: Purchase Tracking (Module 3)

### Task 3.1: Database migration — Purchases

```sql
-- Migration: create_purchases_table
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  master_sku_id UUID NOT NULL REFERENCES master_skus(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  packaging_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  other_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_cogs NUMERIC(10,2) GENERATED ALWAYS AS (unit_cost + packaging_cost + other_cost) STORED,
  supplier TEXT,
  purchase_date DATE NOT NULL,
  received_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant-scoped purchases" ON purchases
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

CREATE INDEX idx_purchases_master_sku ON purchases(tenant_id, master_sku_id, received_date);
```

---

### Task 3.2: Purchase API + UI

**Files:**
- Create: `src/app/api/purchases/route.ts`
- Create: `src/app/(dashboard)/purchases/page.tsx`

**API route** — GET (list with filters), POST (create), PATCH (edit):
- GET supports: `?warehouse_id=`, `?master_sku_id=`, `?from=`, `?to=`
- POST: validates quantity > 0, unit_cost >= 0
- Returns master_sku name and warehouse name via join

**Purchases page:**
- Date range filter + warehouse filter + SKU search
- Table: Date, Master SKU, Warehouse, Qty, Unit Cost, Packaging, Other, Total COGS, Supplier
- "Add Purchase" button → dialog form with dropdowns for SKU (searchable) and warehouse
- Totals row at bottom of filtered view

**Step: Commit**
```bash
git add src/app/api/purchases/ src/app/(dashboard)/purchases/
git commit -m "feat(purchases): purchase tracking API and UI"
```

---

## Phase 4: Sheet Intelligence Engine (Module 4)

### Task 4.1: File signature registry

**Files:**
- Create: `src/lib/parser/signatures.ts`

```typescript
// src/lib/parser/signatures.ts
import type { Platform, ReportType } from '@/types'

export interface FileSignature {
  platform: Platform
  reportType: ReportType
  requiredColumns: string[]   // all must be present (case-insensitive)
  optionalColumns: string[]   // boost confidence if present
}

// Normalise: lowercase, trim, collapse spaces
export function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

export const SIGNATURES: FileSignature[] = [
  {
    platform: 'flipkart',
    reportType: 'dispatch_report',
    requiredColumns: ['order id', 'tracking id', 'dispatch date', 'sku'],
    optionalColumns: ['sub order id', 'courier', 'warehouse', 'quantity'],
  },
  {
    platform: 'flipkart',
    reportType: 'listings_settlement',
    requiredColumns: ['order id', 'sku', 'sale price', 'commission'],
    optionalColumns: ['sub order id', 'logistics fee', 'settlement amount', 'collection fee'],
  },
  {
    platform: 'flipkart',
    reportType: 'historical_orders',
    requiredColumns: ['order id', 'fsn', 'order date', 'status'],
    optionalColumns: ['sub order id', 'return type', 'customer name', 'quantity'],
  },
  {
    platform: 'flipkart',
    reportType: 'sku_mapping',
    requiredColumns: ['master sku', 'flipkart sku'],
    optionalColumns: ['amazon sku', 'd2c sku'],
  },
  {
    platform: 'flipkart',
    reportType: 'procurement',
    requiredColumns: ['master sku', 'quantity', 'unit cost', 'purchase date'],
    optionalColumns: ['packaging cost', 'other cost', 'supplier', 'warehouse'],
  },
  {
    platform: 'amazon',
    reportType: 'dispatch_report',
    requiredColumns: ['amazon-order-id', 'sku', 'quantity-shipped'],
    optionalColumns: ['ship-date', 'tracking-number', 'carrier-name'],
  },
  {
    platform: 'amazon',
    reportType: 'historical_orders',
    requiredColumns: ['amazon-order-id', 'asin', 'purchase-date', 'order-status'],
    optionalColumns: ['sku', 'quantity', 'item-price'],
  },
]
```

---

### Task 4.2: Fingerprint detection engine

**Files:**
- Create: `src/lib/parser/fingerprint.ts`

```typescript
// src/lib/parser/fingerprint.ts
import { SIGNATURES, normalise, type FileSignature } from './signatures'
import type { Platform, ReportType } from '@/types'

export interface DetectionResult {
  platform: Platform | null
  reportType: ReportType | null
  confidence: number  // 0–100
  matchedSignature: FileSignature | null
  headerRow: string[]
}

export function detectFileType(headers: string[]): DetectionResult {
  const normHeaders = headers.map(normalise)

  let bestScore = 0
  let bestSig: FileSignature | null = null

  for (const sig of SIGNATURES) {
    const requiredMatches = sig.requiredColumns.filter(col =>
      normHeaders.some(h => h.includes(col) || col.includes(h))
    ).length
    const optionalMatches = sig.optionalColumns.filter(col =>
      normHeaders.some(h => h.includes(col) || col.includes(h))
    ).length

    const requiredScore = (requiredMatches / sig.requiredColumns.length) * 70
    const optionalScore = sig.optionalColumns.length > 0
      ? (optionalMatches / sig.optionalColumns.length) * 30
      : 30

    const score = requiredScore + optionalScore

    if (score > bestScore) {
      bestScore = score
      bestSig = sig
    }
  }

  return {
    platform: bestSig?.platform ?? null,
    reportType: bestSig?.reportType ?? null,
    confidence: Math.round(bestScore),
    matchedSignature: bestSig,
    headerRow: headers,
  }
}
```

**Test the fingerprint engine:**
```typescript
// src/lib/parser/__tests__/fingerprint.test.ts
import { detectFileType } from '../fingerprint'

describe('detectFileType', () => {
  it('detects Flipkart dispatch report', () => {
    const headers = ['Order ID', 'Sub Order ID', 'Tracking ID', 'Dispatch Date', 'SKU', 'Courier']
    const result = detectFileType(headers)
    expect(result.platform).toBe('flipkart')
    expect(result.reportType).toBe('dispatch_report')
    expect(result.confidence).toBeGreaterThan(90)
  })

  it('detects Flipkart listings settlement', () => {
    const headers = ['Order ID', 'FSN', 'SKU', 'Sale Price', 'Commission', 'Logistics Fee', 'Settlement Amount']
    const result = detectFileType(headers)
    expect(result.platform).toBe('flipkart')
    expect(result.reportType).toBe('listings_settlement')
    expect(result.confidence).toBeGreaterThan(90)
  })

  it('returns low confidence for unknown file', () => {
    const headers = ['Column A', 'Column B', 'Unrelated Data']
    const result = detectFileType(headers)
    expect(result.confidence).toBeLessThan(50)
  })
})
```

Run: `npx jest src/lib/parser/__tests__/fingerprint.test.ts`

**Step: Commit**
```bash
git add src/lib/parser/
git commit -m "feat(parser): file signature registry and fingerprint detection engine"
```

---

### Task 4.3: Excel and CSV file parser

**Files:**
- Create: `src/lib/parser/reader.ts`

```typescript
// src/lib/parser/reader.ts
import * as XLSX from 'xlsx'
import Papa from 'papaparse'

export interface ParsedFile {
  headers: string[]
  rows: Record<string, string>[]
  rawPreview: string[][]  // first 10 rows for preview
}

export async function parseFile(buffer: Buffer, filename: string): Promise<ParsedFile> {
  const ext = filename.split('.').pop()?.toLowerCase()

  if (ext === 'csv') {
    return parseCsv(buffer.toString('utf-8'))
  } else if (ext === 'xlsx' || ext === 'xls') {
    return parseExcel(buffer)
  }
  throw new Error(`Unsupported file type: ${ext}`)
}

function parseCsv(text: string): ParsedFile {
  const { data } = Papa.parse<Record<string, string>>(text, {
    header: true, skipEmptyLines: true
  })
  const headers = data.length > 0 ? Object.keys(data[0]) : []
  return {
    headers,
    rows: data,
    rawPreview: [headers, ...data.slice(0, 10).map(r => headers.map(h => r[h] ?? ''))]
  }
}

function parseExcel(buffer: Buffer): ParsedFile {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
  if (raw.length === 0) return { headers: [], rows: [], rawPreview: [] }
  const headers = raw[0].map(String)
  const rows = raw.slice(1).map(row =>
    Object.fromEntries(headers.map((h, i) => [h, String(row[i] ?? '')]))
  )
  return { headers, rows, rawPreview: raw.slice(0, 11).map(r => r.map(String)) }
}
```

---

### Task 4.4: Database migration — Imports + operational tables

```sql
-- Migration: create_operational_tables
CREATE TABLE imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  detected_marketplace TEXT,
  detected_report_type TEXT,
  confirmed_marketplace TEXT,
  confirmed_report_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  rows_processed INTEGER DEFAULT 0,
  rows_failed INTEGER DEFAULT 0,
  error_log TEXT,
  imported_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  import_id UUID REFERENCES imports(id),
  master_sku_id UUID REFERENCES master_skus(id),
  warehouse_id UUID REFERENCES warehouses(id),
  marketplace_account_id UUID REFERENCES marketplace_accounts(id),
  order_id TEXT NOT NULL,
  platform_sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  dispatch_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  import_id UUID REFERENCES imports(id),
  platform_order_id TEXT NOT NULL,
  master_sku_id UUID REFERENCES master_skus(id),
  marketplace_account_id UUID REFERENCES marketplace_accounts(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  sale_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  order_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE order_financials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sale_price NUMERIC(10,2) DEFAULT 0,
  commission_amount NUMERIC(10,2) DEFAULT 0,
  commission_rate NUMERIC(5,4) DEFAULT 0,
  logistics_cost NUMERIC(10,2) DEFAULT 0,
  other_deductions NUMERIC(10,2) DEFAULT 0,
  projected_settlement NUMERIC(10,2) DEFAULT 0,
  actual_settlement NUMERIC(10,2),
  settlement_variance NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  import_id UUID REFERENCES imports(id),
  order_id UUID REFERENCES orders(id),
  master_sku_id UUID REFERENCES master_skus(id),
  warehouse_id UUID REFERENCES warehouses(id),
  return_type TEXT NOT NULL CHECK (return_type IN ('customer', 'logistics', 'cancellation')),
  causes_deduction BOOLEAN NOT NULL DEFAULT FALSE,
  deduction_amount NUMERIC(10,2) DEFAULT 0,
  quantity INTEGER DEFAULT 1,
  return_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sku_financial_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  master_sku_id UUID NOT NULL REFERENCES master_skus(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('flipkart', 'amazon', 'd2c')),
  avg_commission_rate NUMERIC(5,4) DEFAULT 0,
  avg_logistics_cost NUMERIC(10,2) DEFAULT 0,
  avg_return_rate NUMERIC(5,4) DEFAULT 0,
  avg_net_settlement_pct NUMERIC(5,4) DEFAULT 0,
  sample_size INTEGER DEFAULT 0,
  last_computed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, master_sku_id, platform)
);

-- RLS for all new tables
ALTER TABLE imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sku_financial_profiles ENABLE ROW LEVEL SECURITY;

-- Policy template (repeat for each table):
CREATE POLICY "Tenant-scoped imports" ON imports
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant-scoped dispatches" ON dispatches
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant-scoped orders" ON orders
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant-scoped order_financials" ON order_financials
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant-scoped returns" ON returns
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant-scoped sku_financial_profiles" ON sku_financial_profiles
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- Indexes
CREATE INDEX idx_dispatches_date ON dispatches(tenant_id, dispatch_date, master_sku_id);
CREATE INDEX idx_orders_date ON orders(tenant_id, order_date, master_sku_id);
CREATE INDEX idx_returns_date ON returns(tenant_id, return_date, master_sku_id);
```

---

### Task 4.5: Import processors

**Files:**
- Create: `src/lib/importers/dispatch-importer.ts`
- Create: `src/lib/importers/listings-importer.ts`
- Create: `src/lib/importers/historical-orders-importer.ts`
- Create: `src/lib/importers/index.ts`

Each importer follows the same contract:
```typescript
// Pattern for all importers
export async function processDispatchReport(
  rows: Record<string, string>[],
  importId: string,
  tenantId: string,
  marketplaceAccountId: string
): Promise<{ processed: number; failed: number; errors: string[] }>
```

**Dispatch importer key logic:**
1. For each row: extract `order_id`, `platform_sku`, `dispatch_date`, `quantity`
2. Look up `master_sku_id` from `sku_mappings` using `platform_sku`
3. Look up `warehouse_id` from warehouse name (if column present) else use default
4. Insert into `dispatches`
5. Count processed/failed

**Listings/Settlement importer key logic:**
1. For each row: extract `platform_order_id`, `platform_sku`, `sale_price`, `commission_amount`, `logistics_cost`, `order_date`
2. Compute `commission_rate = commission_amount / sale_price`
3. Compute `projected_settlement = sale_price - commission_amount - logistics_cost`
4. Upsert into `orders`, then insert `order_financials`

**Historical orders importer key logic:**
1. For each row: extract order data including `return_type`
2. Map `return_type`:
   - 'Customer Return' → `causes_deduction = true`
   - 'Logistics Return' / 'Cancellation' → `causes_deduction = false`
3. Upsert `orders`, insert `returns` where applicable

**Step: Commit**
```bash
git add src/lib/importers/
git commit -m "feat(importer): dispatch, listings, and historical orders processors"
```

---

### Task 4.6: Upload API route

**Files:**
- Create: `src/app/api/imports/upload/route.ts`
- Create: `src/app/api/imports/confirm/route.ts`
- Create: `src/app/api/imports/route.ts`

**Upload route (POST):**
1. Accept `multipart/form-data` with file
2. Upload raw file to Supabase Storage bucket `imports/{tenantId}/{importId}/{filename}`
3. Read file buffer → `parseFile()` → `detectFileType()`
4. Create `imports` record with status `pending` and detection results
5. Return: `{ importId, detection: DetectionResult, preview: rawPreview }`

**Confirm route (POST):**
1. Accept `{ importId, marketplace, reportType }` (user-confirmed values)
2. Update `imports` record: `confirmed_marketplace`, `confirmed_report_type`, status = `processing`
3. Download file from Storage
4. Run appropriate importer based on `reportType`
5. Update `imports` record: status = `complete`, rows_processed, rows_failed, error_log
6. If report contains financial data → trigger `buildSkuFinancialProfile()` async

**Step: Commit**
```bash
git add src/app/api/imports/
git commit -m "feat(imports): upload, detection, and processing API routes"
```

---

### Task 4.7: Upload UI

**Files:**
- Create: `src/app/(dashboard)/imports/page.tsx`
- Create: `src/components/imports/UploadZone.tsx`
- Create: `src/components/imports/DetectionResult.tsx`
- Create: `src/components/imports/ImportHistory.tsx`

**Upload flow UI:**
1. `UploadZone` — react-dropzone, accepts `.csv`, `.xlsx`, `.xls`, shows file name + size on drop
2. On drop: POST to `/api/imports/upload` → show loading spinner
3. `DetectionResult` — shows detected marketplace + report type + confidence bar + 10-row preview table
4. If confidence > 90%: green badge "Auto-detected", confirm button enabled
5. If confidence 50–90%: yellow badge "Please confirm", show dropdowns to correct marketplace/type
6. If confidence < 50%: red badge "Could not detect", require manual selection
7. "Confirm & Import" button → POST to `/api/imports/confirm` → show progress → show summary
8. `ImportHistory` — table of past imports with status badges, row counts, timestamps

**Step: Commit**
```bash
git add src/app/(dashboard)/imports/ src/components/imports/
git commit -m "feat(imports): upload UI with intelligent detection and confirmation flow"
```

---

## Phase 5: Daily Inventory + Settlement Intelligence (Module 5)

### Task 5.1: Stock calculation service

**Files:**
- Create: `src/lib/calculations/stock.ts`

```typescript
// src/lib/calculations/stock.ts
import { createClient } from '@/lib/supabase/server'

export interface StockSnapshot {
  masterSkuId: string
  masterSkuName: string
  warehouseId: string
  warehouseName: string
  openingStock: number
  purchased: number
  dispatched: number
  customerReturns: number
  closingStock: number
  date: string
}

export async function getStockSnapshot(
  tenantId: string,
  asOfDate: string,  // YYYY-MM-DD
  warehouseId?: string
): Promise<StockSnapshot[]> {
  const supabase = await createClient()

  // Purchases up to asOfDate
  let purchasesQuery = supabase
    .from('purchases')
    .select('master_sku_id, warehouse_id, quantity')
    .eq('tenant_id', tenantId)
    .lte('received_date', asOfDate)
  if (warehouseId) purchasesQuery = purchasesQuery.eq('warehouse_id', warehouseId)

  // Dispatches up to asOfDate
  let dispatchesQuery = supabase
    .from('dispatches')
    .select('master_sku_id, warehouse_id, quantity')
    .eq('tenant_id', tenantId)
    .lte('dispatch_date', asOfDate)
  if (warehouseId) dispatchesQuery = dispatchesQuery.eq('warehouse_id', warehouseId)

  // Customer returns up to asOfDate (only causes_deduction = true means stock came back)
  let returnsQuery = supabase
    .from('returns')
    .select('master_sku_id, warehouse_id, quantity')
    .eq('tenant_id', tenantId)
    .eq('return_type', 'customer')
    .lte('return_date', asOfDate)
  if (warehouseId) returnsQuery = returnsQuery.eq('warehouse_id', warehouseId)

  const [{ data: purchases }, { data: dispatches }, { data: returns }] =
    await Promise.all([purchasesQuery, dispatchesQuery, returnsQuery])

  // Aggregate by master_sku_id + warehouse_id
  const map = new Map<string, StockSnapshot>()
  const key = (skuId: string, whId: string) => `${skuId}::${whId}`

  // ... aggregate logic (sum quantities into map)
  // Fetch SKU names and warehouse names, merge and return

  return Array.from(map.values())
}
```

---

### Task 5.2: Settlement projection service

**Files:**
- Create: `src/lib/calculations/settlement.ts`

```typescript
// src/lib/calculations/settlement.ts
// Core calculation:
// projected_settlement = sale_price - commission_amount - logistics_cost - return_provision
// return_provision = sale_price × avg_return_rate (from sku_financial_profiles)
// expected_margin = projected_settlement - total_cogs (from purchases, per master_sku_id)

export interface SettlementSummary {
  orderId: string
  platformOrderId: string
  masterSkuId: string
  masterSkuName: string
  platform: string
  orderDate: string
  salePrice: number
  commissionAmount: number
  logisticsCost: number
  returnProvision: number
  projectedSettlement: number
  cogs: number
  expectedMargin: number
  marginPct: number
  confidencePct: number  // based on sample_size
}
```

---

### Task 5.3: SKU financial profile builder

**Files:**
- Create: `src/lib/calculations/profile-builder.ts`

Recomputes `sku_financial_profiles` for a given tenant + master_sku + platform from all historical order data:
```
avg_commission_rate = AVG(commission_amount / sale_price) over all orders
avg_logistics_cost = AVG(logistics_cost) over all orders
avg_return_rate = COUNT(customer returns) / COUNT(orders)
avg_net_settlement_pct = AVG(projected_settlement / sale_price)
sample_size = COUNT(orders used)
```

Call this after every `historical_orders` or `listings_settlement` import.

---

### Task 5.4: Inventory Dashboard page

**Files:**
- Create: `src/app/(dashboard)/inventory/page.tsx`
- Create: `src/app/api/inventory/stock/route.ts`
- Create: `src/app/api/inventory/settlement/route.ts`
- Create: `src/components/inventory/StockTable.tsx`
- Create: `src/components/inventory/SettlementTable.tsx`
- Create: `src/components/inventory/SummaryCards.tsx`
- Create: `src/components/inventory/StockTrendChart.tsx`
- Create: `src/components/inventory/MarginTrendChart.tsx`

**Dashboard layout:**
```
┌─────────────────────────────────────────────────────┐
│  Date: [Today ▼]   Warehouse: [All ▼]   Platform: [All ▼]  │
├───────────────┬─────────────────────────────────────┤
│ Total Orders  │ Projected Settlement  │ Exp. Margin  │
│ [1,234]       │ [₹4,56,789]           │ [₹1,23,456] │
├───────────────┴─────────────────────────────────────┤
│ [Inventory Tab]  [Settlement Tab]                    │
├──────────────────────────────────────────────────────┤
│ INVENTORY TAB:                                       │
│  SKU | WH | Opening | +Purchased | -Dispatched | -Returns | Closing │
│  ... │    │         │            │             │         │         │
│                                                      │
│  [Stock trend chart - recharts LineChart]            │
├──────────────────────────────────────────────────────┤
│ SETTLEMENT TAB:                                      │
│  Order | SKU | Sale | Commission | Logistics | Return Prov | Settlement | COGS | Margin% │
│                                                      │
│  [Margin trend chart]                                │
│  [Insights: Top 5 margin SKUs / Bottom 5 / High return rate SKUs] │
└──────────────────────────────────────────────────────┘
```

**Date range presets:** Today, Yesterday, Last 3 days, Last 7 days, Last 30 days, Custom

**Intelligence alerts (shown as banner cards above table):**
- SKUs with closing stock < threshold
- SKUs where return rate > 15% (based on profile)
- SKUs where projected settlement variance > 10% from profile average

**Step: Commit**
```bash
git add src/app/(dashboard)/inventory/ src/app/api/inventory/ src/components/inventory/
git commit -m "feat(dashboard): inventory and settlement intelligence dashboard"
```

---

## Phase 5b: SKU Financial Profiles — Intelligence Layer

### Task 5.5: Profile auto-computation trigger + API

**Files:**
- Create: `src/app/api/inventory/profiles/route.ts`

After each listings or historical import, call profile builder for affected SKUs. Expose `/api/inventory/profiles?master_sku_id=X&platform=Y` for the dashboard to fetch confidence and profile stats.

---

## Final Tasks

### Task F.1: Docker setup for Hetzner deployment

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

```yaml
# docker-compose.yml
services:
  fk-tool:
    build: .
    ports:
      - "3000:3000"
    env_file: .env.production
    restart: unless-stopped
```

Add to `next.config.ts`:
```typescript
output: 'standalone'
```

**Step: Commit**
```bash
git add Dockerfile docker-compose.yml .dockerignore next.config.ts
git commit -m "chore: Docker setup for Hetzner deployment"
```

---

### Task F.2: Supabase Storage bucket setup

Create the `imports` bucket in Supabase:
```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('imports', 'imports', false);

CREATE POLICY "Tenant upload" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'imports' AND auth.uid() IS NOT NULL);

CREATE POLICY "Tenant read own files" ON storage.objects FOR SELECT
  USING (bucket_id = 'imports' AND auth.uid() IS NOT NULL);
```

---

## Testing Checklist (Flipkart-first)

Before handing each module to the team, test with real Flipkart data:

- [ ] Upload Flipkart dispatch report → auto-detected → imported → dispatches table populated
- [ ] Upload Flipkart listings/settlement file → auto-detected → orders + order_financials populated
- [ ] Upload historical Flipkart orders report → sku_financial_profiles computed
- [ ] Upload master SKU mapping CSV → all mappings appear in catalog
- [ ] Inventory dashboard shows correct closing stock for today
- [ ] Settlement tab shows projected settlement with margin % per order
- [ ] Intelligence alerts trigger for low-stock and high-return SKUs
- [ ] Date range filter works (yesterday / 3d / 7d / 30d)
- [ ] Warehouse filter narrows stock view correctly
