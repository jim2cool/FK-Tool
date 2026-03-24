# FK-Tool — Active Context

> READ THIS FIRST every session. Keep it current.
> Last updated: 2026-03-24

---

## Current Focus
**Label Sorting feature complete with all polish.** 2-tab system, crop profiles, invoice cropping, custom sizes, inline rename. Next: move profiles to DB, then P&L module.

## Last Session (2026-03-24)
**What happened:**
- Extended brainstorm on product vision — FK-Tool as SaaS for Indian sellers
- Corrected org/account mapping, merged tenants (shashwat + finance share "Nuvio")
- Built complete Label Sorting feature with 20+ commits:
  - 2-tab system (Sort Labels + Crop Profiles)
  - User-guided crop with aspect-ratio lock to label size
  - Named crop profiles (save/load/delete/rename)
  - Label sizes: 4x6, 4x4, 3x5, 2x1, A4, Custom
  - Invoice cropping: freeform second crop, A4 output, proportional scaling
  - Edit profiles (pencil icon) + inline rename (click name in table)
  - Fixed: CDN worker failure, dropzone re-firing, canvas shift, aspect ratio distortion
  - Platform-agnostic text (removed Flipkart-specific wording)
- Demo passed successfully mid-session

**Commits:** `5c2d5d8` through `457263c` (20+ commits)
**Deployed:** Yes, many times throughout session

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
