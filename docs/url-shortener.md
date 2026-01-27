# URL Shortener

A fast, multi-user URL shortener running on Cloudflare Workers with D1 database.

---

## Features

### Core Functionality

| Feature | Description |
|---------|-------------|
| **Fast Redirects** | Edge-deployed globally, <50ms latency |
| **Click Tracking** | Every click logged with full analytics |
| **Link Expiration** | Set expiration dates (returns 410 Gone) |
| **Password Protection** | Optional password with bcrypt hashing |
| **Rate Limiting** | Per-IP/user abuse prevention |

### Organization

| Feature | Description |
|---------|-------------|
| **Categories** | Color-coded folders (violet, pink, cyan, orange, green, gray) |
| **Tags** | Flexible many-to-many tagging |
| **Search** | Instant search with Cmd+K shortcut |
| **Sorting** | By newest, oldest, alphabetical, clicks |

### Analytics

| Feature | Description |
|---------|-------------|
| **Click Events** | Referrer, user agent, country, city |
| **Device Detection** | Mobile, desktop, tablet |
| **Browser Detection** | Chrome, Firefox, Safari, etc. |
| **Geographic Data** | Country and city from Cloudflare headers |

### Data Management

| Feature | Description |
|---------|-------------|
| **Export** | Download all data as JSON (v2 format) |
| **Import** | Restore from backup files |
| **Bulk Operations** | Bulk delete, bulk move to category |

---

## Admin Dashboard

Access your dashboard at `https://your-domain.com/admin`

### Creating Links

1. Click **New Link** button
2. Enter short code (e.g., `gh`)
3. Enter destination URL
4. Optionally select category and add tags
5. Optionally set expiration date or password
6. Click **Create**

Your link: `https://your-domain.com/gh` → redirects to destination

### Managing Categories

Categories help organize links by purpose:

- Click **Categories** in sidebar
- Create new categories with custom colors
- Drag links to categories or use bulk move
- Delete empty categories

### Using Tags

Tags provide flexible cross-cutting organization:

- Add tags when creating/editing links
- Filter links by clicking tag pills
- Combine category + tag filters
- View tag usage counts

### Search

- Press **Cmd+K** (or **Ctrl+K**) to open search
- Searches code, destination URL, and tags
- Results update as you type

---

## API Reference

All API endpoints require authentication via Cloudflare Access (except redirects).

### Links

#### List Links
```http
GET /api/links
GET /api/links?category=work
GET /api/links?tag=important
GET /api/links?sort=clicks
```

#### Create Link
```http
POST /api/links
Content-Type: application/json

{
  "code": "gh",
  "destination": "https://github.com/user/repo",
  "category_id": 1,
  "tags": ["dev", "important"],
  "description": "My GitHub profile",
  "expires_at": "2025-12-31T23:59:59Z",
  "password": "optional-password"
}
```

#### Update Link
```http
PUT /api/links/:code
Content-Type: application/json

{
  "destination": "https://new-url.com",
  "category_id": 2,
  "tags": ["updated"]
}
```

#### Delete Link
```http
DELETE /api/links/:code
```

#### Bulk Delete
```http
POST /api/links/bulk-delete
Content-Type: application/json

{
  "codes": ["link1", "link2", "link3"]
}
```

#### Bulk Move to Category
```http
POST /api/links/bulk-move
Content-Type: application/json

{
  "codes": ["link1", "link2"],
  "category_id": 3
}
```

### Categories

#### List Categories
```http
GET /api/categories
```

Response:
```json
[
  {
    "id": 1,
    "name": "Work",
    "slug": "work",
    "color": "violet",
    "link_count": 15
  }
]
```

#### Create Category
```http
POST /api/categories
Content-Type: application/json

{
  "name": "Work",
  "slug": "work",
  "color": "violet"
}
```

Available colors: `violet`, `pink`, `cyan`, `orange`, `green`, `gray`

#### Delete Category
```http
DELETE /api/categories/:slug
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
    "name": "important",
    "usage_count": 8
  }
]
```

### Search

```http
GET /api/search?q=github
```

Searches across code, destination URL, and tags.

### Statistics

```http
GET /api/stats
```

Response:
```json
{
  "total_links": 150,
  "total_clicks": 5420,
  "total_categories": 6,
  "total_tags": 25
}
```

### Analytics

#### Per-Link Analytics
```http
GET /api/analytics/:code
```

Response:
```json
{
  "total_clicks": 142,
  "countries": [
    {"country": "US", "count": 85},
    {"country": "GB", "count": 32}
  ],
  "devices": [
    {"device": "desktop", "count": 100},
    {"device": "mobile", "count": 42}
  ],
  "browsers": [
    {"browser": "Chrome", "count": 90},
    {"browser": "Safari", "count": 35}
  ],
  "recent_clicks": [...]
}
```

#### Overview Analytics
```http
GET /api/analytics/overview
```

### Import/Export

#### Export All Data
```http
GET /api/export
```

Response (v2 format):
```json
{
  "version": 2,
  "exported_at": "2025-01-27T12:00:00.000Z",
  "links": [...],
  "categories": [...],
  "tags": [...],
  "link_tags": [...]
}
```

#### Import Data
```http
POST /api/import
Content-Type: application/json

{
  "version": 2,
  "links": [...],
  "categories": [...],
  "tags": [...],
  "link_tags": [...]
}
```

### Public Redirect

```http
GET /:code
```

Returns 302 redirect to destination, or:
- 404 if link not found
- 410 if link expired
- Password prompt page if protected

---

## Database Schema

### Links Table

```sql
CREATE TABLE links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  destination TEXT NOT NULL,
  description TEXT,
  clicks INTEGER DEFAULT 0,
  user_email TEXT NOT NULL,
  category_id INTEGER,
  password_hash TEXT,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_links_user ON links(user_email);
CREATE INDEX idx_links_category ON links(category_id);
CREATE INDEX idx_links_code ON links(code);
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

### Click Events Table

```sql
CREATE TABLE click_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL,
  clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  referrer TEXT,
  user_agent TEXT,
  country TEXT,
  city TEXT,
  device_type TEXT,
  browser TEXT,
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);

CREATE INDEX idx_click_events_link ON click_events(link_id);
CREATE INDEX idx_click_events_time ON click_events(clicked_at);
```

### Rate Limits Table

```sql
CREATE TABLE rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  window_start DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(identifier, endpoint)
);
```

---

## Design System

Visit `/design-system` on your deployed instance to see the interactive UI component playground.

The UI uses Shadcn-style CSS variables with a dark theme:

```css
:root {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 10% 3.9%;
  --card-foreground: 0 0% 98%;
  --primary: 263 70% 50%;
  --primary-foreground: 0 0% 100%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --accent: 240 3.7% 15.9%;
  --border: 240 3.7% 15.9%;
  --ring: 263 70% 50%;
  --radius: 0.5rem;
}
```

---

## Mobile Mockup

Visit `/mobile-mockup` to see the mobile app design reference with a floating dev tools button for quick access to design resources.
