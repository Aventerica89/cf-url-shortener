# Chrome Extension

A Chrome extension that adds "Save to Artifact Manager" buttons on Claude.ai for one-click artifact saving.

---

## Overview

The extension integrates Claude.ai with your Artifact Manager:

- **Automatic Detection** - Finds artifacts on Claude.ai pages
- **One-Click Save** - Purple "Save" button on each artifact
- **Direct API** - Sends artifact data to your Artifact Manager
- **Status Feedback** - Shows "Saved!" confirmation

---

## Installation

### Step 1: Generate Icons

1. Open `chrome-extension/generate-icons.html` in your browser
2. Click each "Download" button (16px, 48px, 128px)
3. Save icons to `chrome-extension/icons/` folder

### Step 2: Load Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `chrome-extension/` folder
5. The extension icon should appear in your toolbar

### Step 3: Configure

1. Click the extension icon in toolbar
2. Enter your Artifact Manager URL (e.g., `https://artifact-manager.your-subdomain.workers.dev`)
3. Click **Save Settings**
4. Status should show "Connected"

---

## Usage

### Saving Artifacts

1. Go to any Claude.ai conversation with artifacts
2. Look for purple **Save** buttons on artifact cards
3. Click **Save** to send artifact to your Artifact Manager
4. Button changes to **Saved!** on success

### What Gets Saved

The extension captures:

| Field | Description |
|-------|-------------|
| Name | Artifact title from Claude |
| Type | code, html, document, etc. |
| Source | "published" (always) |
| URL | claude.site artifact URL |
| Conversation URL | Link to the chat |
| Content | Artifact content (if available) |

### Troubleshooting

**"Save" buttons don't appear:**
- Refresh the page
- Make sure you're on claude.ai
- Check extension is enabled in chrome://extensions

**"Failed to save" error:**
- Verify Artifact Manager URL in settings
- Make sure you're logged into Cloudflare Access
- Check browser console for CORS errors

**Extension not connecting:**
- Ensure Artifact Manager is deployed and running
- Check the URL doesn't have trailing slash
- Try the Artifact Manager URL directly in browser

---

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome MV3 extension configuration |
| `content.js` | Runs on Claude.ai, detects artifacts, adds buttons |
| `content.css` | Styles for save buttons |
| `background.js` | Service worker for API calls |
| `popup.html` | Extension popup UI |
| `popup.js` | Popup logic and settings |
| `generate-icons.html` | Tool to generate PNG icons |
| `icons/` | Extension icons (16px, 48px, 128px) |

---

## manifest.json

```json
{
  "manifest_version": 3,
  "name": "Artifact Manager - Save from Claude",
  "version": "1.0.0",
  "description": "Save Claude.ai artifacts to your Artifact Manager",

  "permissions": [
    "storage",
    "activeTab"
  ],

  "host_permissions": [
    "https://claude.ai/*",
    "https://*.workers.dev/*"
  ],

  "content_scripts": [
    {
      "matches": ["https://claude.ai/*"],
      "js": ["content.js"],
      "css": ["content.css"]
    }
  ],

  "background": {
    "service_worker": "background.js"
  },

  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  }
}
```

---

## How It Works

### Content Script (content.js)

1. **MutationObserver** watches for DOM changes
2. Detects artifact elements (cards, preview panels)
3. Extracts artifact metadata (title, type, URL)
4. Injects purple "Save" button
5. Button click sends message to background script

### Background Script (background.js)

1. Receives save requests from content script
2. Loads Artifact Manager URL from storage
3. Makes POST request to `/api/artifacts`
4. Includes Cloudflare Access credentials
5. Returns success/failure to content script

### Popup (popup.html/js)

1. Shows connection status
2. Allows setting Artifact Manager URL
3. Tests connection on save
4. Stores URL in Chrome sync storage

---

## CORS Requirements

The Artifact Manager must include these CORS headers:

```javascript
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://claude.ai',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Cf-Access-Jwt-Assertion',
  'Access-Control-Allow-Credentials': 'true'
};
```

The extension sends `credentials: 'include'` to pass Cloudflare Access cookies.

---

## Limitations

| Limitation | Description |
|------------|-------------|
| **Claude.ai UI changes** | Extension may need updates when Claude changes their UI |
| **Login required** | User must be logged into Cloudflare Access first |
| **Heuristic detection** | May miss some artifacts or detect false positives |
| **No bulk save** | Each artifact must be saved individually |

---

## Development

### Testing Changes

1. Edit files in `chrome-extension/`
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension
4. Reload Claude.ai page

### Debugging

1. Open Claude.ai
2. Open DevTools (F12)
3. Check Console for errors
4. Content script logs prefixed with `[Artifact Manager]`

### Inspecting Background Script

1. Go to `chrome://extensions/`
2. Click "Service Worker" link on extension
3. Opens DevTools for background script

---

## Security

- Only runs on `https://claude.ai`
- Only communicates with configured Artifact Manager URL
- No third-party data sharing
- Settings stored in Chrome sync storage
- Uses HTTPS for all API calls
