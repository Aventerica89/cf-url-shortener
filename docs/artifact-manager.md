# Artifact Manager

A separate Cloudflare Worker app for tracking and organizing Claude.ai artifacts.

---

## Overview

The Artifact Manager helps you keep track of artifacts created in Claude.ai conversations:

- **Published Artifacts** - claude.site URLs you've shared
- **Downloaded Artifacts** - Files saved locally from Claude
- **Collections** - Organize artifacts into folders
- **Tags** - Cross-cutting organization
- **Search** - Find artifacts quickly

---

## Features

### Artifact Tracking

| Feature | Description |
|---------|-------------|
| **Published URLs** | Track `claude.site/artifacts/...` links |
| **Downloaded Files** | Store file name, size, and content |
| **Rich Metadata** | Name, description, notes, language/framework |
| **Conversation Links** | Link back to original Claude chat |
| **Model Tracking** | Record which Claude model created it |

### Artifact Types

| Type | Description |
|------|-------------|
| `code` | Code snippets and modules |
| `html` | Web apps and interactive demos |
| `document` | Text and markdown documents |
| `image` | Generated images and diagrams |
| `data` | Data files and analysis results |
| `other` | Miscellaneous artifacts |

### Organization

| Feature | Description |
|---------|-------------|
| **Collections** | Folders with custom colors and icons |
| **Tags** | Flexible many-to-many tagging |
| **Favorites** | Star important artifacts |
| **Search** | Full-text search with Cmd+K |
| **Filtering** | By collection, tag, type, source |
| **Sorting** | Newest, oldest, name, updated, type |

### Data Management

| Feature | Description |
|---------|-------------|
| **Export** | Download all artifacts as JSON |
| **Import** | Restore from backup files |
| **Multi-user** | Per-user data isolation |

---

## Installation

The Artifact Manager is deployed separately from the URL Shortener.

### 1. Create D1 Database

```bash
wrangler d1 create artifact-manager
```

Copy the database ID to `artifacts-app/wrangler.toml`.

### 2. Configure wrangler.toml

```toml
name = "artifact-manager"
main = "worker.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "artifact-manager"
database_id = "YOUR-DATABASE-ID"
```

### 3. Deploy

Push changes to `artifacts-app/` directory - the workflow deploys automatically.

Or manually:
```bash
cd artifacts-app
wrangler deploy
```

---

## Usage

### Creating Artifacts

1. Click **New Artifact** button
2. Fill in details:
   - **Name** - Descriptive title
   - **Type** - code, html, document, etc.
   - **Source** - published or downloaded
   - **URL** - claude.site link (if published)
   - **Collection** - Folder to organize into
   - **Tags** - Comma-separated tags
   - **Notes** - Additional context
3. Click **Create**

### Managing Collections

Collections are like folders for organizing artifacts:

1. Click **Collections** in sidebar
2. Click **New Collection**
3. Choose name, color, and icon
4. Drag artifacts to collections or edit to assign

Default collections created on first visit:
- **Code Snippets** (blue)
- **Web Apps** (green)
- **Documents** (yellow)
- **Uncategorized** (gray)

### Using Tags

Tags provide flexible cross-cutting organization:

1. Add tags when creating/editing artifacts
2. Click tag pills to filter
3. Combine with collection filters
4. View tag usage counts in sidebar

### Search

- Press **Cmd+K** (or **Ctrl+K**) to open search
- Searches name, description, and notes
- Results update as you type

### Favorites

- Click the star icon on any artifact
- Filter to show favorites only
- Quick access to important artifacts

---

## API Reference

All endpoints require Cloudflare Access authentication.

### Artifacts

#### List Artifacts
```http
GET /api/artifacts
GET /api/artifacts?collection=code-snippets
GET /api/artifacts?tag=react
GET /api/artifacts?type=html
GET /api/artifacts?source=published
GET /api/artifacts?favorites=true
GET /api/artifacts?sort=newest
GET /api/artifacts?q=search-term
```

#### Create Artifact
```http
POST /api/artifacts
Content-Type: application/json

{
  "name": "React Component",
  "type": "code",
  "source": "downloaded",
  "url": "https://claude.site/artifacts/...",
  "collection_slug": "code-snippets",
  "tags": ["react", "component"],
  "description": "A reusable button component",
  "notes": "Created for the dashboard project",
  "language": "typescript",
  "model": "claude-3-opus",
  "conversation_url": "https://claude.ai/chat/...",
  "file_name": "Button.tsx",
  "file_size": 2048,
  "content": "export function Button() { ... }"
}
```

#### Get Artifact
```http
GET /api/artifacts/:id
```

#### Update Artifact
```http
PUT /api/artifacts/:id
Content-Type: application/json

{
  "name": "Updated Name",
  "tags": ["new-tag"],
  "notes": "Updated notes"
}
```

#### Delete Artifact
```http
DELETE /api/artifacts/:id
```

#### Toggle Favorite
```http
POST /api/artifacts/:id/favorite
```

### Collections

#### List Collections
```http
GET /api/collections
```

Response:
```json
[
  {
    "id": 1,
    "name": "Code Snippets",
    "slug": "code-snippets",
    "color": "blue",
    "icon": "code",
    "artifact_count": 25
  }
]
```

#### Create Collection
```http
POST /api/collections
Content-Type: application/json

{
  "name": "Web Apps",
  "slug": "web-apps",
  "color": "green",
  "icon": "globe"
}
```

Available colors: `blue`, `green`, `yellow`, `red`, `purple`, `pink`, `gray`

Available icons: `code`, `globe`, `file-text`, `image`, `database`, `folder`

#### Update Collection
```http
PUT /api/collections/:slug
Content-Type: application/json

{
  "name": "Updated Name",
  "color": "purple"
}
```

#### Delete Collection
```http
DELETE /api/collections/:slug
```

### Tags

#### List Tags
```http
GET /api/tags
```

Response:
```json
[
  {
    "id": 1,
    "name": "react",
    "usage_count": 12
  }
]
```

#### Delete Tag
```http
DELETE /api/tags/:name
```

### Statistics

```http
GET /api/stats
```

Response:
```json
{
  "total_artifacts": 150,
  "total_collections": 5,
  "total_tags": 30,
  "by_type": {
    "code": 80,
    "html": 40,
    "document": 20,
    "other": 10
  },
  "by_source": {
    "published": 60,
    "downloaded": 90
  }
}
```

### Import/Export

#### Export All Data
```http
GET /api/export
```

Response:
```json
{
  "version": 1,
  "exported_at": "2025-01-27T12:00:00.000Z",
  "artifacts": [...],
  "collections": [...],
  "tags": [...],
  "artifact_tags": [...]
}
```

#### Import Data
```http
POST /api/import
Content-Type: application/json

{
  "version": 1,
  "artifacts": [...],
  "collections": [...],
  "tags": [...],
  "artifact_tags": [...]
}
```

### Initialize Defaults

```http
POST /api/init
```

Creates default collections on first visit.

---

## Database Schema

### Collections Table

```sql
CREATE TABLE collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT DEFAULT 'gray',
  icon TEXT DEFAULT 'folder',
  user_email TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(slug, user_email)
);
```

### Artifacts Table

```sql
CREATE TABLE artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT,
  collection_id INTEGER,
  user_email TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  language TEXT,
  model TEXT,
  conversation_url TEXT,
  file_name TEXT,
  file_size INTEGER,
  content TEXT,
  is_favorite INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL
);

CREATE INDEX idx_artifacts_user ON artifacts(user_email);
CREATE INDEX idx_artifacts_collection ON artifacts(collection_id);
CREATE INDEX idx_artifacts_type ON artifacts(type);
CREATE INDEX idx_artifacts_favorite ON artifacts(is_favorite);
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

CREATE TABLE artifact_tags (
  artifact_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (artifact_id, tag_id),
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
```

---

## Security

All XSS vulnerabilities have been addressed:

- `escapeAttr()` - For JavaScript string contexts (onclick handlers)
- `escapeHtmlServer()` - For server-side HTML templating
- `escapeHtml()` - For client-side innerHTML operations

---

## CORS Configuration

The API includes CORS headers to allow the Chrome extension to make requests from claude.ai:

```javascript
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://claude.ai',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Cf-Access-Jwt-Assertion',
  'Access-Control-Allow-Credentials': 'true'
};
```

---

## Known Issues

1. **Logout button** - Email in sidebar footer needs logout functionality
2. **Import button** - Needs additional testing
3. **Default collections** - Auto-created via `/api/init` on first visit
