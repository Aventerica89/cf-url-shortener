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

## CURRENT ISSUE (January 2026)

### Problem: GitHub Actions deployment failing

**Error:** `Could not route to /client/v4/accounts/.../d1/database/... [code: 7003]`

**Root cause:** GitHub secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` were found to be empty.

### What was done:
1. Fixed `wrangler.toml` syntax: changed `[routes]` to `[[routes]]` (TOML array syntax)
2. Pinned wrangler version to 3.90.0 in deploy.yml
3. User re-entered the secrets

### What still needs to happen:
1. **Verify GitHub secrets are correctly saved:**
   - Go to: https://github.com/Aventerica89/cf-url-shortener/settings/secrets/actions
   - `CLOUDFLARE_ACCOUNT_ID` - 32-char hex string from Cloudflare dashboard (Workers & Pages → right sidebar)
   - `CLOUDFLARE_API_TOKEN` - API token with permissions: Account → Workers Scripts → Edit, Account → D1 → Edit

2. **Re-run the workflow** after secrets are confirmed

3. **If still failing**, check:
   - Is the D1 database `url-shortener` (ID: `b47f73ea-a441-4f8f-986b-5080a7d2a1c9`) in the correct account?
   - Does the API token have the right account selected when created?

### New Shadcn UI ready to deploy:
- `worker-multiuser.js` has the new dark theme with sidebar, categories, tags, AJAX search
- `migrations.sql` has the schema for categories, tags, link_tags tables
- Everything is merged to main, just needs successful deployment
