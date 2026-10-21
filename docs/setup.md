# Setup

## Requirements

- Node 24 (see `.nvmrc`; Vercel's default is also 24)
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

Migrate and seed are safe to run again. Seeding never overwrites stock that already exists.

## First run

```sh
npm install
npm run db:migrate
npm run db:seed
npm run dev
curl -i http://localhost:3000/api/health
```
