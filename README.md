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

| Method | Path                       | Auth   | Description                                  |
| ------ | -------------------------- | ------ | -------------------------------------------- |
| `GET`  | `/api/health`              | No     | Health check                                 |
| `POST` | `/api/auth/register`       | No     | Create account                               |
| `POST` | `/api/auth/login`          | No     | Sign in (returns JWT + sets refresh cookie)  |
| `POST` | `/api/auth/refresh`        | Cookie | Silent token refresh                         |
| `POST` | `/api/auth/logout`         | Cookie | Revoke refresh token                         |
| `GET`  | `/api/auth/me`             | Bearer | Get authenticated user profile               |
| `POST` | `/api/budget/sync`         | Bearer | Process a sync operation (add/update/delete) |
| `POST` | `/api/budget/sync/batch`   | Bearer | Process multiple sync operations at once     |
| `GET`  | `/api/budget/entries`      | Bearer | Fetch all entries for the authenticated user |

## Local Development

### Prerequisites

- Node.js ≥ 20
- Docker (recommended) or a local PostgreSQL 16 installation

### Quick Start (Docker — recommended)

```bash
# 1. Install dependencies
npm install

# 2. Start a local Postgres container
docker compose -f docker-compose.dev.yml up -d

# 3. Create your .env from the template
cp .env.example .env
# The defaults match docker-compose.dev.yml — no edits needed

# 4. Run database migrations
npm run db:migrate

# 5. Seed a test user + sample budget entries
npm run db:seed
# Creates: test@budgeto.app / password123

# 6. Start the dev server (auto-reload)
npm start
```

The API will be running at **http://localhost:4000**.

> **Tip:** The frontend dev server runs on `http://localhost:5173` by default. The `.env.example` already has `CORS_ORIGIN=http://localhost:5173` so cross-origin requests work out of the box.

### Without Docker

If you have PostgreSQL installed natively:

```bash
# Create the database
createdb budgeto

# Copy and edit .env to match your local Postgres credentials
cp .env.example .env
# Edit DB_USER, DB_PASSWORD, etc.

# Then follow steps 1, 4, 5, 6 above
```

### Useful Commands

```bash
npm start            # Start dev server with hot reload (tsx watch)
npm run build        # Build for production (tsup → dist/)
npm run start:prod   # Run production build
npm run typecheck    # Type-check without emitting
npm run test:watch   # Run tests in watch mode
npm run db:generate  # Generate migration SQL from schema changes
npm run db:migrate   # Apply pending migrations
npm run db:seed      # Seed test user + sample entries
npm run db:push      # Push schema directly (skip migrations)
npm run db:studio    # Open Drizzle Studio (DB browser)
```

### Testing the API

Once the server is running, you can verify it's working:

```bash
# Health check
curl http://localhost:4000/api/health

# Register a new user
curl -X POST http://localhost:4000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"mypassword"}'

# Or log in with the seeded test user
curl -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@budgeto.app","password":"password123"}'
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
