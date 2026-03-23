# FK-Tool — Build Tracker

> Single source of truth for ALL remaining work.
> Update after every brainstorm, plan, and session.
> Last updated: 2026-03-23

---

## ✅ Completed

| Feature | Session | Notes |
|---------|---------|-------|
| Master Catalog (CSV import + manual add) | Pre-memory | Parent/variant structure, column mapping |
| Purchases page (CSV import, filters, pagination) | Pre-memory | Month accordions, GST columns, bulk delete |
| Freight Invoices | Pre-memory | |
| Packaging Materials + SKU Specs | Pre-memory | |
| COGS Engine (WAC + freight + dispatch + shrinkage) | Pre-memory | Expandable breakdown, editable rates |
| Duplicate detection — purchases CSV | 2026-03-23 | Preview warning + skip |
| Duplicate detection — catalog manual add | 2026-03-23 | 409 on duplicate name |
| Catalog warehouse aggregation fix | 2026-03-23 | Includes parent-ID purchases |

---

## 🔵 Backlog — Prioritised

### P1 — High Value / Design Doc Exists
- [ ] **User Roles** — admin vs. viewer, role-based access. Design doc: `docs/plans/2026-03-06-user-roles-onboarding-info-design.md`
- [ ] **Onboarding Checklist** — dashboard getting-started checklist. Design doc: `docs/plans/2026-03-06-user-roles-onboarding-info-design.md`
- [ ] **Info Icons** — `<InfoTooltip>` on every non-obvious field across all pages. Design doc: same

### P2 — Core Functionality
- [ ] **Inventory & P&L page** — stock levels, profit/loss per SKU, sell-through rates
- [ ] **Import Data page** — centralised import history, re-import, error review

### P3 — Quality of Life
- [ ] **Fuzzy SKU matching on catalog import** — conflict-review dialog when incoming name ≈ existing name
- [ ] **Tax liability section** — use `tax_paid` + `gst_rate_slab` data for GST reporting
- [ ] **Received date tracking** — currently optional; make it part of COGS lot calculation

---

## 🔴 Known Bugs / Tech Debt
- None currently active
