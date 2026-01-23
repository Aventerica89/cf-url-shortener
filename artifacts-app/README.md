# Artifact Manager

A Cloudflare Worker app to track and organize your Claude.ai artifacts.

## Features

- **Track Published Artifacts** - Store URLs from `claude.site/artifacts/...`
- **Track Downloaded Artifacts** - Log files you've downloaded locally
- **Collections** - Organize artifacts into folders/categories
- **Tags** - Flexible tagging for cross-cutting organization
- **Search** - Full-text search across names, descriptions, and notes
- **Favorites** - Star your most important artifacts
- **Export/Import** - Backup and restore your artifact library
- **Multi-user** - Each user's data is isolated via Cloudflare Access

## Quick Setup

### 1. Create the D1 Database

```bash
cd artifacts-app
wrangler d1 create artifact-manager
```

Copy the `database_id` from the output and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "artifact-manager"
database_id = "YOUR_DATABASE_ID_HERE"  # Paste here
```

### 2. Run Initial Migration

```bash
wrangler d1 execute artifact-manager --local --file=migrations.sql
```

### 3. Test Locally

```bash
wrangler dev
```

### 4. Deploy

```bash
wrangler deploy
```

### 5. Set Up Cloudflare Access (Authentication)

1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Access → Applications → Add an Application
3. Select "Self-hosted"
4. Configure:
   - Application name: `Artifact Manager`
   - Session duration: 24 hours (or your preference)
   - Application domain: `artifact-manager.YOUR-SUBDOMAIN.workers.dev`
5. Add a policy (e.g., allow your email domain)

## Automated Deployment (GitHub Actions)

If you want automatic deployments when you push to main:

### 1. Set GitHub Secrets

Go to your repo → Settings → Secrets → Actions:

- `CLOUDFLARE_API_TOKEN` - Create at [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
  - Permissions needed: `Account:Workers Scripts:Edit`, `Account:D1:Edit`
- `CLOUDFLARE_ACCOUNT_ID` - Found in Cloudflare dashboard sidebar

### 2. Copy Workflow

Copy `.github/workflows/deploy.yml` to your repo's `.github/workflows/` directory.

### 3. Push to Main

Any changes to `artifacts-app/**` will trigger deployment.

## Usage

### Adding Artifacts

1. Click "Add Artifact" button
2. Choose source type:
   - **Published**: For `claude.site/artifacts/...` URLs
   - **Downloaded**: For files you saved locally
3. Fill in details:
   - Name (required)
   - Description
   - Collection
   - Language/Framework
   - Tags
   - Conversation URL (link back to the chat)
   - Notes
4. Save

### Organizing

- **Collections**: Create collections for major categories (Web Apps, Code Snippets, Data Analysis, etc.)
- **Tags**: Add cross-cutting tags (react, python, prototype, production-ready, etc.)
- **Favorites**: Star artifacts you reference frequently

### Search

- Use `Cmd+K` (Mac) or `Ctrl+K` (Windows) to focus search
- Searches name, description, and notes
- Combine with collection/tag filters

### Export/Import

- **Export**: Downloads a JSON file with all your artifacts
- **Import**: Upload a previously exported JSON file to restore/merge data

## Schema

```sql
-- Collections (folders)
collections (id, name, slug, description, color, icon, user_email)

-- Artifacts
artifacts (
  id, name, description, artifact_type, source_type,
  published_url, artifact_id,  -- For published artifacts
  file_name, file_size, file_content,  -- For downloaded artifacts
  language, framework, claude_model, conversation_url, notes,
  collection_id, is_favorite, user_email,
  created_at, updated_at, artifact_created_at
)

-- Tags
tags (id, name, user_email)
artifact_tags (artifact_id, tag_id)
```

## Artifact Types

- `code` - Code snippets, functions, modules
- `html` - Web apps, HTML pages, interactive demos
- `document` - Text documents, markdown, reports
- `image` - Generated images, diagrams, charts
- `data` - Data files, CSVs, JSON, analysis results
- `other` - Everything else

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/artifacts` | List artifacts (supports filters) |
| POST | `/api/artifacts` | Create artifact |
| GET | `/api/artifacts/:id` | Get single artifact |
| PUT | `/api/artifacts/:id` | Update artifact |
| DELETE | `/api/artifacts/:id` | Delete artifact |
| POST | `/api/artifacts/:id/favorite` | Toggle favorite |
| GET | `/api/collections` | List collections |
| POST | `/api/collections` | Create collection |
| DELETE | `/api/collections/:slug` | Delete collection |
| GET | `/api/tags` | List tags with usage counts |
| GET | `/api/stats` | Get dashboard statistics |
| GET | `/api/export` | Export all data as JSON |
| POST | `/api/import` | Import data from JSON |

### Query Parameters for `/api/artifacts`

- `collection` - Filter by collection slug
- `tag` - Filter by tag name
- `type` - Filter by artifact type
- `source` - Filter by source type (published/downloaded)
- `favorite` - Set to `true` for favorites only
- `search` - Search term
- `sort` - `newest`, `oldest`, `name`, `updated`, `type`

## Tech Stack

- **Runtime**: Cloudflare Workers (edge computing)
- **Database**: Cloudflare D1 (SQLite)
- **Auth**: Cloudflare Access (Zero Trust)
- **UI**: Vanilla HTML/CSS/JS with Shadcn-inspired dark theme
- **Deployment**: Wrangler CLI / GitHub Actions

## License

MIT
