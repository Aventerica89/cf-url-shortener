# URL Shortener

A simple, fast, multi-user URL shortener built with Cloudflare Workers and D1 database. Features automatic deployment via GitHub Actions.

**Live:** https://links.jbcloud.app  
**Admin:** https://links.jbcloud.app/admin

## Features

- ⚡ Fast redirects via Cloudflare's edge network
- 👥 Multi-user support (each user has private links)
- 🔐 Authentication via Cloudflare Access (Google, GitHub, Email)
- 📊 Click tracking per link
- 📤 Export/Import links as JSON
- 🎨 Clean admin interface
- 🚀 Auto-deploy on git push
- 💰 Free tier friendly (100k requests/day)
- 🔒 No surprise billing

## Stack

- **Cloudflare Workers** - Serverless compute at the edge
- **Cloudflare D1** - SQLite database
- **Cloudflare Access** - Authentication (free for 50 users)
- **GitHub Actions** - CI/CD auto-deployment
- **No frameworks** - Pure JavaScript, ~200 lines

## Why This Exists

Originally attempted to self-host [Shlink](https://shlink.io/) on xCloud.host via Docker Compose, but ran into issues:
- Docker command permissions (`permission denied` for `docker exec`)
- Couldn't expose second port (8081) for admin UI
- Logs page wasn't working in xCloud dashboard

Cloudflare Workers + D1 turned out to be simpler, faster, and free.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin` | Admin dashboard |
| GET | `/api/links` | List all links |
| POST | `/api/links` | Create a link |
| DELETE | `/api/links/:code` | Delete a link |
| GET | `/:code` | Redirect to destination |

### Create a link

```bash
curl -X POST https://links.jbcloud.app/api/links \
  -H "Content-Type: application/json" \
  -d '{"code": "portfolio", "destination": "https://jbmdcreations.com/portfolio"}'
```

### List all links

```bash
curl https://links.jbcloud.app/api/links
```

### Delete a link

```bash
curl -X DELETE https://links.jbcloud.app/api/links/portfolio
```

---

## Setup with Claude AI (Fastest Method)

If you have Claude with the Cloudflare MCP integration connected, Claude can set up most of this automatically.

### Prerequisites

1. **Claude Pro/Team account** with access to connectors
2. **Cloudflare MCP integration** enabled in Claude settings (Settings → Connectors → Cloudflare Developer Platform)
3. **Cloudflare account** with a domain (optional but recommended)

### What Claude Can Do Automatically

| Task | Automated? |
|------|------------|
| Create D1 database | ✅ Yes |
| Create tables & schema | ✅ Yes |
| Insert test data | ✅ Yes |
| Query/manage data | ✅ Yes |
| List existing resources | ✅ Yes |
| **Deploy Worker code** | ❌ Manual (dashboard) |
| **Add database binding** | ❌ Manual (dashboard) |
| **Add custom domain** | ❌ Manual (dashboard) |

### Example Prompts

**Initial setup:**
```
I want to create a URL shortener using Cloudflare Workers and D1. 
Can you:
1. Create a D1 database called "url-shortener"
2. Create a links table with columns: id, code, destination, clicks, created_at
3. Add a test link pointing to my website
```

**After manual Worker deployment:**
```
Add a new short link: "portfolio" pointing to "https://mysite.com/portfolio"
```

**Check your links:**
```
Show me all the links in my url-shortener database
```

**Check click stats:**
```
Which of my short links has the most clicks?
```

### Manual Steps (Dashboard)

After Claude creates the database, you still need to:

1. **Deploy the Worker** - Go to Cloudflare Dashboard → Workers & Pages → Create Worker → paste the code from `worker.js`

2. **Bind the database** - Worker Settings → Bindings → Add → D1 Database → Variable name: `DB` → Select `url-shortener`

3. **Add custom domain** (optional) - Worker Settings → Domains & Routes → Add your domain

These steps require the Cloudflare dashboard because the MCP integration doesn't currently support deploying Worker code or managing bindings.

---

## Setup Guide (Fresh Install)

### Prerequisites

- Cloudflare account
- Domain managed by Cloudflare (optional, can use workers.dev subdomain)

### Option 1: Dashboard Setup (No CLI)

1. **Create D1 Database**
   - Go to Cloudflare Dashboard → Workers & Pages → D1
   - Click "Create database"
   - Name it `url-shortener`
   - Run the SQL from `schema.sql` in the console

2. **Create Worker**
   - Go to Workers & Pages → Create → Create Worker
   - Click "Start with Hello World"
   - Name it `url-shortener`
   - Deploy, then click "Edit code"
   - Replace with contents of `worker.js`
   - Deploy again

3. **Bind Database**
   - Go to Worker → Settings → Bindings
   - Add binding → D1 Database
   - Variable name: `DB`
   - Select your `url-shortener` database
   - Save

4. **Add Custom Domain (optional)**
   - Go to Worker → Settings → Domains & Routes
   - Add custom domain (e.g., `links.yourdomain.com`)
   - Cloudflare auto-adds DNS record

### Option 2: Wrangler CLI

```bash
# Install Wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create database
wrangler d1 create url-shortener

# Update wrangler.toml with your database_id

# Initialize schema
wrangler d1 execute url-shortener --file=schema.sql

# Deploy
wrangler deploy
```

---

## Project Structure

```
url-shortener/
├── .github/
│   └── workflows/
│       └── deploy.yml        # Auto-deploy on push to main
├── worker.js                 # Single-user version (original)
├── worker-multiuser.js       # Multi-user with Cloudflare Access auth
├── wrangler.toml             # Cloudflare Workers config
├── schema.sql                # Single-user database schema
├── schema-multiuser.sql      # Multi-user database schema
├── .gitignore
└── README.md
```

## Choosing Single vs Multi-User

| Feature | `worker.js` | `worker-multiuser.js` |
|---------|-------------|----------------------|
| Auth required | No | Yes (Cloudflare Access) |
| Multiple users | No (shared pool) | Yes (private links per user) |
| Export/Import | No | Yes |
| Stats dashboard | No | Yes |
| Setup complexity | Simple | Moderate |

To switch versions, update `main` in `wrangler.toml`:
```toml
main = "worker.js"           # Single-user
main = "worker-multiuser.js" # Multi-user
```

## Database Schema

```sql
CREATE TABLE links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  destination TEXT NOT NULL,
  clicks INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Costs

**Cloudflare Free Tier:**
- Workers: 100,000 requests/day
- D1: 5GB storage, 5M rows read/day
- No egress fees
- No surprise bills

This is more than enough for personal/small business use.

---

## Notes

### Why not Shlink on xCloud?

Initially tried deploying [Shlink](https://shlink.io/) via Docker Compose on xCloud.host but ran into issues:
- Docker command permissions (`permission denied` for `docker exec`)
- Couldn't access second port (8081) for admin UI
- Logs page wasn't working

Cloudflare Workers + D1 turned out to be simpler and free.

---

## Multi-User Version

Want multiple people to have their own separate link collections? Use `worker-multiuser.js` with Cloudflare Access.

### Features
- 🔐 Google/GitHub/Email login via Cloudflare Access
- 👤 Each user sees only their own links
- 📤 Export links to JSON
- 📥 Import links from JSON backup
- 📊 Personal click stats

### Setup Cloudflare Access (Free for 50 users)

1. **Go to Cloudflare Zero Trust Dashboard**
   - https://one.dash.cloudflare.com
   - Select your account

2. **Create an Access Application**
   - Access → Applications → Add an application
   - Select "Self-hosted"
   - Name: `Link Shortener Admin`
   - Session duration: 24 hours (or your preference)
   - Application domain: `links.jbcloud.app`
   - Path: `/admin*` and `/api/*`

3. **Add a Policy**
   - Policy name: `Allow users`
   - Action: Allow
   - Include: Emails ending in `@yourdomain.com` (or specific emails)
   
   For open access with any Google account:
   - Include: Everyone
   - Require: Login methods → Google

4. **Configure Identity Providers**
   - Settings → Authentication → Login methods
   - Add Google, GitHub, or One-time PIN (email)

5. **Update Database Schema**
   ```sql
   -- Add user_email column (if migrating from single-user)
   ALTER TABLE links ADD COLUMN user_email TEXT;
   
   -- Or create fresh with schema-multiuser.sql
   ```

6. **Deploy Multi-user Worker**
   - Replace your worker code with `worker-multiuser.js`
   - Deploy

### How It Works

Cloudflare Access adds a JWT token to every request with the user's email. The worker decodes this to identify users:

```
Request → Cloudflare Access (login) → JWT added → Worker (reads email) → User's links
```

Public redirects (`/shortcode`) don't require login - only admin/API routes do.

### Files

| File | Description |
|------|-------------|
| `worker.js` | Single-user (original) |
| `worker-multiuser.js` | Multi-user with auth |
| `schema.sql` | Single-user database |
| `schema-multiuser.sql` | Multi-user database |

---

### Security Notes

- Short codes are globally unique (first-come-first-served)
- Users can only delete their own links
- Export only includes the user's own links
- Cloudflare Access handles all auth - no passwords stored

---

## Automated Deployment (CI/CD)

Push to GitHub and it auto-deploys to Cloudflare. No manual dashboard editing needed.

### Setup GitHub Actions

**1. Create Cloudflare API Token**

- Go to: Cloudflare Dashboard → My Profile (top right) → API Tokens
- Click "Create Token"
- Use template: **"Edit Cloudflare Workers"**
- Configure permissions (these should be pre-filled):
  - Account | Workers Agents Configuration | Edit
  - User | Memberships | Read
  - Account | Workers Observability | Edit
  - Account | Containers | Edit
- Account Resources: Include → **Your Account Name**
- Zone Resources: Include → **All zones** (or specific zone)
- Click "Continue to summary" → "Create Token"
- **Copy the token immediately** (you won't see it again!)

**2. Get your Account ID**

- Go to: Cloudflare Dashboard → Workers & Pages
- Your Account ID is in the right sidebar, or in the URL

**3. Add Secrets to GitHub**

- Go to: Your repo → Settings → Secrets and variables → Actions
- Click "New repository secret"
- Add two secrets:

| Name | Value |
|------|-------|
| `CLOUDFLARE_API_TOKEN` | Your API token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | Your account ID from step 2 |

**4. Push to Deploy**

- Every push to `main` branch triggers auto-deploy
- Or manually trigger: Actions tab → "Deploy to Cloudflare Workers" → "Run workflow"
- Deploys in ~30 seconds

### Workflow File

Located at `.github/workflows/deploy.yml`:

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
      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

---

## License

MIT - Do whatever you want with it.
