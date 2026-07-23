# Household Budget Planner

A production-minded, mobile-first budgeting application for two partners. It keeps personal budgets, shared household costs, savings, notes, and a complete audit trail in a server-side relational database.

## Budget rules

- Shared housing is always allocated **75% to me and 25% to my partner**.
- Every other shared household bill is allocated by current income:
  `person income ÷ combined income × bill amount`.
- Personal expenses stay with their owner.
- Savings are deducted after personal and allocated shared commitments.
- If combined income is zero, the API returns a safe zero allocation for income-based costs and the UI explains what needs attention.

The single source of truth for these rules is [`lib/budget-rules.ts`](./lib/budget-rules.ts). The backend applies them to every response; UI components only render the returned allocations.

## Features

- Overview, My Budget, Partner Budget, Shared Household, Audit Log, and Settings
- Create, edit, delete, classify, pay/unpay, and make expenses recurring
- Editable income and savings for both partners
- Automatic split recalculation after relevant changes
- Server-side audit entries with before/after values
- Audit search and scope, action, and date filters
- Household notes, dark theme, responsive layouts, and large mobile touch targets
- Installable PWA assets for iPhone and other modern devices
- Seeded example budget on first use
- Docker image and Compose stack with a persistent database volume

## Run with Docker

Requirements: Docker Engine with the Compose plugin.

```bash
cp .env.example .env
docker compose up --build
```

Open `http://localhost:3000`. Stop with `docker compose down`. Your database remains in the named `budget_data` volume. To remove that data intentionally, run `docker compose down --volumes`.

### Container build workflow

The repository includes `.github/workflows/container.yml`. Pull requests build
the image without publishing it. Pushes to `main`, manual runs, and `v*` tags
publish multi-architecture images with provenance attestations and an SBOM to
GitHub Container Registry:

```text
ghcr.io/<github-owner>/<repository>:latest
```

The workflow uses the repository's built-in `GITHUB_TOKEN`, so no additional
registry secret is required.

## Local development

Requirements: Node.js 22+ and pnpm 11+.

```bash
pnpm install
pnpm run dev
```

For a production build:

```bash
pnpm run build
pnpm run start
```

## Database

The hosted application uses Cloudflare D1 through the logical `DB` binding declared in `.openai/hosting.json`. Drizzle schema definitions live in `db/schema.ts`, generated migrations live in `drizzle/`, and the API performs an idempotent schema check before first use. This makes an empty database immediately usable and safely installs the included starter data once.

All durable budget records and audit entries are server-side. Browser storage is not used as a source of truth; the only client-side persisted asset is the PWA application shell cache.

Generate a migration after changing `db/schema.ts`:

```bash
pnpm run db:generate
```

## API

`/api/budget` exposes the application backend:

- `GET` returns the complete derived budget snapshot.
- `POST` creates expenses and notes.
- `PATCH` updates income, savings, expenses, status, recurrence, and notes.
- `DELETE` removes expenses and notes.

Every state-changing route writes a human-readable server-side audit entry.

## Project structure

```text
app/
  api/budget/route.ts   Backend API and audit mutations
  BudgetApp.tsx         Application screens and interactions
  globals.css           Responsive product design
db/schema.ts            Relational schema
lib/budget-rules.ts     Central split and allocation rules
drizzle/                Database migrations
public/                 PWA manifest, icons, and service worker
Dockerfile              Multi-stage production image
compose.yaml            Container runtime and persistent volume
```

## Security and deployment

The application does not expose database credentials to the browser. Input is validated by the API and all database writes use prepared statements. For a public multi-household deployment, add an identity provider and household-level authorization before inviting unrelated users; this build is intentionally scoped to one private two-partner household.
