# Design: User Roles, Onboarding Checklist & Info Icons

**Date:** 2026-03-06
**Status:** Approved
**Scope:** Three related features that together make FK-Tool usable by a team and self-explanatory to new users.

---

## Background

FK-Tool currently has a 1:1 user-to-tenant model with no team access, no guided onboarding, and no in-app explanations of what data is needed or how calculations work. This design addresses all three gaps.

Multi-org (one user owning multiple workspaces) is deliberately **out of scope** — it is deferred until the taxation module requires it. The foundation laid here (workspace_members, roles) will extend cleanly to multi-org when that time comes.

---

## Feature 1 — User Roles & Team Management

### Data Model

One new table. No existing tables change. No existing queries change.

```sql
CREATE TABLE workspace_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id),   -- NULL until invite accepted
  invited_email text NOT NULL,
  role          text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  status        text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active')),
  invited_by    uuid NOT NULL REFERENCES auth.users(id),
  invited_at    timestamptz NOT NULL DEFAULT now(),
  joined_at     timestamptz,
  UNIQUE (tenant_id, invited_email)
);

-- RLS: users can read their own workspace_members rows
-- Only owner role can INSERT/UPDATE/DELETE workspace_members
```

`user_profiles.tenant_id` continues to be the single source of truth for "which workspace is this user in". For invited members it points to the **inviter's** tenant_id instead of a new one.

### Roles

| Role | Data (read) | Data (write) | Team management |
|------|-------------|--------------|-----------------|
| Owner | ✅ | ✅ | ✅ |
| Editor | ✅ | ✅ | ❌ |
| Viewer | ✅ | ❌ | ❌ |

Architecture is designed to support granular per-module permissions in the future; the role column is intentionally a text field (not a DB enum) to allow extension without migrations.

### Invite Flow

1. Owner opens **Settings → Team**, enters email + selects role, clicks Invite
2. API creates `workspace_members` row with `status: pending`
3. API calls `supabase.auth.admin.inviteUserByEmail()` — Supabase sends the email (no custom email infra needed); metadata includes `tenant_id` and `role`
4. Invited user clicks link → branded accept page showing inviter name + workspace name
5. User sets password → `user_profiles` row created with `tenant_id = inviter's tenant_id` → `workspace_members` updated to `status: active`

**Edge case:** Existing users being invited to a second workspace is out of scope (requires multi-org). If an existing user's email is invited, show a clear error: "This user already has a workspace. Multi-workspace support is coming soon."

### Role Enforcement

- `getRole(userId, tenantId): Promise<'owner'|'editor'|'viewer'>` helper in `src/lib/db/roles.ts`
- `withRole(minRole, handler)` wrapper applied to all write API routes (`POST`, `PATCH`, `DELETE`)
- Viewers receive `403 Forbidden` on any write attempt
- UI: write actions (add/edit/delete buttons) hidden for Viewers via a `useRole()` client hook
- Editors cannot access Settings → Team tab (hidden in nav, 403 on API)

### Settings → Team UI (`/settings` — new Team tab)

- Member table: avatar initial, name/email, role badge (colour-coded), joined date, Remove button (owner only)
- Pending invites section: email, role, invited date, Resend / Cancel buttons
- Invite form: email input + role select (Editor / Viewer) + Invite button
- Owner cannot remove themselves
- Owner role is not changeable via UI (future: workspace transfer)

---

## Feature 2 — Getting Started Checklist (Dashboard)

### Behaviour

- Shown as a card at the top of `/dashboard` for all users until dismissed or all critical steps complete
- Status of each step computed live from the DB on dashboard load (lightweight COUNT queries)
- Progress bar shows X/8 steps complete
- Once all 8 steps complete, card shows a "You're all set!" state and can be permanently dismissed
- Dismissed state stored in `user_profiles` (new boolean column `onboarding_dismissed`)
- Owners and Editors see the checklist; Viewers see a read-only summary (cannot action steps)

### Steps

| # | Step | Critical | Completion check |
|---|------|----------|-----------------|
| 1 | Name your workspace | ✅ | `tenants.name` is not "My Workspace" (default) |
| 2 | Add marketplace accounts | ✅ | `COUNT(marketplace_accounts) > 0` |
| 3 | Add a warehouse | ✅ | `COUNT(warehouses) > 0` |
| 4 | Add products to Master Catalog | ✅ | `COUNT(master_skus) > 0` |
| 5 | Import purchases | ✅ | `COUNT(purchases) > 0` |
| 6 | Add freight invoices | ⭐ optional | `COUNT(freight_invoices) > 0` |
| 7 | Set up packaging materials | ⭐ optional | `COUNT(packaging_materials) > 0` |
| 8 | Configure SKU packaging specs | ⭐ optional | `COUNT(sku_packaging_config) > 0` |

Each step card shows: step name, one-line description of why it matters, status icon (✅ done / ○ todo), and a CTA button ("Go to Purchases →").

### Standing Standard

**Every new feature or module added to FK-Tool must:**
1. Add its setup step(s) to the Getting Started checklist if it requires initial configuration
2. Include an `InfoTooltip` on every non-obvious field or metric
3. Include a page-level description (subtitle under the page heading) explaining what the page does and what data it needs
4. Include a helpful empty state when the page has no data, explaining what to do first

This is a non-negotiable product standard going forward.

---

## Feature 3 — Info Icons & Helper Text

### Component

```tsx
// src/components/ui/info-tooltip.tsx
<InfoTooltip content="Your explanation here" />
// Renders: ⓘ icon (Info from lucide, 3.5×3.5, text-muted-foreground)
// On hover: Radix Tooltip with max-w-xs text-sm content
```

### Placements

**COGS page**

| Field / metric | Tooltip content |
|---|---|
| WAC (Weighted Avg Cost) | "Purchase price averaged across all buy lots, weighted by quantity × price per lot. More recent lots don't get extra weight — it's purely value-weighted." |
| Allocated freight/unit | "Total inward freight for a purchase invoice, split across lots by their proportional value, then divided by units in that lot." |
| Purchase COGS/unit | "WAC base + allocated freight. Represents your landed cost before packaging and shrinkage." |
| Delivery rate | "Your historical ratio of dispatched orders that were successfully delivered (not returned). Used to spread dispatch cost over delivered units only." |
| Dispatch COGS/unit | "Total packaging material cost per dispatch ÷ delivery rate. Accounts for packaging used on orders that eventually get returned." |
| Shrinkage rate | "Expected % of purchased stock lost to damage, spoilage or theft. Applied as a % of purchase COGS." |
| Full COGS/unit | "Purchase COGS + Dispatch COGS + Shrinkage. This is your total cost per unit sold." |

**Purchases page**

| Field | Tooltip content |
|---|---|
| Unit purchase price | "Enter the price excluding GST. You are GST-registered, so input tax credit means GST is not a cost — only the base price affects COGS." |
| Tax paid | "Whether GST was charged on this invoice. Tracked for ITC reconciliation; does not affect COGS calculation." |

**Packaging page**

| Field | Tooltip content |
|---|---|
| Qty per dispatch | "How many units of this material are consumed per single order dispatch for this SKU. E.g. 1 box + 2 bubble wrap sheets = two separate entries." |
| Unit cost | "Cost per unit of this material (excluding GST). Used to compute dispatch COGS." |

**Invoices → Freight tab**

| Field | Tooltip content |
|---|---|
| Freight invoice | "Link this freight bill to a purchase invoice number. The freight amount will be allocated across all lots in that purchase invoice proportionally by lot value." |

### Page-level helper banners

Pages that depend on upstream data show a subtle info banner when that data is missing:

- **COGS page** — if no purchases exist: "No purchases found. Import purchases first to calculate COGS."
- **COGS page** — if purchases exist but no freight invoices: "Tip: Add freight invoices under Invoices to include landed freight cost in your COGS."
- **Packaging page** — if no materials defined: "Define your packaging materials first, then configure which materials each SKU uses."
- **Invoices page** — brief subtitle: "Freight invoices are allocated to purchase lots by proportional value to compute per-unit landed cost."

### Page subtitles (all pages)

Every page gets a one-line subtitle under the heading:

| Page | Subtitle |
|---|---|
| Dashboard | "Your workspace overview and setup progress." |
| Master Catalog | "Define your products and variants. Everything else links back to these SKUs." |
| Purchases | "Record inward stock purchases. These form the base of your COGS calculation." |
| Invoices | "Log freight invoices against purchase lots to build accurate landed costs." |
| Packaging | "Define packaging materials and configure how much each SKU uses per dispatch." |
| COGS | "Full cost per unit sold, built from purchases, freight, packaging and shrinkage." |
| Import Data | "Bulk-import orders and settlement data from your marketplace reports." |
| Settings | "Manage your workspace, team members, and account." |

---

## Implementation Phases

**Phase 1 — Info Icons & Helper Text** (lowest risk, highest immediate value)
- `InfoTooltip` component
- Page subtitles on all pages
- Tooltips on COGS, Purchases, Packaging, Invoices
- Page-level data-missing banners on COGS and Packaging

**Phase 2 — Getting Started Checklist**
- Dashboard checklist card
- `onboarding_dismissed` column on `user_profiles`
- Live completion checks via dashboard API

**Phase 3 — User Roles & Team Management**
- `workspace_members` migration
- `getRole()` / `withRole()` helpers
- `useRole()` client hook
- Settings → Team tab
- Invite flow (Supabase invite email)
- Viewer UI enforcement (hide write actions)

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/components/ui/info-tooltip.tsx` | New component |
| `src/app/(dashboard)/dashboard/page.tsx` | Checklist card |
| `src/app/api/dashboard/checklist/route.ts` | Checklist completion counts |
| `src/app/(dashboard)/settings/page.tsx` | Add Team tab |
| `src/app/api/team/route.ts` | Invite / list / remove members |
| `src/lib/db/roles.ts` | `getRole()`, `withRole()` |
| `src/hooks/use-role.ts` | Client role hook |
| `src/types/database.ts` | Add `WorkspaceMember` type |
| All page files | Add subtitle + InfoTooltips |
| `CLAUDE.md` | Standing standards section |
| Supabase migration | `workspace_members` table, `onboarding_dismissed` column |
