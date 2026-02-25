# budgeto_api

Backend API for [Budgeto](https://budgeto.app) — a budget tracking PWA.

Built with **Hono**, **Drizzle ORM**, **PostgreSQL**, and **TypeScript**.

## Tech Stack

| Layer         | Technology                                         |
| ------------- | -------------------------------------------------- |
| Framework     | [Hono](https://hono.dev) on Node.js 20             |
| ORM           | [Drizzle ORM](https://orm.drizzle.team)            |
| Database      | PostgreSQL 16                                      |
| Auth          | JWT access tokens + httpOnly refresh token cookies |
| Validation    | Zod                                                |
| Build         | tsup (ESM)                                         |
| CI/CD         | GitHub Actions → GHCR → Mammoth Cloud VPS          |
| Reverse Proxy | Caddy (auto-TLS)                                   |

## API Endpoints

| Method | Path                  | Auth   | Description                                  |
| ------ | --------------------- | ------ | -------------------------------------------- |
| `GET`  | `/api/health`         | No     | Health check                                 |
| `POST` | `/api/auth/register`  | No     | Create account                               |
| `POST` | `/api/auth/login`     | No     | Sign in (returns JWT + sets refresh cookie)  |
| `POST` | `/api/auth/refresh`   | Cookie | Silent token refresh                         |
| `POST` | `/api/auth/logout`    | Cookie | Revoke refresh token                         |
| `POST` | `/api/budget/sync`    | Bearer | Process a sync operation (add/update/delete) |
| `GET`  | `/api/budget/entries` | Bearer | Fetch all entries for the authenticated user |

## Local Development

### Prerequisites

- Node.js ≥ 20
- PostgreSQL 16 (local or Docker)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your .env from the template
cp .env.example .env
# Edit .env — set DB_HOST, DB_USER, DB_PASSWORD, etc. for your local Postgres

# 3. Create the database
createdb budgeto   # or via psql / pgAdmin

# 4. Run migrations
npm run db:migrate

# 5. Start the dev server (auto-reload)
npm run dev
```

The API will be running at `http://localhost:4000`.

### Useful Commands

```bash
npm run dev          # Start dev server with hot reload
npm run build        # Build for production (tsup → dist/)
npm run start        # Run production build
npm run typecheck    # Type-check without emitting
npm run test         # Run tests
npm run db:generate  # Generate migration SQL from schema changes
npm run db:migrate   # Apply pending migrations
npm run db:studio    # Open Drizzle Studio (DB browser)
```

## Database Schema

Three tables — see `src/db/schema.ts` for the full Drizzle definitions:

- **users** — `id` (uuid), `email` (unique), `password_hash`, `created_at`
- **budget_entries** — `id` (text, client-generated), `user_id` (FK), `amount`, `description`, `type` (income/expense/savings_deposit/savings_withdrawal), `created_at`, `updated_at`, `deleted_at` (soft-delete)
- **refresh_tokens** — `id` (uuid), `user_id` (FK), `token_hash` (SHA-256), `expires_at`, `created_at`

## Deployment

See `deploy/` for the Docker Compose, Caddyfile, and VPS `.env` template. Refer to the deployment guide below for step-by-step instructions.

### Deploy to VPS (one-time setup)

1. SSH into your Mammoth Cloud VPS
2. Install Docker & Docker Compose
3. Create `~/budgeto/` and copy in `docker-compose.yml`, `Caddyfile`, and `.env`
4. Point your `budgeto.app` DNS A record to the VPS IP
5. Run `docker compose up -d` — Caddy will auto-provision the TLS certificate

### CI/CD

Pushing to `main` triggers GitHub Actions:

1. Type-check + test against a Postgres service container
2. Build Docker image → push to GHCR
3. SSH into VPS → pull new image → run migrations → restart API container
