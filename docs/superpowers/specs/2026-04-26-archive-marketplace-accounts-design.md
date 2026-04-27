# Archive Marketplace Accounts — Design Spec

**Date:** 2026-04-26
**Status:** Draft, awaiting review

## Goal

Make the Settings → Marketplace Accounts "Remove" affordance work properly for accounts that have linked historical data (orders, dispatches, SKU mappings, etc.) by introducing a soft-delete (archive) pattern, while keeping genuine hard-delete available for empty/test accounts.

## Why now

The fix shipped on 2026-04-26 surfaces FK-violation errors clearly ("This account has linked orders, dispatches, or SKU mappings and cannot be deleted") instead of silently failing — which is honest but a dead-end UX. Once an account has been used for one day, it can't be removed at all. The user can rename (working) but can't retire an account they no longer use.

Archive-instead-of-delete is the standard fix and matches how every mature multi-tenant app handles entities with downstream references.

## Scope

**In scope:**
- New `archived_at` column on `marketplace_accounts`
- DELETE endpoint becomes "smart": archives if linked data exists, hard-deletes if not
- New `restore` action to un-archive
- Active vs archived display in Settings
- Archived accounts disappear from selectors / dropdowns across the app (filter at API)
- Partial-unique index so an archived name can be reused for a new account
- Cache invalidation across all surfaces

**Out of scope:**
- Bulk archive
- Auto-archive after N months of inactivity
- Permanent-delete-from-archived ("purge") — too dangerous; requires explicit cleanup tooling later
- Migrate-then-delete (move data from one account to another) — separate larger spec
- Archive of warehouses, organisations, or other entities (same pattern can be applied later)

## Architecture

### DB schema change

```sql
-- Add the soft-delete column
ALTER TABLE marketplace_accounts
  ADD COLUMN archived_at TIMESTAMPTZ NULL;

-- Replace the unique index with a partial one so archived names can be reused
DROP INDEX marketplace_accounts_unique_name_per_platform;
CREATE UNIQUE INDEX marketplace_accounts_unique_name_per_platform
  ON marketplace_accounts (tenant_id, platform, lower(account_name))
  WHERE archived_at IS NULL;
```

Rationale for partial index:
- An archived account named "NuvioStore" no longer occupies the live name slot
- A new account named "NuvioStore" can be created on the same platform
- The previously-renamed-name recycling check still catches reuse of a name that another LIVE account had earlier (existing behaviour from PATCH)

### API changes

#### Modified: `GET /api/marketplace-accounts`

**Default behavior:** filter out archived accounts (`archived_at IS NULL`). All existing callers (Daily P&L, P&L imports, sidebar, Catalog, etc.) automatically stop seeing archived accounts with no code change.

**New query param:** `?include_archived=true` returns archived accounts too. Used only by Settings to show the archived section.

```typescript
// pseudocode
const includeArchived = searchParams.get('include_archived') === 'true'
let q = supabase.from('marketplace_accounts').select('*').eq('tenant_id', tenantId)
if (!includeArchived) q = q.is('archived_at', null)
return q.order('platform')
```

#### Modified: `DELETE /api/marketplace-accounts`

**Smart deletion:**
1. Try the hard delete (current behavior with proper error handling)
2. If `23503` foreign key violation → flip to archive: `UPDATE marketplace_accounts SET archived_at = NOW() WHERE id = X AND tenant_id = Y`
3. Return body shape:
   - `{ deleted: true }` when hard-deleted
   - `{ archived: true, archived_at: <ISO> }` when archived

This is **transparent to the user** — they click "Remove", the API does the right thing automatically, and the response body tells the UI which message to show.

#### NEW: `PATCH /api/marketplace-accounts` action `restore`

The existing PATCH handler is for renaming. Extend it (or add a separate endpoint) to handle a `restore` action:

```typescript
{
  id: string
  action: 'restore'
}
```

Behavior:
- Verify account belongs to tenant
- Verify it's currently archived (`archived_at IS NOT NULL`)
- Check that restoring won't violate the partial unique index (i.e., no active account already exists with the same `(tenant_id, platform, lower(account_name))`). If it would, return 409 with explanation; user must rename one before restoring.
- Set `archived_at = NULL`

I'll extend the existing PATCH handler with an `action` discriminator instead of creating a separate route — keeps the API surface tight.

### File map

| File | Change |
|---|---|
| `supabase/migrations/<ts>_archive_marketplace_accounts.sql` (new) | Add column + partial unique index |
| `src/types/database.ts` | Add `archived_at: string \| null` to `MarketplaceAccount` |
| `src/app/api/marketplace-accounts/route.ts` | GET filter; DELETE smart; PATCH `restore` action |
| `src/app/(dashboard)/settings/page.tsx` | Active list + collapsed archived section + Restore button + smart toast |

## UI / UX

### Marketplace Accounts card (active section)

Same as today. The pencil + Remove buttons stay. The Remove button now shows a different toast based on what happened:

- **Hard delete** (no linked data): `Account removed`
- **Archived** (linked data): `Account archived — historical data preserved. Restore via the Archived section below.`

### Archived Accounts (new collapsed section)

Below the active accounts list, a new collapsible disclosure:

```
▶ Archived accounts (3)
   When expanded:
     • NuvioOld · Flipkart · Archived Mar 12, 2026     [Restore]
     • TestAccount · Amazon · Archived Apr 1, 2026     [Restore]
     • etc.
```

**Restore action:**
- Click "Restore" → confirm dialog: "Restore account 'NuvioOld'? It will reappear in account selectors across the app."
- Confirm → PATCH with `action: 'restore'`
- On success → toast + refresh list (active section grows by one, archived section shrinks)
- On 409 (name conflict): toast: "Cannot restore. Another active account already uses this name. Rename it first."

### Cache invalidation

Same predicate as the editable-account-names spec — both string and array SWR keys covered. Restore + archive both invalidate the same surfaces.

## Error handling

| Scenario | Behavior |
|---|---|
| User clicks Remove, account has no linked data | Hard delete, toast "Account removed" |
| User clicks Remove, account has linked data | Auto-archive, toast "Account archived — historical data preserved" |
| User tries to Restore but a live account already uses the same name | 409 + toast "Cannot restore — another active account uses this name. Rename it first." |
| User tries to add a new account with the same name as an archived one | Allowed (partial unique index skips archived rows) — but **POST should detect the recycle and return a non-blocking warning** (mirrors the rename recycle warning) |
| Concurrent archive race | Idempotent — second writer's `UPDATE` just sets `archived_at` to a slightly later timestamp; no error |
| Network failure on Restore | Toast error; user can retry |

## Testing strategy

### Unit
- DELETE handler: 4 paths (success delete, FK violation → archive, account-not-found, generic error)
- PATCH `restore`: 3 paths (success, name-conflict 409, account not archived)
- GET handler: respects `include_archived` flag

### Integration
- Hard-delete an account that has zero linked rows → returns `{ deleted: true }`, row gone from DB
- Try to delete an account with linked dispatches → returns `{ archived: true }`, row has `archived_at` set, still queryable via `include_archived=true`
- Restore an archived account → `archived_at` becomes NULL; reappears in default GET
- Restore-with-conflict → 409 returned; archived row stays archived
- Add a new account with the same name as an archived one → succeeds (partial unique index)

### Manual smoke test
1. Settings: try Remove on an account with zero linked data → "Account removed", row gone
2. Settings: try Remove on an account with linked data (e.g., one used in Daily P&L Estimator) → "Account archived — historical data preserved"
3. Verify the account no longer appears in `/daily-pnl` account selector
4. Verify the account no longer appears in `/pnl` import dialog account dropdown
5. Settings: expand Archived section, click Restore → confirm dialog → confirm
6. Verify the account is back in the active list and appears in selectors again
7. Archive account A "Foo". Add a new account "Foo" on the same platform → succeeds. Both can coexist (one archived, one active).

## Implementation budget

- Migration + type update: ~30 min
- API changes (GET filter, DELETE smart, PATCH restore): ~1 hr
- Settings UI (archived section + Restore button + smart toast): ~1.5 hr
- Manual smoke test + cross-page verification: ~30 min

**Estimated total: ~half day.**

## Open design points

1. **Restore confirmation dialog** — small confirm or one-click? My pick: small confirm ("Restore account 'X'?") because Restore changes visibility across the whole app.
2. **Archived section default state** — collapsed (my pick) vs expanded. Collapsed reduces noise on the typical Settings visit.
3. **Display of `archived_at` in tooltip** — show the date prominently or just on hover. My pick: prominent ("Archived Mar 12, 2026") because finance teams care about timing.
4. **Permanent purge** — not in v1. If we ever add it, it should require typed confirmation and only allow purging accounts with zero linked data anyway (which would have been hard-deleted in the first place — so purge is mostly redundant).
