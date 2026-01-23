# Artifact Manager Chrome Extension

A Chrome extension that adds a "Save to Artifact Manager" button on Claude.ai, allowing you to quickly save artifacts to your personal Artifact Manager.

## Features

- **One-Click Save**: Adds a save button to every artifact on Claude.ai
- **Auto-Detection**: Automatically detects new artifacts as they appear in conversations
- **Quick Access**: Extension popup shows connection status and stats
- **Customizable**: Configure your Artifact Manager URL in settings

## Installation

### 1. Generate Icons

1. Open `generate-icons.html` in your browser
2. Click "Download All Icons"
3. Move the downloaded files to the `icons/` folder:
   - `icon16.png`
   - `icon48.png`
   - `icon128.png`

### 2. Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Select the `chrome-extension` folder
5. The extension icon should appear in your toolbar

### 3. Configure the Extension

1. Click the extension icon in your toolbar
2. Enter your Artifact Manager URL (e.g., `https://artifact-manager.jbmd-creations.workers.dev`)
3. Click "Save Settings"
4. Click "Open Artifact Manager" to log in via Cloudflare Access
5. Test the connection to verify it's working

## Usage

1. Go to [Claude.ai](https://claude.ai) and start a conversation
2. When Claude creates an artifact (code, HTML, etc.), you'll see a purple "Save" button
3. Click the button to save the artifact to your Artifact Manager
4. The button will show "Saved!" when successful

## How It Works

The extension:
1. **Content Script**: Monitors Claude.ai for artifacts and adds save buttons
2. **Background Script**: Handles API communication with your Artifact Manager
3. **Popup**: Provides settings and connection status

## Troubleshooting

### "Not authenticated" Error

1. Click "Open Artifact Manager" in the extension popup
2. Log in via Cloudflare Access
3. Come back to Claude.ai and try saving again

### "Connection failed" Error

1. Make sure your Artifact Manager URL is correct
2. Check that the Artifact Manager is deployed and accessible
3. Ensure CORS is enabled on your Artifact Manager (see below)

### No Save Button Appears

Claude.ai's UI changes frequently. If buttons don't appear:
1. Refresh the Claude.ai page
2. Try a different conversation with a new artifact
3. Check the browser console for errors

## CORS Configuration

For the extension to communicate with your Artifact Manager, you need to enable CORS. The Artifact Manager worker should include these headers for API responses:

```javascript
// Add to API responses in worker.js
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://claude.ai',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true'
};
```

## Development

### File Structure

```
chrome-extension/
├── manifest.json      # Extension configuration
├── content.js         # Runs on Claude.ai pages
├── content.css        # Styles for save buttons
├── background.js      # Service worker for API calls
├── popup.html         # Extension popup UI
├── popup.js           # Popup logic
├── icons/             # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── generate-icons.html # Icon generator tool
└── README.md          # This file
```

### Testing Changes

1. Make changes to the extension files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Reload Claude.ai to test

## Privacy

- This extension only runs on `claude.ai`
- It only communicates with your configured Artifact Manager URL
- No data is sent to any third parties
- All settings are stored locally in Chrome

## License

MIT License - See the main repository for details.
