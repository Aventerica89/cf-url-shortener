// Artifact Manager Background Script
// Handles API communication with the Artifact Manager

// Default settings
const DEFAULT_SETTINGS = {
  apiUrl: 'https://artifact-manager.jbmd-creations.workers.dev',
  defaultCollection: '',
  autoDetect: true
};

// Get settings from storage
async function getSettings() {
  const result = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return result;
}

// Save settings to storage
async function saveSettings(settings) {
  await chrome.storage.sync.set(settings);
}

// Save artifact to Artifact Manager
async function saveArtifact(data) {
  const settings = await getSettings();
  const apiUrl = settings.apiUrl.replace(/\/$/, '');

  // Add default collection if set
  if (settings.defaultCollection && !data.collection_id) {
    data.collection_id = settings.defaultCollection;
  }

  try {
    const response = await fetch(`${apiUrl}/api/artifacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify(data)
    });

    if (response.status === 401) {
      // User needs to authenticate
      throw new Error('Not authenticated. Please log in to Artifact Manager first.');
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    return { success: true, id: result.id };
  } catch (error) {
    console.error('Artifact Manager: API error', error);

    // Check if it's a CORS error
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('Connection failed. Make sure you are logged into Artifact Manager and CORS is enabled.');
    }

    throw error;
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveArtifact') {
    saveArtifact(request.data)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));

    // Return true to indicate we'll respond asynchronously
    return true;
  }

  if (request.action === 'getSettings') {
    getSettings()
      .then(settings => sendResponse(settings))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'saveSettings') {
    saveSettings(request.settings)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'openArtifactManager') {
    getSettings().then(settings => {
      chrome.tabs.create({ url: settings.apiUrl });
    });
    return false;
  }

  if (request.action === 'testConnection') {
    testConnection()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Test connection to Artifact Manager
async function testConnection() {
  const settings = await getSettings();
  const apiUrl = settings.apiUrl.replace(/\/$/, '');

  try {
    const response = await fetch(`${apiUrl}/api/stats`, {
      method: 'GET',
      credentials: 'include'
    });

    if (response.status === 401) {
      return { success: false, error: 'Not authenticated', needsAuth: true };
    }

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const stats = await response.json();
    return { success: true, stats };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Handle extension icon click - open popup
chrome.action.onClicked.addListener((tab) => {
  // Popup is handled by manifest, this is a fallback
});

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await saveSettings(DEFAULT_SETTINGS);
    console.log('Artifact Manager: Extension installed with default settings');
  }
});
