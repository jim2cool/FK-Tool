# FK-Tool — Active Context

> READ THIS FIRST every session. Keep it current.
> Last updated: 2026-03-25

---

## Current Focus
**Combo/bundle SKU support shipped.** Users can create combos (multi-product bundles + single-product volume packs), map platform SKUs to them, and label sorting resolves combos into component products. Next: continue mapping all unmapped combo SKUs on live site, then move to next roadmap item.

## Last Session (2026-03-25)
**What happened:**
- Built combo SKU mapping UI — platform SKUs can now be mapped to combos from the Combos tab
- Lowered combo minimum from 2 to 1 component (enables volume packs like "Soap 3-Pack" = 1 product x3)
- Added "Add Mapping" button to Products tab for unmapped SKUs (was just a static badge before)
- Added "+ Add" link for already-mapped SKUs to add additional channel mappings
- Fixed duplicate constraint error: API now reassigns existing mapping when platform SKU already mapped elsewhere
- Edit dialog supports both "add" (POST) and "edit" (PATCH) modes

**Commits:** `ff2d3a4` through `842a548` (3 commits)
**Deployed:** Yes, 3 times throughout session

## What's Next
1. **Move crop profiles to DB** — currently localStorage only
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
