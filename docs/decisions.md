# Decisions

Each section gives the decision, the alternatives that were considered, the trade-off, and where to check it.
Section 14 lists the known limitations and section 15 the assumptions that have no real-world source.

## 1. Cold chain is decided by two flags

- **Decision:** a cold-chain product can ship only from a warehouse that has both cold storage and a refrigerated vehicle (W04, W07, W08). Stock of cold-chain products held elsewhere (W02, W06) exists but is not shippable: 108 of 158 Hepatitis B vials and 85 of 135 Tetanus vials can ship.
- **Alternatives:** hard-coding warehouse ids (breaks when data changes); inferring cold chain from the product category (paracetamol is a pharmaceutical but room temperature, so `requires_cold_chain` is an explicit column); accepting a warehouse with only one of the two flags.
- **Trade-off:** a vaccine is never planned onto a vehicle that cannot keep it cold, at the price of leaving some stock unusable. The success explanation never mentions that blocked stock; only the failure message does ("Only 108 of 158 units ... can be shipped with cold chain").
- **Evidence:** `src/domain/plan.ts` (`isColdCapable`, `canShip`); `tests/domain/shortfalls.test.ts`, `tests/domain/properties.test.ts`.

## 2. An order is shipped completely or rejected; every combination of warehouses is scored

- **Decision:** no partial fulfilment. The planner scores every non-empty group of warehouses that covers the whole order, fills each group from its fastest warehouse first, and keeps only groups in which every warehouse ships something. The best plan is chosen, and the next two are returned as alternatives.
- **Alternatives:** nearest warehouse first (cheap, but misses better splits); a greedy split (not optimal); partial shipments (the stock would be promised without a complete order).
- **Trade-off:** the result is the best under the scoring rule, but the search is exponential. It is capped at 12 warehouses (4,095 groups); the demo has 8 (255 groups).
- **Evidence:** `src/domain/plan.ts` (`rankCandidates`, `planOrder`); `PLAN.maxWarehouses` in `src/config.ts`; the golden cases in `tests/fixtures/golden-cases.json`, produced by `reference/reference.py` and never edited.

## 3. Speed and cost count equally, with placeholder cost rates

- **Decision:** plans are ranked by an equal-weight balance of delivery time and cost. Internally the planner computes one ranking value per plan (called `score` in the code): `0.5 x (slowest minutes / 200) + 0.5 x (total cost / 500)`; the lowest value wins; ties go to fewer shipments, then to the warehouse id list. This value is internal: the API contract returns no score and the page does not show one. The page shows the minutes and the cost of the chosen plan and of the two runner-ups instead. A shipment costs `(50 + 5 x km)`, multiplied by 1.4 when it carries a cold-chain product. Cost is per shipment, not per unit.
- **Alternatives:** fastest only; cheapest only; other weights. Equal weight is the neutral choice because no priority was given.
- **Trade-off:** the weights, the two reference sizes (200 minutes is treated as worth 500 cost units) and the cost rates are assumptions chosen during planning, not operator data (section 15). The weights and the two reference sizes matter only when the faster plan is not also the cheaper one; the cost rates set what "cheaper" means in the first place (the fixed fee per shipment is what makes a split expensive). All of them live in `src/config.ts` and can be replaced.
- **Display:** the page shows costs in rupiah by treating 1 cost unit as Rp 1.000 (`DISPLAY.rupiahPerCostUnit`). The API, the planner and the tests stay in cost units; only the page multiplies. The factor is itself an assumption.
- **Evidence:** `src/config.ts` (`PLAN`, `DISPLAY`); `tests/domain/ranking.test.ts`, `tests/ui/format.test.ts` (the page's cost breakdown is checked against the planner's own cost function).

## 4. Delivery time comes from the delivery history, by time of day

- **Decision:** each of the 38 records is placed in a bucket in Jakarta time: `weekend` (Saturday or Sunday, any time), `peak` (Monday to Friday, 07:00 to 09:30 and 16:00 to 19:00, start inclusive, end exclusive) or `off_peak`. The estimate for a warehouse and bucket is `(n x bucket median + 2 x warehouse median) / (n + 2)`, where `n` is the number of records in that bucket; with no records it is the warehouse median. The constant 2 stops one or two records from dominating.
- **Alternatives:** a fixed speed per km (ignores the history); the warehouse median only (ignores time of day); the raw bucket median (unstable with one or two records).
- **Trade-off:** the history is small. 12 of the 24 warehouse-and-bucket cells have fewer than two records: W07 has no peak or weekend records, and W08 has one peak record and none at weekends. The response says so ("Delivery time for W07 rests on limited history") instead of hiding it. In this build the estimate is load-bearing: the speed part of the ranking and the "fastest warehouse first" order both use it.
- **Evidence:** `src/domain/eta.ts`, `src/domain/time.ts`, `ETA` in `src/config.ts`; `tests/fixtures/eta-table.json` (expected values), `tests/domain/eta.test.ts`, `tests/domain/time.test.ts` (the boundaries 06:59, 07:00, 09:29, 09:30, 15:59, 16:00, 18:59, 19:00, weekends and a UTC time that crosses into Monday peak).

## 5. Time zone handling and the order time

- **Decision:** Jakarta time (WIB) is UTC+7 all year with no daylight saving. `orderedAt` is optional, must carry an offset (`+07:00` or `Z`), defaults to now, and may be in the past or future because it only affects the estimate. It is converted to WIB before bucketing. The parser is strict: it rejects forms such as `+07`, and times whose Jakarta year falls outside 0001 to 9999.
- **Alternatives:** accepting a local time without an offset (ambiguous); using the server's time zone (differs between machines).
- **Trade-off:** clients must send an offset; the page sends `+07:00` for its "Ordered at (WIB)" field.
- **Evidence:** `src/domain/time.ts`, `src/http/schemas.ts`, `tests/support/ordered-at-cases.ts`.

## 6. Rounding

- **Decision:** minutes are rounded only in the output, with `Math.round` (half up); the reference script rounds half to even, so they differ only on an exact .5. Score ties compare after `toFixed(9)`. Costs are reported rounded to 4 decimals, which removes float noise such as `244.99999999999997`.
- **Trade-off:** none seen in practice; the difference is documented rather than hidden.
- **Evidence:** `src/domain/plan.ts`, `PLAN.costDecimals` and `PLAN.scoreTieDecimals` in `src/config.ts`.

## 7. Reserving stock safely

- **Decision:** placing an order is one database transaction: set a 5 second lock timeout, lock the stock rows of the ordered products with `SELECT ... ORDER BY warehouse_id, product_id FOR UPDATE`, plan on those locked rows, subtract the quantities, insert the order, commit. A shortfall rolls back and returns 422. `CHECK (quantity >= 0)` is a safety net.
- **Why it cannot deadlock:** every transaction that locks stock rows, an order or the reset (which locks all of them), takes them in the same global order, so two transactions can only wait for each other in one direction and no cycle can form; the lock timeout is the backstop and becomes a 503.
- **Alternatives:** optimistic updates with retry (can livelock under contention); serializable isolation (retries on every conflict); an advisory lock (serialises unrelated orders); an application mutex (does not work across serverless instances).
- **Trade-off:** orders for the same products queue behind each other; orders for different products do not. Products, warehouses and the delivery estimates are cached for 5 minutes per instance and read before the transaction, so a changed warehouse flag can be up to 5 minutes old; stock is never cached.
- **Evidence:** `src/db/orders.ts`, `src/db/reset.ts`; `tests/db/concurrency.test.ts` (two simultaneous orders for the last vials give one 201 and one 422; forced overlap, not sleeps), `tests/db/orders.test.ts`. The same check runs against a deployment with `npm run smoke`.
- **Not observable by a test:** committing instead of rolling back on a rejected order (no state differs), and the row-count guard after the stock update (it needs a locked row to vanish).

## 8. Reset restores the baseline in place

- **Decision:** reset locks all stock rows first, deletes the orders, then updates the baseline rows in place (an upsert) and deletes only rows outside the baseline.
- **Alternative:** delete and re-insert. An order waiting on those row locks would then find no row and wrongly report that there is no stock.
- **Evidence:** `src/db/reset.ts`; `tests/db/reset.test.ts` (`reset_updates_rows_in_place_so_a_waiting_order_sees_the_restored_stock`).

## 9. Database

- **Postgres on Supabase, plain SQL through postgres.js**, not SQLite: the Vercel filesystem is not writable. The client uses `prepare: false` because the Supabase pooler runs in transaction mode, and a pool of 3. `SET LOCAL` is used for the lock timeout because on a transaction pooler a plain `SET` would stick to a shared server connection and could leak to other clients, while the next transaction may run on a different connection.
- **Row level security is enabled on every table with no policies, and privileges are revoked from `anon` and `authenticated`** (tables in migration 001; default privileges on sequences and functions in migration 002), so the public Data API has no privilege to read them (confirmed with a catalog query; the check through the API itself is pending, see the last section). There is a sixth table, `schema_migrations`, for the migration runner, with the same protection.
- **Limits:** a new function in the `public` schema still gets PostgreSQL's built-in `PUBLIC` execute privilege and would need an explicit revoke; default privileges owned by Supabase's own admin role cannot be changed from here.
- **Seed:** safe to run many times, never overwrites stock that already exists, loads exactly the 38 delivery records.
- **Evidence:** `db/migrations/001_schema.sql`, `002_default_privileges.sql`, `src/db/client.ts`, `src/db/seed.ts`; `tests/db/schema.test.ts`, `tests/db/seed.test.ts`.

## 10. HTTP API

- **One envelope everywhere** (`guid`, `code`, `info`, `data`); `code` equals the HTTP status; the request id is also sent as `X-Request-Id`. A 500 gives a generic message; the real error is logged with the same `guid`.
- **Two deliberate non-resource endpoints:** `POST /api/v1/orders/preview` and `POST /api/v1/reset` are actions, not resources. They are kept because they are clearer than forcing them into resource form. `/api/health` and `/api/cron/keep-alive` are operational routes outside `/api/v1`.
- **Strict requests:** unknown fields are rejected (a typo such as `orderAt` must not silently mean "now"); a product id is 1 to 32 letters, digits, `-` or `_` (a NUL byte is refused with a 400 because Postgres rejects it); an unknown product is a 422, not a 400; malformed JSON is a 400 whatever the content type.
- **Errors:** a rejected order is one `RejectedOrderError` (422 with `reason` and `shortfalls`). A connection failure or a lock timeout is a 503; anything unexpected is a 500. Health and keep-alive are probes, so any failure to reach the database is a 503. `405` carries `Allow`, and `OPTIONS` is answered with an enveloped 200 and the same `Allow`.
- **Cron secret:** `Authorization: Bearer $CRON_SECRET`, compared through SHA-256 digests and `timingSafeEqual`; an unset or empty secret rejects everyone (fail closed).
- **No CORS:** the page and the API are the same origin.
- **Stored orders read back exactly as they were returned:** the database stores JSON with reordered keys, so the documented key order is rebuilt on read; `created_at` is stamped when the row is inserted, after any lock wait.
- **Optional catch-all `[[...path]]`** gives an enveloped 404 for every unknown path under `/api`, including bare `/api`.
- **Evidence:** `src/http/*`, `src/app/api/**/route.ts`; `tests/api/*`, `tests/db/api.test.ts`.

## 11. The page

- One client page with helpers in `src/app/ui/` (a deliberate addition to the repository layout). Costs are shown in rupiah with a step-by-step line per shipment; the chosen plan and the two runner-ups are shown side by side; the last 20 orders are listed; Reset also empties the form; the quantity field accepts digits only; every item row can be removed.
- Enter in the form previews and never places an order. After a server error on place or reset the page says the outcome may be unknown and reads the stock again, because a 5xx can arrive after a lost commit acknowledgement.
- **No DOM test stack:** the pure helpers are unit tested and a few components are rendered to static markup; layout and flows were checked in a real browser. The cost is that there is no automated browser test.
- **Coupling:** the planner writes its explanation sentences with raw cost units, and the page rewrites those figures into rupiah with patterns tied to the sentences' wording. A test runs the real planner over the golden cases and fails if a sentence still carries a bare cost figure, but the coupling remains (section 14).
- **Evidence:** `src/app/page.tsx`, `src/app/ui/*`; `tests/ui/*`.

## 12. Tests

- Domain tests read the golden cases and the ETA fixture; property tests check that stock is never over-allocated, cold-chain items ship only from cold-capable warehouses and the plan covers the order exactly.
- Database tests run on a local Docker Postgres that mimics Supabase's grants. A guard refuses to run unless `TEST_DATABASE_URL` is set, points at `localhost` or `127.0.0.1`, differs from `DATABASE_URL`, and looks like a throwaway server; the real `DATABASE_URL` is kept out of the test process. Each run rebuilds the `public` schema and every test file restores the baseline stock. Concurrency tests use clients with a pool of 5 or more, and force overlap by holding row locks instead of sleeping.
- Rules were deliberately broken during development to check that the tests fail when they should.

## 13. Deployment

- Vercel, region `sin1`, with a daily cron at 03:00 UTC that calls the keep-alive route (which runs `SELECT 1`) so the free-tier database is not left idle.
- `vercel.json` sets `"framework": "nextjs"`: the Vercel project had been created with the preset "Other", which made the first deploy fail with "No Output Directory named public".
- Deploys are made from a clean clone of the committed code, so nothing that git ignores can be uploaded and the deployed code equals the committed code.
- `npm run smoke -- <url>` checks a deployment end to end: health, the page, the keep-alive route, a preview, a place, the read-back, a rejected order, a reset, and two simultaneous orders for the last vials. It starts only on a database with no orders and baseline stock, always resets after it has placed an order, and sends the cron secret only over https or to localhost.
- `npm run check:data-api` asks Supabase's public API for each table with the public key. A table passes only if the database refuses it (error code `42501`, or a `PGRST...` code) or it returns nothing; a refusal without such a code, such as "Invalid API key", fails because it proves nothing about the tables.

## 14. Known limitations

- The reset and order endpoints are public: there is no login and no rate limit, and the application sets no request body size limit (it relies on the platform's). Because the body is parsed as JSON whatever its content type, a cross-site page can send a simple `text/plain` POST to them; CORS does not prevent that. The demo holds no real data, and the next step is a secret header, a content-type check or the platform firewall.
- No idempotency keys: only the page prevents a double click; two identical API requests create two orders.
- The database connection is encrypted (`ssl: 'require'`) but the server certificate is not verified.
- No `statement_timeout`; only a lock timeout is set.
- Reference data can be up to 5 minutes old.
- The planner is capped at 12 warehouses.
- The delivery history is small (section 4) and there is no traffic or routing data; there is one fixed customer location.
- The page's rewriting of the planner's sentences into rupiah depends on their wording; returning the figures from the API as numbers would remove that coupling.
- The page duplicates a few planner rules (the cost formula, the cold-chain flags test) and hard-codes the "last 20" and "UTC+7" texts; tests keep the cost formula in step with the planner.
- The migration runner has no checksums and no lock between concurrent runs; the seed never deletes delivery records that were removed from the file.
- `npm audit` reports 5 high advisories, all in development-only tooling (`eslint-config-next` and its dependencies); no runtime dependency is affected.
- Successful GET responses send `Cache-Control: no-store`; error and 405 responses do not.

## 15. Assumptions without a real-world source

The cost rates (50 + 5 per km, times 1.4 for a refrigerated vehicle), the equal weights, the two reference sizes (200 minutes and 500 cost units), the rupiah display factor (1 cost unit shown as Rp 1.000), the shrinkage constant 2 and the peak windows come from the planning phase, not from operator data. No real prices, traffic or routing data were available. A real operator would replace them; they all live in `src/config.ts`.

## Verified on 2026-10-22 and 23, and still open

- **Verified:** the public Data API check (`npm run check:data-api`) was run against the live project by the owner: all six tables answered 401 with the database error code `42501`, so no table is readable with the public key. The catalog query on the live database agrees (row level security on every table, no privileges for the public roles).
- **Verified:** the first scheduled cron run happened on 2026-10-23 at 03:00:03 UTC and the keep-alive route answered 200 (request log, caller `vercel-cron/1.0`). Vercel's dashboard states that cron jobs on the free plan run within a flexible one-hour window from the scheduled time; this one ran at the start of it.

**Not verified yet:**

- Whether the daily keep-alive is enough to stop Supabase pausing the project. Supabase's documentation (checked 2026-10-22) says a free project is paused after one week of low activity, and that a few requests to the database each day are typically enough; the keep-alive makes one such request a day, but that this exact request counts has not been observed over a full week.
