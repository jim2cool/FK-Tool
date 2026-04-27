# Flipkart Manager — Design Spec
**Date:** 2026-04-27  
**Status:** Approved for implementation  
**Context:** This is a feature module of **fk-tool**, a broader SaaS product for online seller operations and finance management. This document is self-contained — it can be handed into the fk-tool project session for integration.

---

## 1. Problem Statement

Managing a Flipkart reseller business (50–300 SKUs) is fragmented and manual: pricing decisions are reactive, inventory surprises happen, orders slip through, hijackers steal buy boxes, and there's no single view of whether the business is hitting its targets. The goal is to make this **systematic, process-driven, and accurate** — with Claude Code as the primary interface.

**Key constraints:**
- Flipkart does not provide a public API for third-party sellers.
- All automation must go through the Flipkart Seller Hub web interface (browser automation).
- The user is a reseller whose brand identity and buy box can be captured by competitors.

---

## 2. What We're Building

A **Flipkart Automation Module** that lives inside fk-tool, exposing Flipkart capabilities as MCP (Model Context Protocol) tools. The user interacts entirely through chat with Claude Code. Claude calls the tools, which use Playwright to operate the Flipkart Seller Hub, and stores all data in a local/shared database.

**This is not a dashboard.** The interface is conversation — you ask, Claude acts or reports.

---

## 3. Architecture

```
User (Claude Code chat)
        ↓  MCP tool calls
  Flipkart MCP Server  (Python, runs locally)
    ├── Auth Manager       (Playwright session + cookie persistence)
    ├── Scraper Layer      (DOM-first + Claude vision fallback)
    ├── Action Layer       (write operations, approval-gated)
    ├── Scheduler          (APScheduler — background sync jobs)
    └── Report Engine      (generates structured reports for Claude)
        ↓
  Playwright (Chromium)
        ↓
  Flipkart Seller Hub  (browser automation, no API)
        ↕
  SQLite Database  (local, upgradeable to shared fk-tool DB)
```

### 3.1 Scraping Strategy

**Primary:** DOM extraction via Playwright selectors (fast, reliable for stable pages).  
**Fallback:** Claude vision on screenshot for dynamic/JS-heavy pages that resist DOM extraction.

Vision fallback interface (defined in `scrapers/base.py`). The `vision_fn` is injected as a dependency so it can be mocked in unit tests without hitting the Claude API:

```python
VisionFn = Callable[[Page, str, dict], Awaitable[dict]]

async def extract_with_vision(
    self,
    page: Page,
    prompt: str,           # what to extract, in plain English
    response_schema: dict, # JSON schema the response must conform to
    vision_fn: VisionFn | None = None  # injected; defaults to real Claude call
) -> dict:
    """Take a screenshot, pass to vision_fn (real Claude or mock),
    validate response against response_schema.
    Raises ExtractionError if response does not conform."""
```

In tests, pass a deterministic `vision_fn` mock. In production, `vision_fn` defaults to the Anthropic SDK call.

**Rate limiting:** A configurable inter-request delay (default: 2s) is enforced between all Playwright page navigations. On HTTP 429 or CAPTCHA detection, the scraper applies exponential backoff (2s, 4s, 8s, max 60s) before retrying. After 3 failed retries, the domain is marked `failed` and the sync continues to remaining domains.

**Session cookie persistence:** Cookies are serialised to `session_cookie_path` after each successful login. On each scraper run, cookies are loaded and a validity check is performed (load a known Seller Hub page and assert the logged-in state). If invalid, the auth manager re-logs in before proceeding.

**Mid-scrape session expiry:** If a session expires mid-sync, the scraper catches the redirect to the login page, triggers a silent re-login, and retries the failed page once. If re-login fails, the current domain sync is marked `failed` and the sync continues. Partial results are committed; the sync summary notes which domains failed.

### 3.2 Autonomy Model

| Action Type | Behaviour |
|---|---|
| Read / sync | Auto-execute |
| Safe writes (stock corrections < 10% of current quantity) | Auto-execute, logged |
| Risky writes (pricing, listing edits, stock changes ≥ 10%) | Propose to user, execute on approval |
| Destructive (remove listing, cancel order) | Always ask, never auto |

All actions — auto or approved — are written to `actions_log`.

---

## 4. Integration with fk-tool

This module is designed to plug into fk-tool's shared infrastructure:

| Layer | Standalone (Phase 1) | fk-tool integrated (Phase 2) |
|---|---|---|
| Database | SQLite (local) | fk-tool shared DB (Postgres or similar) |
| Auth/session | Flipkart-specific | fk-tool auth system |
| Scheduling | APScheduler embedded | fk-tool job queue |
| MCP server | Local process | fk-tool service mesh |

All database access goes through a `Repository` abstract base class (see Section 5.2). The implementation swaps without touching the scraper, action, or report layers.

---

## 5. Data Model

### 5.1 Tables

```sql
-- Master product catalog
CREATE TABLE products (
    fsn TEXT PRIMARY KEY,           -- Flipkart Serial Number
    name TEXT NOT NULL,
    category TEXT,
    brand TEXT,
    mrp REAL,
    floor_price REAL,               -- minimum acceptable selling price (authoritative; set in DB)
    active BOOLEAN DEFAULT TRUE,
    created_at TEXT,
    updated_at TEXT
);
-- Current selling price = latest price_snapshots row WHERE fsn=? AND is_you=TRUE ORDER BY snapped_at DESC LIMIT 1
-- floor_price lives only in this table; settings.toml does NOT store per-SKU prices.

-- Stock levels over time
CREATE TABLE inventory_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fsn TEXT REFERENCES products(fsn),
    quantity INTEGER,
    warehouse TEXT,
    snapped_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_inventory_fsn_time ON inventory_snapshots(fsn, snapped_at DESC);
-- Current stock = latest row per (fsn, warehouse): SELECT * FROM inventory_snapshots WHERE fsn=? ORDER BY snapped_at DESC LIMIT 1
-- Low stock threshold: configurable per-product in products.floor_stock (see note below) or global default of 10 units.

-- Add floor_stock to products table (low-stock alert threshold)
ALTER TABLE products ADD COLUMN floor_stock INTEGER DEFAULT 10;

-- Orders (one row per order; line items are in order_lines)
CREATE TABLE orders (
    order_id TEXT PRIMARY KEY,
    status TEXT,                    -- pending / dispatched / delivered / cancelled / returned
    dispatch_deadline TEXT,
    created_at TEXT,
    updated_at TEXT
);

-- Order line items (one row per SKU per order)
-- Revenue is always computed from order_lines.selling_price × quantity, NOT from price_snapshots.
-- This ensures historical revenue reflects the actual transaction price, not the current listing price.
CREATE TABLE order_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT REFERENCES orders(order_id),
    fsn TEXT REFERENCES products(fsn),
    quantity INTEGER,
    selling_price REAL              -- price at time of order (authoritative for revenue calculations)
);
CREATE INDEX idx_order_lines_fsn ON order_lines(fsn);
CREATE INDEX idx_order_lines_order ON order_lines(order_id);

-- Price history for all sellers on your listings
CREATE TABLE price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fsn TEXT REFERENCES products(fsn),
    seller_id TEXT,
    seller_name TEXT,
    price REAL,
    is_buy_box_winner BOOLEAN,
    is_you BOOLEAN,
    snapped_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_price_fsn_time ON price_snapshots(fsn, snapped_at DESC);
CREATE INDEX idx_price_seller_time ON price_snapshots(seller_id, snapped_at DESC);
-- flipkart_check_brand_hijacks depends on this table being populated by a recent 'pricing' domain sync.
-- If price_snapshots is empty or stale, hijack checks will return stale/empty results with a warning.

-- Known competitor / hijacker sellers
-- Populated by flipkart_flag_hijacker (upsert: insert on first seen, update last_seen on repeat)
CREATE TABLE competitors (
    seller_id TEXT PRIMARY KEY,
    seller_name TEXT,
    flagged_as_hijacker BOOLEAN DEFAULT FALSE,
    notes TEXT,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now'))
);
-- On each flipkart_check_brand_hijacks scan: UPDATE competitors SET last_seen=NOW() for all seen sellers.
-- new_since_last_check baseline: sellers in this scan's price_snapshots batch NOT present in competitors table.

-- Monthly targets per SKU or category
-- fsn and category are mutually exclusive: exactly one must be non-NULL.
CREATE TABLE targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fsn TEXT,
    category TEXT,
    month TEXT NOT NULL,            -- YYYY-MM
    revenue_target REAL,
    units_target INTEGER,
    margin_floor REAL,
    CHECK ((fsn IS NOT NULL) != (category IS NOT NULL))
);
-- Category-level targets in flipkart_target_tracking are apportioned to individual SKUs
-- pro-rata by their share of last month's units sold within the category.
-- If last month has no data, the target is shown at category level only (not per-SKU).

-- Returns and cancellations
CREATE TABLE returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT REFERENCES orders(order_id),
    fsn TEXT REFERENCES products(fsn),
    reason TEXT,
    type TEXT,                      -- return / cancellation
    status TEXT,
    created_at TEXT
);

-- Customer reviews (unique per FSN + reviewer + review_date to prevent re-scrape duplicates)
CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fsn TEXT REFERENCES products(fsn),
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    review_text TEXT,
    reviewer TEXT,
    review_date TEXT,
    scraped_at TEXT DEFAULT (datetime('now')),
    UNIQUE (fsn, reviewer, review_date)
);

-- Ad performance snapshots
-- roas is NOT stored; always compute as revenue/NULLIF(spend,0) to handle zero-spend rows.
CREATE TABLE ad_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fsn TEXT REFERENCES products(fsn),
    campaign_id TEXT,
    impressions INTEGER,
    clicks INTEGER,
    spend REAL,
    revenue REAL,
    snapped_at TEXT DEFAULT (datetime('now'))
);

-- Full audit log of every action taken or proposed
-- JSON schema per action_type:
--   price_update:  {"fsn": "...", "old_price": 0.0, "new_price": 0.0}
--   stock_update:  {"fsn": "...", "old_qty": 0, "new_qty": 0, "warehouse": "..."}
--   hijack_flag:   {"seller_id": "...", "seller_name": "...", "fsn": "..."}
--   sync:          {"domains": [...], "failed_domains": [...]}
CREATE TABLE actions_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool TEXT NOT NULL,
    action_type TEXT NOT NULL,
    fsn TEXT,
    before_value TEXT,
    after_value TEXT,
    status TEXT DEFAULT 'pending',  -- pending / auto_executed / approved / rejected / failed
    initiated_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    notes TEXT
);
```

### 5.2 Schema Migrations

Migrations are managed with **Alembic** (configured against SQLite in Phase 1, Postgres in Phase 2). Every schema change — including adding columns between phases — is a versioned Alembic migration. The DB is never hand-edited. On startup, the MCP server runs `alembic upgrade head` to bring the schema current.

```
flipkart-manager/
└── alembic/
    ├── env.py
    └── versions/
        └── 001_initial_schema.py
```

### 5.3 Repository Abstraction

All database access goes through a `Repository` ABC so the storage backend can be swapped without touching business logic:

```python
class Repository(ABC):
    @abstractmethod
    async def upsert_product(self, product: Product) -> None: ...
    @abstractmethod
    async def insert_inventory_snapshot(self, snap: InventorySnapshot) -> None: ...
    @abstractmethod
    async def get_latest_price(self, fsn: str) -> PriceSnapshot | None: ...
    @abstractmethod
    async def get_current_stock(self, fsn: str, warehouse: str | None = None) -> int: ...
    @abstractmethod
    async def upsert_competitor(self, seller_id: str, seller_name: str, flagged: bool, notes: str | None) -> None: ...
    @abstractmethod
    async def get_new_competitors_since(self, since_seller_ids: set[str]) -> list[str]: ...
    @abstractmethod
    async def insert_action_log(self, entry: ActionLog) -> int: ...
    @abstractmethod
    async def update_action_status(self, log_id: int, status: str) -> None: ...

class SqliteRepository(Repository):
    """Phase 1 implementation. Swap for PostgresRepository in fk-tool integration."""
    ...
```

---

## 6. MCP Tool Manifest

### 6.1 Read / Query Tools (auto-execute)

#### `flipkart_sync`
Triggers a data pull from Seller Hub. Supports partial sync by domain.

**Input:**
```json
{
  "domains": ["inventory", "orders", "pricing", "ads", "returns", "reviews"]
}
```
*Default: all domains. Pass a subset to sync only those. Note: `flipkart_check_brand_hijacks` depends on the `pricing` domain being synced to return fresh results.*

**Output:**
```json
{
  "status": "partial|complete",
  "synced": ["inventory", "orders"],
  "failed": ["ads"],
  "records_written": {"inventory": 240, "orders": 18},
  "errors": {"ads": "Session expired mid-scrape; re-login also failed"}
}
```

---

#### `flipkart_report`
Full business snapshot.

**Input:** `{}` (no parameters)

**Output:**
```json
{
  "as_of": "2026-04-27T06:00:00",
  "revenue": {"mtd": 0.0, "target": 0.0, "gap": 0.0, "pct_achieved": 0.0},
  "units": {"mtd": 0, "target": 0, "gap": 0},
  "inventory": {"skus_low_stock": [], "skus_out_of_stock": []},
  "orders": {"open": 0, "delayed": 0, "pending_dispatch": 0},
  "buy_box": {"winning": 0, "losing": 0, "skus_at_risk": []},
  "hijackers": {"count": 0, "new_since_last_sync": []}
}
```

Revenue is computed from `order_lines.selling_price × quantity` for orders in the current calendar month where `orders.status NOT IN ('cancelled', 'returned')`.

---

#### `flipkart_search_catalog`
Query the product catalog.

**Input:**
```json
{
  "category": "string (optional)",
  "min_stock": "integer (optional)",
  "max_stock": "integer (optional)",
  "losing_buy_box": "boolean (optional)",
  "limit": "integer (default 50)"
}
```

**Output:** Array of `{fsn, name, category, current_price, current_stock, floor_price, floor_stock, buy_box_status}`.

---

#### `flipkart_check_competitors`
Buy box and price gap analysis. Reads from `price_snapshots` — freshness depends on last `pricing` domain sync.

**Input:**
```json
{
  "fsn": "string (optional — omit for full catalog scan)",
  "only_losing": "boolean (default false)"
}
```

**Output:** Array of `{fsn, your_price, buy_box_price, buy_box_winner_seller_id, price_gap, price_gap_pct, data_as_of}`.

---

#### `flipkart_check_brand_hijacks`
Scan listings for unauthorized third-party sellers. Reads from `price_snapshots` (populated by `pricing` domain sync). If `price_snapshots` is older than 2 hours, returns a `stale_data_warning` in the output.

**Input:** `{}` (no parameters — always scans full catalog)

**Output:**
```json
{
  "hijackers_found": [
    {"fsn": "...", "seller_id": "...", "seller_name": "...", "price": 0.0, "has_buy_box": true}
  ],
  "new_since_last_check": ["seller_id_1"],
  "stale_data_warning": null
}
```

`new_since_last_check`: seller IDs present in this scan's `price_snapshots` batch that do not yet exist in the `competitors` table. On each scan, `competitors.last_seen` is updated for all sellers seen.

**Follow-on action:** Use `flipkart_flag_hijacker` to mark a surfaced seller as a confirmed hijacker.

---

#### `flipkart_ads_report`

**Input:**
```json
{
  "fsn": "string (optional)",
  "from_date": "YYYY-MM-DD (optional)",
  "to_date": "YYYY-MM-DD (optional)"
}
```

**Output:** Array of `{fsn, campaign_id, impressions, clicks, spend, revenue, roas}` — `roas` is `null` when `spend = 0`.

---

#### `flipkart_returns_report`

**Input:** `{"from_date": "YYYY-MM-DD (optional)", "to_date": "YYYY-MM-DD (optional)"}`

**Output:** `{total_returns, total_cancellations, high_return_skus: [{fsn, return_rate, top_reason}]}`

---

#### `flipkart_reviews_report`

**Input:** `{"fsn": "string (optional)", "min_rating": "integer 1-5 (optional)"}`

**Output:** `{avg_rating, total_reviews, recent_negatives: [{fsn, rating, review_text, review_date}]}`

---

#### `flipkart_target_tracking`

**Input:** `{"month": "YYYY-MM (default: current month)"}`

**Output:** `{month, revenue: {target, actual, gap, projection}, units: {target, actual, gap, projection}, skus_behind_target: [...]}`

Category-level targets are apportioned to individual SKUs pro-rata by their share of last month's units. If last month has no data, category targets are shown at category level only.

---

### 6.2 Action Tools (require approval unless classified as safe)

#### `flipkart_flag_hijacker`
Flag a seller as a confirmed hijacker. Writes to `competitors` table (local DB only — no Flipkart action). Auto-executes (safe write).

**Input:**
```json
{"seller_id": "string", "seller_name": "string", "fsn": "string (optional — the listing where seen)", "notes": "string (optional)"}
```

**Upsert behaviour:** If `seller_id` already exists: update `last_seen` and `flagged_as_hijacker=TRUE`. If new: insert with `first_seen=NOW()`, `last_seen=NOW()`.

**Output:** `{"flagged": true, "seller_id": "...", "is_new": true|false}`

**actions_log entry:** `action_type=hijack_flag`, `before_value=null` (new) or prior row state, `after_value={"seller_id":"...", "seller_name":"...", "fsn":"..."}`.

---

#### `flipkart_update_price`
Change selling price. Always requires approval. Blocked if new price < `products.floor_price`.

**Input:**
```json
{
  "updates": [{"fsn": "string", "new_price": 0.0}],
  "reason": "string (optional, logged)"
}
```

**Batch behaviour:** Each FSN is validated independently. FSNs with `floor_price_breach` errors are excluded from the approval batch; the remaining valid FSNs are presented for a single approval decision (approve all or reject all). Partial approvals (approve some FSNs in a batch) are not supported in Phase 5 — the user must submit separate tool calls.

**Output (pre-approval):**
```json
{
  "proposed": [{"fsn": "...", "old_price": 0.0, "new_price": 0.0}],
  "rejected": [{"fsn": "...", "error": "floor_price_breach", "floor_price": 0.0}],
  "status": "pending_approval"
}
```

**Output (post-approval):**
```json
{"executed": [{"fsn": "...", "old_price": 0.0, "new_price": 0.0}], "status": "done"}
```

**Error cases:** `floor_price_breach`, `session_error`, `page_changed` (Playwright could not locate the price field).

---

#### `flipkart_update_inventory`
Update stock quantity. Auto-executes if change < 10% of current quantity; requires approval otherwise.

**Input:**
```json
{"fsn": "string", "new_quantity": 0, "warehouse": "string (optional)"}
```

**Output:** `{fsn, old_qty, new_qty, change_pct, status: "auto_executed|pending_approval"}`

---

## 7. Module Breakdown

### Phase 1: Foundation
- Python package scaffolding (`pyproject.toml`, venv, `src` layout)
- MCP server skeleton (`mcp` Python SDK)
- Playwright auth manager: login, cookie persistence, session validity check, re-login
- Alembic setup + initial migration (`001_initial_schema.py`) covering all tables
- `Repository` ABC + `SqliteRepository` implementation + `MockRepository` for tests
- Rate limiter + backoff middleware for all Playwright navigations
- `flipkart_sync` tool skeleton (calls each scraper domain, aggregates results)

### Phase 2: Data Ingestion (Read-Only Scrapers)
- `BaseScraper` with DOM extraction + injected vision fallback + retry logic
- Domain scrapers: `inventory`, `orders`, `pricing`, `ads`, `returns`, `reviews`
- Each scraper: DOM-first, vision fallback on failure, writes via `Repository`

### Phase 3: Reporting & Scheduling
- `flipkart_report`, `flipkart_target_tracking`, `flipkart_search_catalog`
- APScheduler: daily sync at 06:00, hourly price check during business hours (09:00–21:00)
- Scheduler jobs implemented as plain async functions — directly invokable in tests without wall-clock waiting

### Phase 4: Competitive Intelligence
- `flipkart_check_competitors` — buy box gap analysis
- `flipkart_check_brand_hijacks` + `flipkart_flag_hijacker` — hijacker detection and flagging

### Phase 5: Action Layer
- `flipkart_update_price` — with approval workflow, batch validation, floor price guard
- `flipkart_update_inventory` — with autonomy model from Section 3.2

### Phase 6: Specialised Reports
- `flipkart_ads_report`, `flipkart_returns_report`, `flipkart_reviews_report`

---

## 8. Project Structure

```
flipkart-manager/
├── pyproject.toml
├── .gitignore              # Includes: config/settings.local.toml, .cache/, data/
├── alembic.ini
├── alembic/
│   ├── env.py
│   └── versions/
│       └── 001_initial_schema.py
├── config/
│   ├── settings.toml           # Non-secret runtime config (committed)
│   └── settings.local.toml     # Credentials (gitignored — never committed)
├── src/
│   └── flipkart_manager/
│       ├── server.py           # MCP server entry point; runs alembic upgrade head on start
│       ├── auth/
│       │   └── session.py
│       ├── db/
│       │   └── repository.py   # Repository ABC + SqliteRepository + MockRepository
│       ├── scrapers/
│       │   ├── base.py         # BaseScraper + injected vision fallback + rate limiter
│       │   ├── inventory.py
│       │   ├── orders.py
│       │   ├── pricing.py
│       │   ├── ads.py
│       │   ├── returns.py
│       │   └── reviews.py
│       ├── actions/
│       │   ├── price_updater.py
│       │   └── inventory_updater.py
│       ├── reports/
│       │   ├── snapshot.py         # flipkart_report
│       │   ├── targets.py          # flipkart_target_tracking
│       │   └── buy_box.py          # flipkart_check_competitors
│       ├── tools/
│       │   ├── sync.py
│       │   ├── report.py
│       │   ├── catalog.py
│       │   ├── competitors.py      # check_competitors + check_brand_hijacks + flag_hijacker
│       │   ├── ads.py
│       │   ├── returns.py
│       │   ├── reviews.py
│       │   ├── targets.py
│       │   ├── update_price.py
│       │   └── update_inventory.py
│       └── scheduler/
│           └── jobs.py             # Async functions, runnable directly in tests
└── tests/
    ├── conftest.py                 # Provides MockRepository and deterministic vision_fn mock
    ├── test_scrapers/
    ├── test_tools/
    └── fixtures/                   # Saved HTML pages for scraper unit tests
```

**Credential security:** `config/settings.local.toml` holds Flipkart credentials. It is gitignored. All credential fields support override via environment variables (`FLIPKART_USERNAME`, `FLIPKART_PASSWORD`, `FLIPKART_DB_PATH`) for CI/CD.

**`settings.toml` is read-only runtime config.** No tool writes to it. All per-SKU operational data (floor prices, floor stock, targets) lives exclusively in the database.

---

## 9. Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| Language | Python 3.12 | Best ecosystem for Playwright + MCP SDK |
| MCP framework | `mcp` (Anthropic SDK) | Official SDK, native Claude Code integration |
| Browser automation | `playwright` (Python) | Async, reliable, good debugging tools |
| Database | SQLite → Postgres | SQLite for Phase 1; `Repository` ABC enables swap to fk-tool shared DB |
| Schema migrations | `alembic` | Versioned migrations from day one; works with both SQLite and Postgres |
| Scheduling | `apscheduler` | Lightweight, in-process; jobs are plain async functions for testability |
| Config | `tomllib` (stdlib) | Read-only; credentials in gitignored `settings.local.toml` or env vars |
| Testing | `pytest` + saved HTML fixtures + `MockRepository` | Fully offline; no live Flipkart or Claude API calls in tests |

---

## 10. Configuration

**`config/settings.toml`** (committed to repo):
```toml
[flipkart]
seller_hub_url = "https://seller.flipkart.com"
session_cookie_path = "./.cache/flipkart_session.json"

[schedule]
daily_sync_time = "06:00"
price_check_interval_minutes = 60
price_check_hours = "09:00-21:00"

[scraper]
inter_request_delay_seconds = 2
backoff_max_seconds = 60
max_retries = 3
hijack_staleness_warning_hours = 2

[inventory]
default_low_stock_threshold = 10    # units; overridable per-SKU via products.floor_stock

[autonomy]
auto_execute_safe_actions = true
stock_change_auto_threshold = 0.10

[db]
path = "./data/flipkart.db"         # override via FLIPKART_DB_PATH env var
```

**`config/settings.local.toml`** (gitignored — never committed):
```toml
[flipkart]
username = "your@email.com"
password = "yourpassword"
```

---

## 11. Verification Plan

1. **Auth:** Call `session.login()` directly — assert cookies are written to `session_cookie_path`. Call `session.is_valid()` — assert `True` without re-login. Delete the cookie file and call `session.is_valid()` — assert `False` and that `session.login()` is called again.

2. **Rate limiter:** Unit test the rate limiter — assert that two consecutive navigations have at least `inter_request_delay_seconds` elapsed between them, measured with wall-clock time in the test.

3. **Scrapers (DOM path):** For each domain scraper, run against saved HTML fixtures in `tests/fixtures/` — assert all required fields are extracted with the correct values.

4. **Scrapers (vision fallback path):** Inject a deterministic `vision_fn` mock (from `conftest.py`) that returns a fixed valid response. Run the scraper against a malformed HTML fixture. Assert the mock `vision_fn` is called exactly once and its response is used. Then configure the mock to raise `ExtractionError` — assert the scraper propagates the error correctly. No live Claude API calls are made in tests.

5. **MCP tools:** Call each tool directly via the MCP protocol against a `MockRepository` populated with known test data. Assert each response conforms to the output schema in Section 6.

6. **Action approval flow:** Call `flipkart_update_price` with one FSN above `floor_price` and one below — assert the below-floor FSN is in `rejected` and the above-floor FSN is in `proposed` with `status: pending_approval`. Approve the batch — assert `actions_log.status = approved` and the Playwright price-update flow is triggered for the valid FSN only.

7. **Scheduler jobs:** Call each job function directly (they are plain async functions) against a `MockRepository`. Assert the expected rows are written. No wall-clock waiting.

8. **Schema migrations:** Run `alembic upgrade head` against a fresh SQLite file — assert all tables and indexes are created. Run it again — assert it is idempotent (no errors on an already-current schema).

9. **Repository abstraction:** Run the full tool test suite against both `SqliteRepository` (in-memory `:memory:` DB) and `MockRepository`. Both must pass identically — this confirms the abstraction layer is clean and the fk-tool `PostgresRepository` will be a drop-in swap.

---

## 12. Open Questions for fk-tool Integration Session

1. What database system is fk-tool using? (Postgres, MySQL, other?) This determines the `PostgresRepository` implementation and Alembic dialect.
2. Does fk-tool have a shared job queue / scheduler? If yes, Phase 3 APScheduler should be replaced with fk-tool's job queue and the scheduler job functions registered there.
3. Will other marketplace integrations (Amazon, Meesho) follow the same MCP tool pattern? If yes, define a shared `BaseMarketplaceScraper` interface upfront so tool naming and data model patterns are consistent across platforms.
4. Is there a shared credential store in fk-tool, or does each integration manage its own session? This determines whether `settings.local.toml` is replaced by fk-tool's secrets management system.
5. What is fk-tool's existing project structure so `flipkart-manager/` can be placed correctly within the monorepo and Alembic migrations can be merged into a shared migration history.
