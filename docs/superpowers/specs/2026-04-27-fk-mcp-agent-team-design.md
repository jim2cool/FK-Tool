# FK MCP Agent Team — Design Spec

**Date:** 2026-04-27
**Status:** Approved for implementation planning
**Supersedes:** `2026-04-27-flipkart-manager-design.md` (the standalone-Python-MCP version, kept for reference but not implemented)
**Context:** This is the integrated design for what was originally drafted as a standalone "Flipkart Manager." After brainstorming, we re-framed it as an **agent-team module of fk-tool**, sharing fk-tool's database, API, and infrastructure — not a parallel system.

---

## 1. Why this exists

Running a multi-account Flipkart reseller business (10 marketplace accounts, 200+ SKUs, 7,500+ orders) is currently a sequence of manual steps: log into each FK Seller Hub, download reports, upload to fk-tool, check pricing, watch for hijackers, read FK policy updates. fk-tool already solves the **measurement** problem (P&L, COGS, labels, inventory). What it doesn't solve is the **operational** layer — the daily decisions and actions a competent operations team would take.

The goal is to build that operations team as software: a Chief of Staff agent (Claude Code) that you talk to, plus specialist subagents for pricing, ads, content, competitor intelligence, and so on — all reading from fk-tool's existing data and acting on FK Seller Hub through automation.

**Crucial reframe vs. the original spec:** the original "Flipkart Manager" was designed as a standalone Python project with its own SQLite DB. It would have created two sources of truth for the same data. This design instead **integrates everything into fk-tool**: same Postgres DB, same API, same infrastructure. The MCP server is a thin layer; fk-tool is the system of record.

---

## 2. What we're building

A multi-agent system that runs entirely inside Claude Code on your Max 5x subscription, with **zero additional API costs**. Components:

- **One Python MCP server** (`flipkart-mcp/`) exposing tools for DB access, FK scraping, FK report ingestion, and FK documentation search.
- **Claude Code subagent definitions** (`.claude/agents/*.md`) — one markdown file per specialist. The Chief of Staff is the default Claude Code session; specialists are dispatched via the `Agent` tool.
- **fk-tool's existing Supabase DB and API** — unchanged. The MCP server reads directly from Supabase and writes through fk-tool's existing routes.
- **An FK Docs RAG index** — local ChromaDB, scraped weekly from FK seller help pages, used by every agent that needs to consult current FK rules.

Anything you can do in Claude Code today, you can do across this team. Anything the team can change in fk-tool's data shows up in the fk-tool UI immediately, because it's the same database.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Claude Code (your Max 5x — no extra cost)                   │
│                                                              │
│   Chief of Staff (default session)                           │
│      │                                                       │
│      └── dispatches via Agent tool to specialist subagents:  │
│            ├── ingestion-agent      (.claude/agents/*.md)    │
│            ├── pricing-agent                                 │
│            ├── competitor-agent                              │
│            ├── ads-agent                                     │
│            └── ... (one .md file = one specialist)           │
└─────────────────────────────┬────────────────────────────────┘
                              │ MCP protocol
              ┌───────────────▼───────────────┐
              │   fk-tool MCP Server          │
              │   (Python, runs locally       │
              │    or on Hetzner)             │
              │                               │
              │   tools/                      │
              │     db.py        (Supabase)   │
              │     fetch.py     (Playwright) │
              │     ingestion.py (reports)    │
              │     docs.py      (FK RAG)     │
              │     pricing.py                │
              │     ads.py                    │
              │     ...                       │
              └───┬─────────────┬─────────┬───┘
                  │             │         │
        ┌─────────▼──┐  ┌───────▼──┐  ┌───▼──────────┐
        │ Supabase   │  │ FK Hub   │  │ FK Help Docs │
        │ (fk-tool   │  │ (live    │  │ (vector idx, │
        │  shared DB)│  │  scrape) │  │  ChromaDB)   │
        └────────────┘  └──────────┘  └──────────────┘
```

### 3.1 Three external surfaces, three tool categories

Every tool in the MCP server fits exactly one of these three:

1. **Supabase reads** — `tools/db.py` queries fk-tool's existing tables. Tenant-scoped (see §3.5 for how the MCP server resolves tenant).
2. **Live FK Seller Hub** — `tools/fetch.py` (synchronous, on-demand) and `tools/ingestion.py` (asynchronous, scheduled). Both use Playwright; both share `shared/playwright_session.py`.
3. **FK Docs RAG** — `tools/docs.py` queries the local ChromaDB vector index, returns chunks with source URLs.

### 3.2 Read/write split (decided, not open)

- **Reads** go directly to Supabase via `supabase-py` with the service-role key. Fast, flexible, joins across all tables.
- **Writes** go through fk-tool's existing HTTP API routes — confirmed real routes: `/api/pnl/import`, `/api/pnl/import-orders`, `/api/pnl/import-returns`, `/api/pnl/import-settlement`, `/api/purchases/import-csv`, `/api/catalog/import-csv`, `/api/labels/ingest`. This preserves tenant isolation, dedup logic, validation, and audit trails.

### 3.3 Tenant resolution

The MCP server uses Supabase's service-role key (no logged-in user), so it cannot use fk-tool's `getTenantId()` helper. Instead:

- **Phase 0–4:** Tenant ID is set via `FK_TENANT_ID` env var in the MCP server's `.env`. Single-tenant by configuration. Defaults to the "Nuvio" tenant (`2d1f3411-2b1a-4674-a5ec-353bbd82ebb8`).
- **Future (multi-tenant):** Tool calls accept an optional `tenant_id` argument; if present, overrides the env default. Out of scope until a second tenant exists.

When the MCP server calls fk-tool's HTTP API, it forwards a service-role JWT minted with the tenant's owner user ID, so existing tenant-scoping middleware works unchanged.

### 3.4 Sync vs. async ingestion

- **Async (Ingestion Agent, scheduled):** OS cron triggers a job that uses Playwright to check FK's "My Reports" page, downloads any new reports, parses them, posts them to fk-tool's import API. Default daily for orders/returns, weekly for settlement.
- **Sync (Fetch tools, on-demand):** When a specialist needs data not in the DB (live competitor price, current buy box winner, real-time inventory on FK), it calls a fetch tool. The tool spins up a Playwright page, scrapes, returns. Results are optionally cached to DB.
- **Manual uploads:** fk-tool's existing CSV import flows are unchanged. Always available as a fallback.

### 3.5 Autonomy model

| Action class | Behavior |
|---|---|
| Read / sync | Auto-execute |
| Safe writes (e.g., flag a competitor as a hijacker — local DB only) | Auto-execute, logged |
| Risky writes (price change, inventory adjustment ≥ 10%, listing edit) | Specialist proposes → CoS surfaces to you with full diff → you approve → executes |
| Destructive (remove listing, cancel order) | Always asks; never auto |

Every action — auto or approved — is appended to `actions_log` in fk-tool's DB. fk-tool can later expose a UI tab to review this history.

### 3.6 Approval flow primitive

`shared/approval.py` exposes two functions, used by every risky/destructive action tool:

```python
async def request_approval(
    tenant_id: str,
    agent_name: str,
    action_type: str,        # e.g., "price_update", "inventory_adjust"
    payload: dict,           # everything needed to execute
    diff_summary: str        # human-readable, what CoS will show the user
) -> int:
    """Inserts a row into actions_log with status='pending_approval'.
    Returns the action_id. Does NOT block — returns immediately."""

async def confirm_approval(action_id: int) -> dict:
    """Marks the action as approved, executes the underlying operation
    (Playwright write, API call, etc.), updates status to 'approved' or
    'failed', writes result. Returns the executed payload."""
```

**Conversation mechanics:** A specialist tool calls `request_approval(...)` and returns to CoS with the action_id and diff. CoS displays the diff to the user in chat. The user types "yes" (or equivalent). CoS calls a separate MCP tool `confirm_action(action_id)` (exposed at the top level of the MCP server, implemented in `shared/approval.py`) which invokes `confirm_approval`. There is no auto-execute path — `confirm_approval` exists only as the response to an explicit user "yes."

---

## 4. The Specialist Contract (the modularity guarantee)

Every specialist agent follows the same five rules. Adding a new specialist is **one markdown file plus one tool module**, never more.

1. **One markdown file per specialist** in `.claude/agents/<name>.md`. Uses Claude Code's native subagent definition format (YAML frontmatter with `name`, `description`, `tools` allowlist; markdown body is the system prompt). Claude Code auto-discovers files in this directory at session start. CoS dispatches via the `Agent` tool with `subagent_type=<name>`.
2. **DB access only via `tools/db.py`.** No specialist queries Supabase directly.
3. **Live data only via `tools/fetch.py`.** No specialist opens its own Playwright session.
4. **Writes only via `shared/approval.py`.** No specialist bypasses the approval gate for risky/destructive actions.
5. **FK rule consultations only via `tools/docs.py`.** No specialist assumes FK policy from training data.

The Chief of Staff is the only agent you talk to. Specialists never talk to each other; the CoS is the message bus. This keeps the mental model coherent ("a team that reports to a chief of staff") and avoids the failure modes of free-form agent-to-agent chatter.

---

## 5. Phased build (modular, day-1 useful)

Each phase ships independently and is useful on its own. No phase requires the next to be valuable.

### Phase 0 — "Chief of Staff Online" (Week 1)
**Outcome:** Claude Code can answer any question about your business by reading fk-tool's DB.

- Python project scaffolding (`pyproject.toml`, `src/` layout, `.env` template)
- MCP server skeleton using `mcp` SDK
- `tools/db.py`: `get_orders`, `get_skus`, `get_pnl`, `get_purchases`, `get_inventory`, `get_cogs`, `search_skus`
- `.claude/agents/chief-of-staff.md` — system prompt + tool allowlist
- `.mcp.json` config so Claude Code starts the server on session start

**Success criteria:** Five real business questions answered from the DB without opening fk-tool.

### Phase 1 — "Ingestion Agent" (Week 2–3)
**Outcome:** Stop manually downloading and uploading FK reports.

- `shared/playwright_session.py` — auth, cookie persistence, session validity check, re-login
- `tools/ingestion.py` — report watcher (orders, returns, P&L, settlement)
- HTTP client to post to fk-tool's confirmed import routes: `/api/pnl/import-orders`, `/api/pnl/import-returns`, `/api/pnl/import`, `/api/pnl/import-settlement`
- Cron / Windows Task Scheduler entries for daily and weekly jobs
- `.claude/agents/ingestion-agent.md` — handles ad-hoc report triggers
- **Backfill logic:** on each cron run, watcher reads fk-tool's `imports` table to find the date of the last successful import per report type, then downloads any FK reports newer than that date. **If the `imports` table does not already track `report_type` and `succeeded_at` columns, this phase adds them via a migration.** Existing per-route dedup logic in fk-tool handles duplicate rows.
- **`actions_log` table created in this phase** via Supabase migration. Schema:
  ```sql
  CREATE TABLE actions_log (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    agent_name      TEXT NOT NULL,         -- 'ingestion-agent', 'pricing-agent', etc.
    action_type     TEXT NOT NULL,         -- 'report_import', 'price_update', ...
    payload         JSONB NOT NULL,        -- everything needed to execute or replay
    diff_summary    TEXT,                  -- human-readable what changed
    status          TEXT NOT NULL DEFAULT 'pending_approval',
                                           -- pending_approval | auto_executed | approved | rejected | failed
    approval_outcome TEXT,                 -- 'as_is' | 'modified' | 'rejected' (for tracking metric)
    approved_by     UUID REFERENCES auth.users(id),
    initiated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    result          JSONB,                 -- execution output or error
    notes           TEXT
  );
  CREATE INDEX idx_actions_log_tenant_status ON actions_log(tenant_id, status);
  CREATE INDEX idx_actions_log_agent ON actions_log(tenant_id, agent_name, initiated_at DESC);
  ```
- Every import — auto or manual — writes to `actions_log`.

**Success criteria:** A full week without manual report uploads.

### Phase 2 — "FK Docs MCP" (Week 4)
**Outcome:** Every agent (current and future) knows current FK rules.

- Scraper for FK seller help / policy pages (lives in `tools/docs.py`)
- ChromaDB index, file-backed, in `data/fk-docs-index/`
- Local embeddings via `sentence-transformers` (no API cost)
- Tools: `flipkart_search_docs(query)`, `flipkart_recent_policy_changes(since_date)`
- Weekly cron re-scrape with diff detection
- Every doc tool response includes the source URL — agents quote, never paraphrase

**Success criteria:** A policy question is answered with a citation to a current FK help page URL.

### Phase 3 — "Pricing Agent" (Week 5–6)
**Outcome:** First specialist. Weekly pricing reviews go from manual to proposal-and-approve.

- `tools/fetch.py`: `fetch_buy_box`, `fetch_competitor_prices`
- `tools/pricing.py`: `propose_price_change` (read-only analysis), `execute_price_change` (approval-gated, writes via Playwright)
- `shared/approval.py`: standard approval flow used by every risky action
- `.claude/agents/pricing-agent.md`
- Pricing agent reads: COGS, current price, competitor prices (live), buy box status, sales velocity, floor price, current FK fee rules (via docs)

**Success criteria:** You run a pricing review weekly; within a month, ≥70% of proposals approved as-is.

### Phase 4 — "Competitor Intelligence Agent" (Week 7)
**Outcome:** Hijackers and buy-box losses surface daily without you checking.

- **New tables** (Supabase migration in this phase):
  ```sql
  CREATE TABLE competitors (
    seller_id              TEXT NOT NULL,
    tenant_id              UUID NOT NULL REFERENCES tenants(id),
    seller_name            TEXT,
    flagged_as_hijacker    BOOLEAN DEFAULT FALSE,
    notes                  TEXT,
    first_seen             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, seller_id)
  );

  CREATE TABLE price_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    master_sku_id       UUID REFERENCES master_skus(id),
    fsn                 TEXT,                 -- raw FK identifier
    seller_id           TEXT,
    seller_name         TEXT,
    price               NUMERIC(10,2),
    is_buy_box_winner   BOOLEAN,
    is_you              BOOLEAN,
    snapped_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_price_snapshots_sku_time ON price_snapshots(tenant_id, master_sku_id, snapped_at DESC);
  CREATE INDEX idx_price_snapshots_seller_time ON price_snapshots(tenant_id, seller_id, snapped_at DESC);

  CREATE TABLE daily_brief (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    brief_date      DATE NOT NULL,
    agent_name      TEXT NOT NULL,           -- 'competitor-agent', etc.
    summary         TEXT NOT NULL,           -- agent-generated narrative for CoS
    payload         JSONB NOT NULL,          -- structured data CoS can drill into
    read_by_cos_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, brief_date, agent_name)
  );
  ```
- `tools/competitor.py`: `fetch_all_listings_competitors`, `flag_hijacker`, `get_competitor_history`
- Competitor agent posts daily summaries to `daily_brief`; CoS reads unread briefs on next conversation
- `.claude/agents/competitor-agent.md`
- Daily cron job

**Success criteria:** You stop manually checking buy box / competitor listings.

### Phase 5+ — Specialists on demand
Each is one `.md` file plus one tool module. Suggested order:
- Ads Agent (ROAS, campaign recommendations)
- Catalog Agent (listing health, missing fields)
- Content Agent (title/description optimization)
- Returns Agent (claims filing assistance)
- Inventory Agent (reorder alerts, stock-out forecasting)

---

## 6. Project structure

```
fk-tool/                                  (existing repo)
├── .claude/
│   ├── agents/
│   │   ├── chief-of-staff.md            ← Phase 0
│   │   ├── ingestion-agent.md           ← Phase 1
│   │   ├── pricing-agent.md             ← Phase 3
│   │   ├── competitor-agent.md          ← Phase 4
│   │   └── ...
│   └── settings.json                     ← MCP server config
├── flipkart-mcp/                         (NEW — the MCP server)
│   ├── pyproject.toml
│   ├── .env.example
│   ├── .gitignore                        (excludes .env, .cache/, data/)
│   ├── src/
│   │   └── flipkart_mcp/
│   │       ├── server.py                 (MCP entry point)
│   │       ├── tools/
│   │       │   ├── db.py                 ← Phase 0
│   │       │   ├── ingestion.py          ← Phase 1
│   │       │   ├── docs.py               ← Phase 2
│   │       │   ├── fetch.py              ← Phase 3
│   │       │   ├── pricing.py            ← Phase 3
│   │       │   ├── competitor.py         ← Phase 4
│   │       │   └── ...
│   │       └── shared/
│   │           ├── playwright_session.py
│   │           ├── supabase_client.py
│   │           ├── fktool_api_client.py
│   │           └── approval.py
│   ├── scripts/
│   │   ├── ingest_reports_cron.py
│   │   ├── scrape_fk_docs_cron.py
│   │   └── competitor_scan_cron.py
│   └── tests/
│       ├── conftest.py                   (mock Supabase, mock Playwright)
│       ├── test_tools/
│       └── fixtures/                     (saved FK Hub HTML pages)
└── ... (rest of fk-tool unchanged)
```

The MCP server lives **inside the fk-tool repo** so it deploys alongside fk-tool and version-controls together. It is its own Python project (its own `pyproject.toml` and venv) so the Next.js side doesn't drag Python deps.

---

## 7. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | Python 3.12 | Best ecosystem for Playwright + MCP SDK |
| MCP framework | `mcp` (Anthropic SDK) | Official; native Claude Code integration |
| Browser automation | `playwright` (Python, async) | Reliable for FK Hub; same as original spec |
| Database access | `supabase-py` (service-role key) | Direct reads from fk-tool's Postgres |
| Write actions | HTTP to fk-tool's `/api/*` routes | Preserves validation, dedup, tenant isolation |
| Vector store | `chromadb` (local, file-backed) | No cloud cost; runs on laptop or Hetzner |
| Embeddings | `sentence-transformers` (CPU) | No API cost; sufficient for FK help docs |
| Scheduler | OS cron / Windows Task Scheduler | Simpler than APScheduler; one-line per job |
| Auth secrets | `.env` + OS keychain | No new secrets infra |
| Testing | `pytest` + saved HTML fixtures + mocks | Fully offline; no live FK or Claude calls |

**No new cloud services.** No Pinecone, no OpenAI embeddings, no separate Postgres, no Redis.

---

## 8. Deployment

### Phase A — Development (Phase 0–4)
Runs on your local machine.
- The `flipkart-mcp/` sub-folder lives inside the fk-tool repo for version control, but during Phase A it is **excluded from the Next.js Docker build** (added to `.dockerignore`). The MCP server is run independently from your local clone via `python -m flipkart_mcp.server` (or the installed entry point).
- MCP server started by Claude Code on session start (`.mcp.json` in the repo root points at the local Python entry)
- Playwright headed Chromium (you see what it does)
- Cron jobs via OS scheduler
- Supabase access via the public Supabase URL

### Phase B — Production (when stable)
Moves to the Hetzner VPS that already runs fk-tool (`46.225.117.86`).
- The `flipkart-mcp/` folder is removed from `.dockerignore` and either (a) bundled into the existing fk-tool Docker image as a sidecar Python service, or (b) run as a separate systemd service on the host alongside the Docker container. Decision deferred to Phase B kickoff based on operational preference.
- Playwright headless with persistent Chromium profile
- Cron jobs are systemd timers
- You connect from Claude Code via remote MCP (SSH tunnel or HTTPS)

Migration A → B is "copy the folder, install deps, set up systemd." No code changes.

---

## 9. Security

- FK credentials live in OS keychain (preferred) or `.env` with `chmod 600` (fallback)
- Session cookies persisted to disk, encrypted at rest
- 2FA: pre-recorded recovery codes stored in keychain; on session expiry, surface a notification rather than silent retry
- `.cache/` and `.env` are gitignored
- Supabase service-role key restricted to the MCP server process only
- All approval-gated actions require an explicit "yes" from the user — never one-click approval

---

## 10. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| FK detects automation, blocks the account | Medium | Catastrophic | Conservative rate limits (≥2s between actions), real Chrome profile when possible, manual fallback always available |
| FK Seller Hub UI changes break scrapers | High | High | DOM-first with vision fallback (Claude vision for layout-changed pages); per-domain failure isolation |
| FK 2FA breaks unattended sessions | Medium | Medium | Pre-recorded recovery codes; user notification on expiry, not silent retry |
| Playwright session cookie leaks | Low | Catastrophic | Cookies in OS keychain, file permissions locked, never committed |
| Specialist gives bad advice from stale data | Medium | Low–Medium | Every tool response includes `as_of`; CoS surfaces staleness to user |
| Auto-import overwrites manual edits | Medium | Medium | Importers detect manual modifications; conflicts surface as review items, not silent overwrite |
| Vector index hallucinates FK rules | Low | High | Doc tools always return source URL; CoS quotes the source, never paraphrases |
| Approval-gated action gets auto-approved | Low | Catastrophic | Two-step: agent proposes → CoS shows diff → user types "yes" — never one-click |

---

## 11. Open questions to resolve before Phase 0 starts

1. **FK 2FA setup** — does your FK Seller account use 2FA? SMS or app-based? (Determines auth manager design.)
2. **MCP server location** — local first (your dev machine), or straight to Hetzner? (Local is simpler; Hetzner means cron survives your laptop sleeping.)
3. **Multi-account FK Hub** — single MCP server with multiple session profiles vs. one server per account. (Lean: single server, account passed as a tool arg.)

(Question 4 from prior draft — "API vs. direct DB for writes" — resolved as decided in §3.2: writes go through fk-tool's HTTP API.)

---

## 12. Verification plan (per phase)

### Phase 0
- Run `pytest tests/test_tools/test_db.py` against a `MockSupabase` populated with known data — every tool returns expected shape.
- Boot Claude Code with the MCP server configured. Ask: "What are my top 5 losing SKUs this month?" — CoS produces an answer matching what fk-tool's `/pnl` page shows.

### Phase 1
- Unit-test the report parser against saved FK report fixtures (one per report type) — assert correct row counts and field values.
- Manually trigger `scripts/ingest_reports_cron.py` against a fresh FK session — assert the report lands in fk-tool's DB and is visible in the fk-tool UI.
- Disable the cron for a week, then re-enable; assert it backfills the missed days.

### Phase 2
- Run `scripts/scrape_fk_docs_cron.py` — assert ChromaDB has the expected number of documents.
- Modify a fixture page and re-run; assert the change is detected and logged.
- Ask CoS a policy question; assert the response includes a source URL pointing to a real FK help page.

### Phase 3
- Unit-test `propose_price_change` against mocked competitor data — assert proposals respect floor price.
- Run a real pricing review against 5 SKUs; manually verify each proposal's reasoning before approving.
- Approve one change end-to-end; assert the price updates on FK and is logged in `actions_log`.

### Phase 4
- Unit-test `flag_hijacker` upsert logic.
- Run the daily competitor scan against 10 SKUs; assert `daily_brief` row is created with the expected hijacker count.
- Verify CoS surfaces the brief on the next conversation.

---

## 13. Success metrics (when do we know this worked?)

- **Phase 0:** Five real business questions answered from CoS without opening fk-tool.
- **Phase 1:** Full week with zero manual report uploads.
- **Phase 2:** A policy question answered with a citation to a current FK help URL.
- **Phase 3:** Within 30 days, ≥70% of pricing proposals approved as-is. **Measured via** the `approval_outcome` column on `actions_log` (added in Phase 1): count of `approval_outcome = 'as_is'` ÷ total `pricing-agent` actions.
- **Phase 4:** You stop manually checking buy box / competitor listings.
- **Long-term:** Time spent in FK Seller Hub drops by ≥80%; time spent in Claude Code conversation with CoS becomes the new operations pattern.

---

## 14. What this design intentionally does NOT include (YAGNI)

- **No Anthropic Agent SDK.** Max 5x doesn't cover it; multi-agent on Max via subagent definitions in Claude Code is sufficient.
- **No multi-marketplace abstraction yet** (Amazon, Meesho). Build for FK first; generalize only when a second marketplace ships.
- **No fk-tool UI changes for the agent system in Phase 0–4.** All interaction is via Claude Code. A UI tab for `actions_log` and `daily_brief` can come later if/when needed.
- **No real-time push notifications.** Daily briefs and on-demand conversation are the interaction model. No webhooks, no Slack, no email.
- **No agent-to-agent chatter.** CoS is the only orchestrator. Specialists report to CoS, never to each other.

---

## 15. Relationship to the original "Flipkart Manager" spec

The original spec (`2026-04-27-flipkart-manager-design.md`) remains useful as a reference for:
- The FK domain knowledge it captured (data model fields, scraping considerations, vision fallback pattern)
- The autonomy model
- The auth/session design

But its **architecture is superseded** by this document. Specifically:
- SQLite is replaced by fk-tool's existing Supabase Postgres
- Standalone Python project becomes a sub-folder of fk-tool
- Single-process MCP server is kept, but specialists are now Claude Code subagents (not separate processes or Agent SDK instances)
- The "knowledge base" is upgraded from an open question to a Phase 2 deliverable (FK Docs RAG)
