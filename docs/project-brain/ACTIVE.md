# FK-Tool — Active Context

> READ THIS FIRST every session. Keep it current.
> Last updated: 2026-03-25

---

## Current Focus
**Combo/bundle SKU support shipped. Crop profiles DB migration started.** The `crop_profiles` table exists in Supabase but API + UI swap not done yet. Next session: build CRUD API, replace localStorage reads/writes with API calls.

## Last Session (2026-03-25)
**What happened:**
- Built combo SKU mapping UI — platform SKUs can now be mapped to combos from the Combos tab
- Lowered combo minimum from 2 to 1 component (enables volume packs like "Soap 3-Pack" = 1 product x3)
- Added "Add Mapping" button to Products tab for unmapped SKUs (was just a static badge before)
- Added "+ Add" link for already-mapped SKUs to add additional channel mappings
- Fixed duplicate constraint error: API now reassigns existing mapping when platform SKU already mapped elsewhere
- Edit dialog supports both "add" (POST) and "edit" (PATCH) modes
- Created `crop_profiles` table in Supabase (empty, API not built yet)

**Commits:** `ff2d3a4` through `d022d05` (4 commits)
**Deployed:** Yes, 3 times throughout session

## What's Next
1. **Finish crop profiles → DB migration** — table exists, need: CRUD API (`/api/labels/crop-profiles`), replace `loadProfiles()`/`saveProfiles()` in `LabelCropSelector.tsx` + `labels/page.tsx` with fetch calls
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
