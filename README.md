# Cloudflare URL Shortener

A fast, free URL shortener that runs on Cloudflare's edge network. Multi-user support, categories, tags, search, and a clean dark UI.

## Quick Start (with Claude Code)

The fastest way to deploy your own instance:

1. **Fork this repo** to your GitHub account

2. **Open Claude Code** and run:
   ```
   claude "Help me deploy cf-url-shortener to my Cloudflare account"
   ```

3. **Follow Claude's prompts** - it will:
   - Create your D1 database
   - Set up your custom domain
   - Configure GitHub secrets
   - Deploy everything automatically

That's it. Claude handles all the Cloudflare configuration.

---

## What You'll Need

- **Cloudflare account** (free) - [Sign up](https://dash.cloudflare.com/sign-up)
- **GitHub account** (free) - For the repo and Actions
- **A domain on Cloudflare** - For your custom short link domain (e.g., `links.yourdomain.com`)

---

## Features

| Feature | Description |
|---------|-------------|
| **Fast redirects** | Runs on Cloudflare's global edge network |
| **Multi-user** | Each user has private links (via Cloudflare Access) |
| **Categories** | Organize links by category with color coding |
| **Tags** | Flexible tagging system |
| **Search** | Instant search with Cmd+K shortcut |
| **Click tracking** | See how many times each link was clicked |
| **Import/Export** | Backup and restore your links as JSON |
| **Dark theme** | Clean Shadcn-style UI |
| **Auto-deploy** | Push to main = instant deployment |
| **Free** | Runs entirely on Cloudflare's free tier |

---

## How It Works

```
User clicks: links.example.com/gh
         ↓
Cloudflare Worker (edge, <50ms)
         ↓
D1 Database lookup
         ↓
302 Redirect → github.com/user/repo
```

**Stack:**
- Cloudflare Workers (serverless compute)
- Cloudflare D1 (SQLite database)
- Cloudflare Access (authentication)
- GitHub Actions (CI/CD)

---

## After Deployment

### Admin Dashboard
Visit `https://your-domain.com/admin` to:
- Create, edit, delete links
- Organize with categories and tags
- Search your links
- View click statistics
- Export/import data

### Creating Links
Your links work like: `https://links.example.com/shortcode` → redirects to destination

### API
Full REST API available at `/api/*` - see [MANUAL.md](MANUAL.md) for endpoints.

---

## Costs

Everything runs on **Cloudflare's free tier**:

| Resource | Free Limit |
|----------|------------|
| Workers | 100,000 requests/day |
| D1 Database | 5GB storage |
| Access | 50 users |

No credit card required. No surprise bills.

---

## Manual Setup

Prefer to set things up yourself? See **[MANUAL.md](MANUAL.md)** for:
- Step-by-step Cloudflare configuration
- GitHub Actions setup
- API documentation
- Database schema
- Troubleshooting

---

## License

MIT - Use it however you want.
