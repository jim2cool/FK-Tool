# FK-Tool — Active Context

> READ THIS FIRST every session. Keep it current.
> Last updated: 2026-03-24

---

## Current Focus
**Label Sorting feature shipped.** 2-tab system live (Sort Labels + Crop Profiles). Next: polish Label Sorting (edit profiles, invoice cropping, custom sizes) → then P&L module.

## Last Session (2026-03-24)
**What happened:**
- Extended brainstorm on product vision — established FK-Tool as SaaS for Indian sellers
- Corrected org/account mapping, locations, established "build for the cohort" principle
- Merged tenants: shashwat + finance now share tenant "Nuvio", deleted test tenant
- Fixed Nuvio D2C org assignment (was ESS Collectives → E4A)
- Fixed PDF.js worker: local file instead of CDN (CDN fails in Docker)
- Built user-guided crop selector: draw rectangle on PDF page, aspect-ratio locked to label size
- Built named crop profiles: save/load/delete from localStorage
- Built 2-tab Label Sorting page: Sort Labels (daily workflow) + Crop Profiles (configuration)
- Label sizes: 4x6, 4x4, 3x5, 2x1 inches
- Output: cropped + sorted + scaled to exact label size, edge-to-edge fill
- Multiple iterations on cropping approach: auto-detect failed → user-guided succeeded
- Demo passed successfully

**Commits this session:** `5c2d5d8` through `d63ee55` (10 commits)
**Deployed:** Yes, multiple times throughout session

**Key decisions:**
- Auto-detection of label boundaries is unreliable — user-guided crop is the way
- Crop profiles stored in localStorage for now, move to DB later for multi-device
- 2-tab design: separate config (profiles) from daily workflow (sorting)
- Invoice cropping needed for Amazon (separate A4 printout) — future work

## What's Next
1. **Polish Label Sorting:** edit profiles, invoice crop area, custom label sizes, move profiles to DB
2. **P&L per SKU** — settlement CSV import, match to orders, true profit calculation
3. **Inventory Pipeline** — returns grading, live inventory, claims management

See `docs/project-brain/BUILD-TRACKER.md` for full phased roadmap.

## Active Decisions
- No worktrees. Work directly on `main`.
- FK-Tool is on port 3001 on Hetzner (Easy-D2C is 3000).
- Always deploy after push — no auto-deploy.
- Vision doc: `docs/superpowers/specs/2026-03-23-fktool-vision-and-roadmap.md`
- Both shashwat@e4a.in and finance@e4a.in share tenant "Nuvio" with owner role.
- Build for the cohort — every feature must work for any Indian seller, not just the dog-food account.
