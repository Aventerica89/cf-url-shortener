# CF URL Shortener Documentation

A comprehensive URL shortener platform built on Cloudflare's edge network, featuring multi-user support, analytics, and a companion artifact manager for Claude.ai integration.

---

## Platform Overview

This project consists of three integrated components:

| Component | Description | Location |
|-----------|-------------|----------|
| [URL Shortener](url-shortener.md) | Fast edge-deployed link shortener with analytics | Root directory |
| [Artifact Manager](artifact-manager.md) | Track and organize Claude.ai artifacts | `artifacts-app/` |
| [Chrome Extension](chrome-extension.md) | One-click save artifacts from Claude.ai | `chrome-extension/` |

---

## Quick Links

- [Deployment Guide](deployment.md) - How the CI/CD pipeline works
- [URL Shortener API](url-shortener.md#api-reference) - REST API documentation
- [Artifact Manager API](artifact-manager.md#api-reference) - Artifact API documentation

---

## Technology Stack

```
┌─────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                       │
├─────────────────────────────────────────────────────────┤
│  Workers (Serverless)  │  D1 (SQLite)  │  Access (Auth) │
├─────────────────────────────────────────────────────────┤
│                   GitHub Actions CI/CD                   │
└─────────────────────────────────────────────────────────┘
```

- **Cloudflare Workers** - Serverless compute at the edge (<50ms latency globally)
- **Cloudflare D1** - SQLite database with automatic replication
- **Cloudflare Access** - Zero-trust authentication (Google, GitHub, Email OTP)
- **GitHub Actions** - Automatic deployment on every push to main

---

## Features at a Glance

### URL Shortener
- Fast redirects on Cloudflare's global edge network
- Click tracking with detailed analytics (country, device, browser)
- Categories and tags for organization
- Password-protected links with expiration dates
- Multi-user data isolation
- Import/Export for backup

### Artifact Manager
- Track published artifacts (claude.site URLs)
- Track downloaded artifacts with file content storage
- Collections (folders) with custom colors and icons
- Tagging system for cross-cutting organization
- Favorites and search
- Full export/import capability

### Chrome Extension
- One-click save button on Claude.ai artifact cards
- Automatic artifact detection
- Direct integration with Artifact Manager API
- Settings popup for configuration

---

## Cost

Everything runs on **Cloudflare's free tier**:

| Resource | Free Limit |
|----------|------------|
| Workers | 100,000 requests/day |
| D1 Database | 5GB storage |
| Access | 50 users |

No credit card required. No surprise bills.

---

## Getting Started

1. **Fork the repository** to your GitHub account
2. **Set up Cloudflare** - Create D1 database and API token
3. **Configure GitHub Secrets** - Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
4. **Push to main** - Automatic deployment via GitHub Actions

See [Deployment Guide](deployment.md) for detailed instructions.

---

## Project Structure

```
cf-url-shortener/
├── worker-multiuser.js       # URL Shortener worker (3,900+ lines)
├── migrations.sql            # D1 schema migrations
├── wrangler.toml             # Cloudflare config
├── design-system.html        # UI component playground
│
├── artifacts-app/
│   ├── worker.js             # Artifact Manager worker (3,100+ lines)
│   ├── migrations.sql        # Artifact schema
│   └── wrangler.toml         # Separate worker config
│
├── chrome-extension/
│   ├── manifest.json         # Chrome MV3 extension
│   ├── content.js            # Claude.ai integration
│   └── popup.html            # Extension popup
│
├── .github/workflows/
│   ├── deploy.yml            # URL Shortener CI/CD
│   └── deploy-artifacts.yml  # Artifact Manager CI/CD
│
└── docs/                     # This documentation
```

---

## Documentation

- [URL Shortener](url-shortener.md) - Features, API, database schema
- [Artifact Manager](artifact-manager.md) - Features, API, collections
- [Chrome Extension](chrome-extension.md) - Installation and usage
- [Deployment](deployment.md) - CI/CD pipeline and infrastructure

---

## License

GPL-3.0 - See [LICENSE](../LICENSE) for details.
