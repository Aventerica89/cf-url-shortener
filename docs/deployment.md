# Deployment Guide

This project uses GitHub Actions for fully automatic deployment. Push to `main` = instant deployment.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         GitHub                                   │
│  ┌─────────────┐    ┌─────────────────────────────────────────┐ │
│  │   Push to   │───>│           GitHub Actions                 │ │
│  │    main     │    │  ┌─────────────┐  ┌─────────────────┐   │ │
│  └─────────────┘    │  │ Run D1      │  │ Deploy Worker   │   │ │
│                     │  │ Migrations  │─>│ to Cloudflare   │   │ │
│                     │  └─────────────┘  └─────────────────┘   │ │
│                     └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Cloudflare                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │    Workers      │  │   D1 Database   │  │     Access      │ │
│  │  (Edge Code)    │  │   (SQLite)      │  │  (Auth Layer)   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Workflows

### URL Shortener (.github/workflows/deploy.yml)

Triggers on **any push to main**.

```yaml
name: Deploy URL Shortener

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Wrangler
        run: npm install -g wrangler

      - name: Run D1 Migrations
        run: wrangler d1 execute url-shortener --remote --file=migrations.sql
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Deploy Worker
        run: wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

### Artifact Manager (.github/workflows/deploy-artifacts.yml)

Triggers **only when `artifacts-app/**` changes**.

```yaml
name: Deploy Artifact Manager

on:
  push:
    branches: [main]
    paths:
      - 'artifacts-app/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: artifacts-app
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Wrangler
        run: npm install -g wrangler

      - name: Run D1 Migrations
        run: wrangler d1 execute artifact-manager --remote --file=migrations.sql
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

      - name: Deploy Worker
        run: wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

---

## Required Secrets

Set these in GitHub repository settings:

| Secret | Description | Where to Find |
|--------|-------------|---------------|
| `CLOUDFLARE_API_TOKEN` | API token with D1 + Workers permissions | Cloudflare Dashboard → My Profile → API Tokens |
| `CLOUDFLARE_ACCOUNT_ID` | 32-character account identifier | Workers & Pages → right sidebar |

### Creating API Token

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click your profile → **API Tokens**
3. Click **Create Token**
4. Select **Create Custom Token**
5. Add permissions:

| Scope | Resource | Permission |
|-------|----------|------------|
| Account | Workers Scripts | Edit |
| Account | D1 | Edit |
| Zone | Workers Routes | Edit |

6. Account Resources: Include → Your account
7. Zone Resources: Include → All zones
8. Create and copy the token

### Adding Secrets to GitHub

1. Go to your repo → **Settings**
2. Click **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add both secrets

---

## Database Migrations

### How Migrations Work

1. All schema changes go in `migrations.sql`
2. GitHub Actions runs migrations on every deploy
3. Use `IF NOT EXISTS` for idempotent operations

### migrations.sql Pattern

```sql
-- Tables
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  destination TEXT NOT NULL,
  -- ... more columns
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_email);

-- New columns (use separate statements)
-- ALTER TABLE links ADD COLUMN new_column TEXT;
-- Note: D1 doesn't support IF NOT EXISTS for ALTER TABLE
```

### Adding New Columns

For new columns, wrap in a try-catch approach or check existence:

```sql
-- Option 1: Just add it (will fail silently if exists on some DBs)
ALTER TABLE links ADD COLUMN description TEXT;

-- Option 2: Create a new migration file for complex changes
```

---

## Manual Deployment

If you need to deploy manually (not recommended):

```bash
# Install wrangler
npm install -g wrangler

# Login
wrangler login

# Run migrations
wrangler d1 execute url-shortener --remote --file=migrations.sql

# Deploy
wrangler deploy
```

For Artifact Manager:
```bash
cd artifacts-app
wrangler d1 execute artifact-manager --remote --file=migrations.sql
wrangler deploy
```

---

## Rollback

### Rollback Worker Code

1. Go to **Actions** tab
2. Find previous successful deployment
3. Click **Re-run all jobs**

Or push a revert commit:
```bash
git revert HEAD
git push
```

### Rollback Database

D1 doesn't have automatic rollbacks. Options:

1. **Import from backup** - Use `/api/import` with a previous export
2. **Manual SQL** - Run corrective SQL via wrangler:
   ```bash
   wrangler d1 execute url-shortener --remote --command "DELETE FROM links WHERE ..."
   ```

---

## Monitoring

### Deployment Status

- **GitHub Actions** - Check the Actions tab for workflow runs
- **Cloudflare Dashboard** - Workers & Pages shows deployment status

### Logs

1. Go to Cloudflare Dashboard → Workers & Pages
2. Click your worker
3. Click **Logs** tab
4. Use **Real-time Logs** for live debugging

### Errors

Common deployment errors:

| Error | Cause | Fix |
|-------|-------|-----|
| "Could not route to /client/v4/accounts" | Invalid API token | Regenerate token with correct permissions |
| "Database not found" | D1 database doesn't exist | Create database in Cloudflare Dashboard |
| "Wildcard operators not allowed" | Invalid route pattern | Remove `/*` from custom domain pattern |

---

## Local Development

```bash
# Clone repo
git clone https://github.com/your-username/cf-url-shortener
cd cf-url-shortener

# Install wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create local D1 database
wrangler d1 execute url-shortener --local --file=migrations.sql

# Run locally
wrangler dev
```

Local development uses a separate SQLite file that doesn't affect production.

---

## Two-App Deployment

The project has two independent deployments:

| App | Workflow | Trigger | Database |
|-----|----------|---------|----------|
| URL Shortener | `deploy.yml` | Any push to main | `url-shortener` |
| Artifact Manager | `deploy-artifacts.yml` | Only `artifacts-app/**` changes | `artifact-manager` |

This means:
- Editing `worker-multiuser.js` only deploys URL Shortener
- Editing `artifacts-app/worker.js` only deploys Artifact Manager
- Each has its own D1 database
- Each has its own wrangler.toml configuration
