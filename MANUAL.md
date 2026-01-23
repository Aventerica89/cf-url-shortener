# Manual Setup Guide

This guide covers everything you need to set up the URL shortener manually, without Claude Code assistance.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Cloudflare Setup](#step-1-cloudflare-setup)
- [Step 2: GitHub Setup](#step-2-github-setup)
- [Step 3: Deploy](#step-3-deploy)
- [Step 4: Authentication (Optional)](#step-4-authentication-optional)
- [Configuration Reference](#configuration-reference)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Cloudflare account with a domain added
- GitHub account
- Basic familiarity with the terminal (for local testing only)

---

## Step 1: Cloudflare Setup

### 1.1 Create a D1 Database

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **D1**
2. Click **Create database**
3. Name it: `url-shortener`
4. Copy the **Database ID** (you'll need this for `wrangler.toml`)

### 1.2 Create an API Token

1. Go to **My Profile** (top right) → **API Tokens**
2. Click **Create Token**
3. Click **Create Custom Token**
4. Configure permissions:

   | Scope | Resource | Permission |
   |-------|----------|------------|
   | Account | Workers Scripts | Edit |
   | Account | D1 | Edit |
   | Zone | Workers Routes | Edit |

5. Account Resources: **Include** → Your account
6. Zone Resources: **Include** → All zones (or your specific domain)
7. Click **Continue to summary** → **Create Token**
8. **Copy the token immediately** - you won't see it again

### 1.3 Get Your Account ID

1. Go to **Workers & Pages**
2. Your **Account ID** is in the right sidebar - copy it

### 1.4 Update wrangler.toml

After forking the repo, update `wrangler.toml` with your values:

```toml
name = "url-shortener"
main = "worker-multiuser.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "url-shortener"
database_id = "YOUR-DATABASE-ID-HERE"  # ← Replace this

[[routes]]
pattern = "links.yourdomain.com"  # ← Replace with your domain
custom_domain = true
```

---

## Step 2: GitHub Setup

### 2.1 Fork the Repository

1. Click **Fork** on the repo page
2. Keep all settings default
3. Click **Create fork**

### 2.2 Add Repository Secrets

1. Go to your fork → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add:

   | Name | Value |
   |------|-------|
   | `CLOUDFLARE_API_TOKEN` | Your API token from Step 1.2 |
   | `CLOUDFLARE_ACCOUNT_ID` | Your Account ID from Step 1.3 |

**Note:** After saving, secrets appear blank when editing - this is normal security behavior.

---

## Step 3: Deploy

### Automatic Deployment

Every push to `main` triggers deployment automatically via GitHub Actions:

1. Go to **Actions** tab
2. You should see a workflow running (or click **Run workflow** manually)
3. Wait for it to complete (usually under 1 minute)

### What Happens on Deploy

1. **D1 Migrations** - `migrations.sql` runs against your database
2. **Worker Deploy** - `worker-multiuser.js` deploys to Cloudflare

### Verify Deployment

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages**
2. Click on `url-shortener`
3. You should see your worker with a `*.workers.dev` URL
4. Your custom domain should also be active

---

## Step 4: Authentication (Optional)

For multi-user support, set up Cloudflare Access:

### 4.1 Create Access Application

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com)
2. Navigate to **Access** → **Applications**
3. Click **Add an application** → **Self-hosted**

### 4.2 Configure Application

| Field | Value |
|-------|-------|
| Application name | URL Shortener Admin |
| Session Duration | 24 hours (or your preference) |
| Application domain | `links.yourdomain.com` |
| Path | `/admin*` |

Add another path: `/api/*`

### 4.3 Create Policy

1. Policy name: `Allow Users`
2. Action: **Allow**
3. Add a rule:
   - **Emails ending in** → `@yourdomain.com`
   - Or **Emails** → specific email addresses

### 4.4 Enable Identity Providers

1. Go to **Settings** → **Authentication**
2. Enable providers: Google, GitHub, Email OTP, etc.

Public redirects (`/shortcode`) will work without authentication.

---

## Configuration Reference

### Project Structure

```
cf-url-shortener/
├── .github/workflows/
│   └── deploy.yml           # GitHub Actions workflow
├── worker-multiuser.js      # Main worker code
├── wrangler.toml            # Cloudflare configuration
├── migrations.sql           # Database migrations (auto-run)
├── schema-multiuser.sql     # Full schema reference
├── design-system.html       # UI component reference
├── README.md                # Quick start guide
├── MANUAL.md                # This file
└── CLAUDE.md                # Instructions for Claude Code
```

### Environment Variables

The worker uses these Cloudflare-provided headers for authentication:

| Header | Description |
|--------|-------------|
| `Cf-Access-Authenticated-User-Email` | Current user's email |

### Adding Schema Changes

1. Edit `migrations.sql`
2. Use `CREATE TABLE IF NOT EXISTS` or `CREATE INDEX IF NOT EXISTS`
3. Push to `main`
4. Migrations run automatically

---

## API Documentation

All API endpoints require authentication (except redirects).

### Links

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/links` | List all links |
| `GET` | `/api/links?category=work` | Filter by category |
| `GET` | `/api/links?tag=important` | Filter by tag |
| `GET` | `/api/links?sort=clicks` | Sort by clicks |
| `POST` | `/api/links` | Create link |
| `PUT` | `/api/links/:code` | Update link |
| `DELETE` | `/api/links/:code` | Delete link |

#### Create Link Request

```json
{
  "code": "gh",
  "destination": "https://github.com/user/repo",
  "category_id": 1,
  "tags": ["dev", "important"]
}
```

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/categories` | List categories with link counts |
| `POST` | `/api/categories` | Create category |
| `DELETE` | `/api/categories/:slug` | Delete category |

#### Create Category Request

```json
{
  "name": "Work",
  "slug": "work",
  "color": "violet"
}
```

Available colors: `violet`, `pink`, `cyan`, `orange`, `green`, `gray`

### Tags

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tags` | List tags with usage counts |

### Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/search?q=query` | Search links by code, destination, tags |

### Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats` | Get dashboard statistics |

### Import/Export

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/export` | Export all data as JSON |
| `POST` | `/api/import` | Import data from JSON |

#### Export Format (v2)

```json
{
  "version": 2,
  "exported_at": "2024-01-01T00:00:00.000Z",
  "links": [...],
  "categories": [...],
  "tags": [...],
  "link_tags": [...]
}
```

### Redirects (Public)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/:code` | Redirect to destination |

---

## Database Schema

### Links Table

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

CREATE INDEX idx_links_user ON links(user_email);
CREATE INDEX idx_links_category ON links(category_id);
```

### Categories Table

```sql
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT DEFAULT 'gray',
  user_email TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(slug, user_email)
);
```

### Tags Tables

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
  PRIMARY KEY (link_id, tag_id),
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

---

## Troubleshooting

### Deployment Fails: "Could not route to /client/v4/accounts/..."

**Cause:** Invalid or missing GitHub secrets.

**Fix:**
1. Verify `CLOUDFLARE_API_TOKEN` has D1 Edit permission
2. Verify `CLOUDFLARE_ACCOUNT_ID` is correct (32-character hex string)
3. Re-enter both secrets in GitHub (they may not have saved properly)

### Deployment Fails: "Invalid Routes... Wildcard operators not allowed"

**Cause:** Custom domains don't support wildcards.

**Fix:** In `wrangler.toml`, change:
```toml
# Wrong
pattern = "links.example.com/*"

# Correct
pattern = "links.example.com"
```

### Links Return 404

**Cause:** Database migrations didn't run.

**Fix:**
1. Go to Actions → Latest workflow run
2. Check if "Run D1 Migrations" step succeeded
3. If not, check your API token has D1 permissions

### "Unauthorized" on Admin Page

**Cause:** Cloudflare Access not configured.

**Fix:** Either:
- Set up Cloudflare Access (Step 4)
- Or for testing, the worker allows access if no `Cf-Access-Authenticated-User-Email` header is present

### Custom Domain Not Working

**Cause:** DNS not configured or propagating.

**Fix:**
1. Ensure your domain is on Cloudflare (orange cloud enabled)
2. Check Workers & Pages → your worker → Triggers → Custom Domains
3. Wait up to 5 minutes for DNS propagation

### GitHub Actions Not Running

**Cause:** Workflow not enabled or triggered.

**Fix:**
1. Go to Actions tab
2. If you see "Workflows aren't being run", click **I understand my workflows, go ahead and enable them**
3. Manually trigger: Click workflow → **Run workflow**

---

## Local Development

For local testing with Wrangler:

```bash
# Install dependencies
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Run locally
wrangler dev

# Run migrations locally
wrangler d1 execute url-shortener --local --file=migrations.sql
```

---

## Support

- **Issues:** Open a GitHub issue
- **Claude Code users:** Just ask Claude for help
