# FK-Tool — Active Context

> READ THIS FIRST every session. Keep it current.
> Last updated: 2026-03-25

---

## Current Focus
**Label Sorting feature fully complete.** Crop profiles moved from localStorage to DB. Combo/bundle SKU support shipped. Next: fix combo SKU mapping issue (reassign existing mapping when platform SKU is re-mapped from product to combo), then move to P&L.

## Last Session (2026-03-25, session 2)
**What happened:**
- Built CRUD API for crop profiles at `/api/labels/crop-profiles` (GET, POST, PATCH, DELETE)
- Replaced all localStorage reads/writes with API calls in `LabelCropSelector.tsx` + `labels/page.tsx`
- Auto-migration: existing localStorage profiles pushed to DB on first load, then localStorage cleared
- Both existing profiles ("Flipkart Label Only" + "Flipkart with Invoice") migrated successfully
- Verified on live site — profiles load from DB, Crop Profiles tab shows 2 profiles

**Commits:** `ba171e0`
**Deployed:** Yes

## Known Bug to Fix Next
- **Combo SKU mapping fails if platform SKU was previously mapped to a product** — unique constraint on `(tenant_id, platform, platform_sku)` blocks the insert. The product→product reassignment works (POST auto-reassigns), but the combo mapping dialog doesn't use this same logic. Fix: make combo mapping dialog hit the same reassignment-aware endpoint.

## What's Next
1. **Fix combo SKU mapping reassignment** — when mapping a platform SKU to a combo that's already mapped to a product, update instead of insert
2. **P&L per SKU** — settlement CSV import, match to orders, true profit calculation
3. **Inventory Pipeline** — returns grading, live inventory, claims management

See `docs/project-brain/BUILD-TRACKER.md` for full phased roadmap.

## Active Decisions
- No worktrees. Work directly on `main`.
- FK-Tool is on port 3001 on Hetzner (Easy-D2C is 3000).
- Always deploy after push — no auto-deploy.
- Vision doc: `docs/superpowers/specs/2026-03-23-fktool-vision-and-roadmap.md`
- Both shashwat@e4a.in and finance@e4a.in share tenant "Nuvio" with owner role.
- Build for the cohort — every feature must work for any Indian seller.
