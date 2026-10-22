# Setup

## Requirements

- Node 24 (see `.nvmrc`; `package.json` pins `engines.node` to `24.x`, which Vercel uses)
- Docker, for the test database
- A Postgres database for the app (Supabase, using the transaction-mode pooler string)

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Name | What it is |
|---|---|
| `DATABASE_URL` | Supabase connection string, **transaction pooler**, port 6543 |
| `CRON_SECRET` | Random string of 32+ characters (used by the keep-alive route) |
| `TEST_DATABASE_URL` | A local Docker Postgres, used only by the tests. Never the Supabase URL |

`.env.local` is ignored by git. Never commit it.

## Test database

The database tests rebuild the `public` schema, so they only run against a local throwaway
database. They stop with an error unless `TEST_DATABASE_URL` is set, points at `localhost` or
`127.0.0.1`, and is a different database from `DATABASE_URL`.

```sh
docker run -d --name allocator-test-pg \
  -e POSTGRES_PASSWORD=<choose-a-local-password> \
  -p 127.0.0.1:5433:5432 postgres:17
```

Then set `TEST_DATABASE_URL=postgres://postgres:<that-password>@127.0.0.1:5433/postgres`.
Use the same Postgres major version as your Supabase project. After a reboot, start it again
with `docker start allocator-test-pg`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app on http://localhost:3000 |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint and Prettier check |
| `npm test` | All tests (needs the test database) |
| `npx vitest run --project unit` | Only the tests that need no database |
| `npm run db:migrate` | Apply `db/migrations/*.sql` to `DATABASE_URL` |
| `npm run db:seed` | Load products, warehouses, baseline stock and delivery history |
| `npm run smoke -- <url>` | End-to-end check of a running deployment (see Deploy) |
| `npm run check:data-api` | Check that Supabase's public Data API cannot read the tables (see Deploy) |

Migrate and seed are safe to run again. Seeding never overwrites stock that already exists.

## First run

```sh
npm install
npm run db:migrate
npm run db:seed
npm run dev
curl -i http://localhost:3000/api/health
```

## The page

After the first run, open `http://localhost:3000` (use the port the dev server prints). The page is
one screen with four parts: the order form, the result, the stock table, and the order history
(the last 20 orders, newest first; Reset empties it).

To see the main flow:

1. Choose "Vaccine - Hepatitis B (10-dose vial)", enter `45`, and press **Place order**.
2. The result shows W04 sending 40 vials and W07 sending 5, with the time, the cost in rupiah (a
   step-by-step line per shipment), the reasons, a side-by-side table of the chosen plan and the two runner-ups, and a short "How the best plan is chosen" note. In the stock table W04 shows `0 (−40)` and W07 shows `3 (−5)`.
3. Press **Reset demo data** to restore the starting stock, clear the order history and empty the
   order form.

Other things to try: **Preview** plans the same order without reserving anything; 120 Hep B vials
gives a "cannot be fulfilled" result, because only 108 of the 158 vials are in warehouses that can
ship them cold (the dimmed cells in the stock table); an empty quantity shows an error next to the
field without sending anything. The quantity field only accepts digits, and every item row,
including the last one, can be removed.

Costs are shown as rupiah, but the money is illustrative: the API and the planner work in
placeholder cost units (rates 50, 5 per km and 1.4 for a refrigerated van, in `src/config.ts`), and
the page shows 1 cost unit as Rp 1.000 (`DISPLAY.rupiahPerCostUnit`). Both the rates and that
factor are assumptions, not real prices.

"Ordered at" is read as WIB (UTC+7) and starts as the current WIB time. Empty it to use the
server's time. Pressing Enter in the form runs Preview, never Place order. The page uses the same
API as the examples below. It has no automated browser tests (it was checked in Chrome with a throwaway script);
its helper functions are unit tested in `tests/ui`.

## Using the API

Start the app (`npm run dev`) and set these in your shell. Use the port the dev server prints, and
the same `CRON_SECRET` the server was started with (never paste the real secret into a document).

```sh
BASE=http://localhost:3000
CRON_SECRET=<the value in your .env.local>
```

Every response, including every error, has the same four keys:

```json
{ "guid": "uuid, also in the X-Request-Id header", "code": 200, "info": "short message", "data": {} }
```

`code` always equals the HTTP status. The examples print the status after the body (`-w`), so you
can see both. Times are in WIB (UTC+7); `orderedAt` is optional and defaults to now.

### Health

```sh
curl -s "$BASE/api/health" -w "\nHTTP %{http_code}\n"
```

Expected status: 200. Data: `{ "status": "ok" }`. It answers 503 when the database cannot be reached.

### Products

```sh
curl -s "$BASE/api/v1/products" -w "\nHTTP %{http_code}\n"
```

Expected status: 200. Data: `{ "products": [{ "id": "P001", "name": "...", "category": "...", "requiresColdChain": false }, ...] }`.

### Warehouses with current stock

```sh
curl -s "$BASE/api/v1/warehouses" -w "\nHTTP %{http_code}\n"
```

Expected status: 200. Data: `{ "warehouses": [{ "id": "W01", "city": "Surabaya", "distanceKm": 5, ..., "stock": { "P001": 200, "P002": 0, ... } }, ...] }`. Every product is listed, with 0 where there is no stock.

### Preview an order (changes nothing)

```sh
curl -s -X POST "$BASE/api/v1/orders/preview" \
  -d '{"items":[{"productId":"P002","quantity":45}],"orderedAt":"2026-10-20T13:00:00+07:00"}' \
  -w "\nHTTP %{http_code}\n"
```

Expected status: 200. Data: the plan (`orderedAt`, `shipments`, `totalMinutes`, `totalCost`, `reasons`, `alternatives`), without an `orderId`. Here 40 vials ship from W04 and 5 from W07.

### Place an order (reserves the stock)

```sh
curl -s -i -X POST "$BASE/api/v1/orders" \
  -d '{"items":[{"productId":"P002","quantity":45}],"orderedAt":"2026-10-20T13:00:00+07:00"}' \
  -w "\nHTTP %{http_code}\n"
```

Expected status: 201. The `Location` header is `/api/v1/orders/<orderId>` and `data` is the plan plus `orderId`.

### Read one order

```sh
ORDER_ID=$(curl -s "$BASE/api/v1/orders" | grep -o '"orderId":"[^"]*"' | head -1 | cut -d'"' -f4)
curl -s "$BASE/api/v1/orders/$ORDER_ID" -w "\nHTTP %{http_code}\n"
```

Expected status: 200. Data: exactly what placing the order returned. An unknown or malformed id is 404.

### List the last 20 orders

```sh
curl -s "$BASE/api/v1/orders" -w "\nHTTP %{http_code}\n"
```

Expected status: 200. Data: `{ "orders": [{ "orderId", "createdAt", "orderedAt", "items", "warehouseIds", "totalMinutes", "totalCost" }, ...] }`, newest first.

### An order that cannot be fulfilled (422)

```sh
curl -s -X POST "$BASE/api/v1/orders" \
  -d '{"items":[{"productId":"P002","quantity":500}]}' \
  -w "\nHTTP %{http_code}\n"
```

Expected status: 422. `data` is `{ "reason": "INSUFFICIENT_STOCK" | "COLD_CHAIN_UNAVAILABLE" | "UNKNOWN_PRODUCT", "shortfalls": [...] }` and `info` says why in one sentence.

### A request that is not valid (400)

```sh
curl -s -X POST "$BASE/api/v1/orders" \
  -d '{"items":[{"productId":"P001","quantity":1.5}],"orderAt":"2026-10-20T13:00:00+07:00"}' \
  -w "\nHTTP %{http_code}\n"
```

Expected status: 400. `data` is `{ "reason": "VALIDATION_ERROR", "errors": [{ "field": "items[0].quantity", "message": "quantity must be a whole number" }, { "field": "orderAt", "message": "orderAt is not a known field" }] }`. Every problem is listed. Unknown fields are rejected so a typo cannot silently change the order (at most five are named). A `productId` is a code of up to 32 letters, digits, `-` or `_`; an unknown code is a 422, but a code with other characters is a 400.

### Reset the demo

```sh
curl -s -X POST "$BASE/api/v1/reset" -w "\nHTTP %{http_code}\n"
```

Expected status: 200. All orders are deleted and stock goes back to the starting amounts. This endpoint is public on purpose (the demo has no login).

### Keep-alive (called once a day by the Vercel cron)

```sh
curl -s "$BASE/api/cron/keep-alive" -H "Authorization: Bearer $CRON_SECRET" -w "\nHTTP %{http_code}\n"
```

Expected status: 200. Without the header, or with a wrong secret, it answers 401.

### Wrong method (405)

```sh
curl -s -i "$BASE/api/v1/orders/preview" -w "\nHTTP %{http_code}\n"
```

Expected status: 405. The `Allow` header lists the methods that work (here `POST`). `OPTIONS` on any route answers 200 with the same `Allow` header.

### Unknown route (404)

```sh
curl -s "$BASE/api/v1/nope" -w "\nHTTP %{http_code}\n"
```

Expected status: 404, with the same four keys as everything else.

## Deploy

The app runs on Vercel (region `sin1`, set in `vercel.json`) with the database on Supabase. `vercel.json` also
holds the daily cron: Vercel calls `/api/cron/keep-alive` once a day at 03:00 UTC with
`Authorization: Bearer $CRON_SECRET`, which keeps the free-tier database from sitting idle.

1. In the Vercel project, set two **production** variables (names only here, never commit the values):
   `DATABASE_URL` (the Supabase transaction pooler string) and `CRON_SECRET` (32+ random characters).
2. Commit your work, then deploy from a clean clone of the commit so nothing git-ignored (`.env.local`,
   `CLAUDE.md`, `notes/`) can be uploaded:

   ```sh
   git clone . /tmp/allocator-deploy && cp -R .vercel /tmp/allocator-deploy/.vercel
   cd /tmp/allocator-deploy && vercel deploy --prod
   ```

3. Smoke test the live URL. It checks health, the page, the keep-alive route, a preview, a place, the read-back, a
   rejected order, a reset, and two simultaneous orders for the last vials (exactly one must win), then resets again:

   ```sh
   npm run smoke -- https://<your-app>.vercel.app
   ```

   It only starts when the database has no orders and baseline stock, so it never erases anyone's orders. A short
   window remains between that check and its final reset (someone else could place an order in it); that is acceptable
   for a demo. If you stop it half way (Ctrl-C), a test order may be left behind: run
   `curl -X POST https://<your-app>.vercel.app/api/v1/reset` to restore the demo data.

   The "keep-alive with the secret is 200" check runs only when `CRON_SECRET` is set in your shell **and equals the
   production value**; otherwise it is skipped, or fails with status 401. The script does not read `.env.local`
   (unlike the `db:` scripts). The secret is never printed, and it is only sent over https or to localhost.
4. Run the cron once by hand with `vercel crons run /api/cron/keep-alive`, then look at the runtime log for the request
   and its status (it should be 200 if Vercel sends the secret on a manual run; the daily scheduled run does).
5. Check that the Supabase public Data API cannot read the tables. `SUPABASE_PROJECT_REF` is the `<ref>` in your
   `https://<ref>.supabase.co` address. Read the anon key (Supabase dashboard, API settings) into a shell variable
   without echoing it, so it is never written to a file or committed:

   ```sh
   read -s SUPABASE_ANON_KEY && export SUPABASE_ANON_KEY
   SUPABASE_PROJECT_REF=<project-ref> npm run check:data-api
   ```

   Every table must show a check mark with a database error code (`42501` permission denied, or a `PGRST...` code for a
   table the API does not expose), or an empty list. A refusal without such a code, for example "Invalid API key" from a
   mistyped key, is reported as a failure because it proves nothing about the tables.
