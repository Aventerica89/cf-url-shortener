# Claude Instructions for cf-url-shortener

## CRITICAL: Deployment is Fully Automatic

**DO NOT** tell the user to manually run database migrations or deploy via dashboard.

### How Deployment Works

1. **Push to `main` branch** triggers GitHub Actions
2. GitHub Actions automatically:
   - Runs `migrations.sql` against D1 database
   - Deploys worker code via `wrangler deploy`
3. **No manual steps required** after initial GitHub secrets setup

### Workflow Location

`.github/workflows/deploy.yml` handles everything:
- D1 migrations via: `wrangler d1 execute url-shortener --remote --file=migrations.sql`
- Worker deployment via: `wrangler deploy`

### Adding Schema Changes

1. Add SQL to `migrations.sql` using `CREATE TABLE IF NOT EXISTS` or `CREATE INDEX IF NOT EXISTS`
2. Push to main
3. Done - migrations run automatically

### One-Time Setup (Already Done)

User only needs to set these GitHub secrets once:
- `CLOUDFLARE_API_TOKEN` - with D1 Edit permission
- `CLOUDFLARE_ACCOUNT_ID` - from Cloudflare dashboard

### Files

| File | Purpose |
|------|---------|
| `worker-multiuser.js` | Main worker (Shadcn UI, categories, tags, search) |
| `migrations.sql` | Auto-runs on every deploy |
| `schema-multiuser.sql` | Full schema reference |
| `design-system.html` | UI playground for testing changes |
| `.github/workflows/deploy.yml` | CI/CD pipeline |

### Design System

The UI uses Shadcn-style CSS variables. To test UI changes:
1. Edit `design-system.html`
2. Open in browser to preview
3. Copy styles to `worker-multiuser.js` when ready
4. Push to main to deploy

### Database

- **D1 database name:** `url-shortener`
- **Tables:** links, categories, tags, link_tags
- **Multi-user:** Each user's data is isolated by `user_email`

### Remember

- Merging to `main` = automatic deploy
- Schema changes go in `migrations.sql`
- Never ask user to run wrangler commands or edit Cloudflare dashboard

---

## ARTIFACT MANAGER APP (January 2026)

### What It Is

A **separate** Cloudflare Worker app for tracking Claude.ai artifacts. Lives in `artifacts-app/` directory. Now deployed and working at `artifact-manager.jbmd-creations.workers.dev`.

### Architecture - Two Separate Apps

| App | Directory | Worker Name | D1 Database ID | URL |
|-----|-----------|-------------|----------------|-----|
| URL Shortener | root | `url-shortener` | `b47f73ea-a441-4f8f-986b-5080a7d2a1c9` | `links.jbcloud.app` |
| Artifact Manager | `artifacts-app/` | `artifact-manager` | `cf8e4875-7222-4186-8d57-be6ba55cc12a` | `artifact-manager.jbmd-creations.workers.dev` |

### Deployment - Two Separate Workflows

- `.github/workflows/deploy.yml` - URL shortener (any push to main)
- `.github/workflows/deploy-artifacts.yml` - Artifact Manager (only `artifacts-app/**` changes)

### Artifact Manager Features

- Track published artifacts (claude.site URLs)
- Track downloaded artifacts (local files)
- Collections (folders) and Tags
- Search, favorites, filtering
- Export/Import JSON backup
- Multi-user via Cloudflare Access
- Dark Shadcn-style UI

### Artifact Manager Files

| File | Purpose |
|------|---------|
| `artifacts-app/worker.js` | Main worker (~2100 lines) |
| `artifacts-app/migrations.sql` | D1 schema (collections, artifacts, tags, artifact_tags) |
| `artifacts-app/wrangler.toml` | Worker config |
| `artifacts-app/README.md` | Setup docs |

### Security (Fixed via Gemini Review)

All XSS vulnerabilities fixed:
- `escapeAttr()` for JS string contexts (onclick handlers)
- `escapeHtmlServer()` for server-side templating
- `escapeHtml()` for client-side innerHTML

### Known Issues / TODO

1. **Logout button** - Email in sidebar footer needs logout functionality
2. **Import button** - Needs testing (uploads JSON to restore artifacts)
3. **Default collections** - Auto-creates on first visit via `/api/init`

### User Info

- Account: JBMD Creations
- Email: john@jbmdcreations.com
- Workers subdomain: jbmd-creations.workers.dev
