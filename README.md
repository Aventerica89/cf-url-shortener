# URL Shortener

A fast, multi-user URL shortener built with Cloudflare Workers and D1 database. Features categories, tags, AJAX search, and fully automatic deployment via GitHub Actions.

**Live:** https://links.jbcloud.app
**Admin:** https://links.jbcloud.app/admin

## Features

- ⚡ Fast redirects via Cloudflare's edge network
- 👥 Multi-user support (each user has private links)
- 🔐 Authentication via Cloudflare Access (Google, GitHub, Email)
- 📁 Categories for organizing links (Work, Personal, Social, Marketing, Docs)
- 🏷️ Tags for flexible link organization
- 🔍 AJAX search with Cmd+K shortcut
- 📊 Stats dashboard with click tracking
- 📤 Export/Import links as JSON (v2 format with categories/tags)
- 🎨 Shadcn-style dark theme UI
- 🚀 **Fully automatic deployment** - push to main, everything deploys
- 💰 Free tier friendly (100k requests/day)

## Stack

- **Cloudflare Workers** - Serverless compute at the edge
- **Cloudflare D1** - SQLite database
- **Cloudflare Access** - Authentication (free for 50 users)
- **GitHub Actions** - CI/CD auto-deployment with D1 migrations
- **No frameworks** - Pure JavaScript, single file

---

## Automatic Deployment

**Push to `main` and everything deploys automatically** - worker code AND database migrations.

### One-Time Setup (5 minutes)

#### 1. Create Cloudflare API Token

- Go to: [Cloudflare Dashboard](https://dash.cloudflare.com) → My Profile (top right) → API Tokens
- Click "Create Token"
- Use template: **"Edit Cloudflare Workers"**
- Add permission: **Account | D1 | Edit** (required for migrations)
- Account Resources: Include → Your Account Name
- Zone Resources: Include → All zones (or specific zone)
- Click "Continue to summary" → "Create Token"
- **Copy the token immediately** (you won't see it again!)

#### 2. Get your Account ID

- Go to: Cloudflare Dashboard → Workers & Pages
- Your Account ID is in the right sidebar

#### 3. Add Secrets to GitHub

- Go to: Your repo → Settings → Secrets and variables → Actions
- Click "New repository secret"
- Add two secrets:

| Name | Value |
|------|-------|
| `CLOUDFLARE_API_TOKEN` | Your API token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | Your account ID from step 2 |

#### 4. Done!

Now every push to `main`:
1. Runs database migrations automatically (`migrations.sql`)
2. Deploys the worker code

No manual steps. No dashboard editing. Just push and go.

### Manual Trigger

- Go to: Actions tab → "Deploy to Cloudflare Workers" → "Run workflow"

---

## How It Works

### Workflow File (`.github/workflows/deploy.yml`)

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    name: Deploy Worker
    steps:
      - uses: actions/checkout@v4

      - name: Run D1 Migrations
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: d1 execute url-shortener --remote --file=migrations.sql
        continue-on-error: true  # Migrations may already be applied

      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

### Database Migrations

The `migrations.sql` file runs on every deploy. It uses `CREATE TABLE IF NOT EXISTS` so it's safe to run repeatedly:

```sql
-- Creates tables only if they don't exist
CREATE TABLE IF NOT EXISTS categories (...);
CREATE TABLE IF NOT EXISTS tags (...);
CREATE TABLE IF NOT EXISTS link_tags (...);
CREATE INDEX IF NOT EXISTS idx_... ON ...;
```

**To add new schema changes:**
1. Add SQL to `migrations.sql` using `IF NOT EXISTS` patterns
2. Push to main
3. Done - migrations run automatically

---

## Project Structure

```
url-shortener/
├── .github/workflows/
│   └── deploy.yml           # Auto-deploy + migrations on push
├── worker-multiuser.js      # Main worker with Shadcn UI
├── worker.js                # Simple single-user version
├── wrangler.toml            # Cloudflare config
├── migrations.sql           # Auto-runs on deploy
├── schema-multiuser.sql     # Full schema reference
├── schema.sql               # Single-user schema
├── design-system.html       # UI playground/reference
└── README.md
```

---

## API Endpoints

### Links

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/links` | List links (with category/tag filters) |
| POST | `/api/links` | Create link |
| PUT | `/api/links/:code` | Update link |
| DELETE | `/api/links/:code` | Delete link |
| GET | `/api/search?q=` | Search links |

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | List categories with counts |
| POST | `/api/categories` | Create category |
| DELETE | `/api/categories/:slug` | Delete category |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tags` | List tags with usage counts |
| GET | `/api/stats` | Dashboard stats |
| GET | `/api/export` | Export all data (v2 JSON) |
| POST | `/api/import` | Import data |
| GET | `/:code` | Redirect (public) |
| GET | `/admin` | Admin dashboard |

### Examples

```bash
# Create a link with category and tags
curl -X POST https://links.jbcloud.app/api/links \
  -H "Content-Type: application/json" \
  -d '{"code": "portfolio", "destination": "https://example.com", "category_id": 1, "tags": ["work", "main"]}'

# Search links
curl "https://links.jbcloud.app/api/search?q=portfolio"

# Filter by category
curl "https://links.jbcloud.app/api/links?category=work&sort=clicks"
```

---

## Database Schema

### Links
```sql
CREATE TABLE links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  destination TEXT NOT NULL,
  clicks INTEGER DEFAULT 0,
  user_email TEXT NOT NULL,
  category_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Categories
```sql
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT DEFAULT 'gray',  -- violet, pink, cyan, orange, green, gray
  user_email TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(slug, user_email)
);
```

### Tags
```sql
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name, user_email)
);

CREATE TABLE link_tags (
  link_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (link_id, tag_id)
);
```

---

## Multi-User Setup (Cloudflare Access)

The admin requires authentication via Cloudflare Access (free for 50 users).

### Setup

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com)
2. Access → Applications → Add application → Self-hosted
3. Configure:
   - Name: `Link Shortener Admin`
   - Domain: `links.yourdomain.com`
   - Path: `/admin*` and `/api/*`
4. Add policy: Allow emails ending in `@yourdomain.com` (or specific emails)
5. Enable login methods: Google, GitHub, or Email OTP

Public redirects (`/shortcode`) work without login.

---

## Costs

**Cloudflare Free Tier:**
- Workers: 100,000 requests/day
- D1: 5GB storage, 5M rows read/day
- Access: 50 users
- No egress fees, no surprise bills

---

## License

MIT - Do whatever you want with it.
