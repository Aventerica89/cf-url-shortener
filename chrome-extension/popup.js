// Artifact Manager Popup Script

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Load settings
  const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });

  // Populate form
  document.getElementById('api-url').value = settings.apiUrl || '';

  // Hide loading, show content
  document.getElementById('loading').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';

  // Test connection
  await testConnection();

  // Setup event listeners
  document.getElementById('test-btn').addEventListener('click', testConnection);
  document.getElementById('save-btn').addEventListener('click', saveSettings);
  document.getElementById('open-btn').addEventListener('click', openArtifactManager);
}

async function testConnection() {
  const testBtn = document.getElementById('test-btn');
  const statusCard = document.getElementById('status-card');
  const statusText = document.getElementById('status-text');
  const stats = document.getElementById('stats');

  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';
  statusText.textContent = 'Checking connection...';
  statusCard.className = 'status-card';
  stats.style.display = 'none';

  try {
    const result = await chrome.runtime.sendMessage({ action: 'testConnection' });

    if (result.success) {
      statusCard.className = 'status-card connected';
      statusText.textContent = 'Connected and authenticated';
      stats.style.display = 'grid';

      // Update stats
      document.getElementById('stat-total').textContent = result.stats.total_artifacts || 0;
      document.getElementById('stat-favorites').textContent = result.stats.favorites_count || 0;
      document.getElementById('stat-collections').textContent = result.stats.total_collections || 0;
    } else if (result.needsAuth) {
      statusCard.className = 'status-card disconnected';
      statusText.textContent = 'Not authenticated. Click "Open Artifact Manager" to log in.';
    } else {
      statusCard.className = 'status-card disconnected';
      statusText.textContent = `Connection failed: ${result.error}`;
    }
  } catch (error) {
    statusCard.className = 'status-card disconnected';
    statusText.textContent = `Error: ${error.message}`;
  }

  testBtn.disabled = false;
  testBtn.textContent = 'Test Connection';
}

async function saveSettings() {
  const saveBtn = document.getElementById('save-btn');
  const message = document.getElementById('message');

  const settings = {
    apiUrl: document.getElementById('api-url').value.trim()
  };

  if (!settings.apiUrl) {
    showMessage('Please enter the Artifact Manager URL', 'error');
    return;
  }

  // Validate URL
  try {
    new URL(settings.apiUrl);
  } catch {
    showMessage('Please enter a valid URL', 'error');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    await chrome.runtime.sendMessage({ action: 'saveSettings', settings });
    showMessage('Settings saved successfully!', 'success');

    // Test connection with new settings
    await testConnection();
  } catch (error) {
    showMessage(`Failed to save: ${error.message}`, 'error');
  }

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save Settings';
}

function openArtifactManager() {
  chrome.runtime.sendMessage({ action: 'openArtifactManager' });
}

function showMessage(text, type) {
  const message = document.getElementById('message');
  message.textContent = text;
  message.className = `message ${type}`;

  setTimeout(() => {
    message.className = 'message';
  }, 5000);
}
