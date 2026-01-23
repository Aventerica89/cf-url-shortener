// Artifact Manager Content Script for Claude.ai
// Detects artifacts and adds "Save to Artifact Manager" buttons

(function() {
  'use strict';

  const BUTTON_CLASS = 'artifact-manager-save-btn';
  const PROCESSED_ATTR = 'data-artifact-manager-processed';

  // Debounce helper
  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // Create save button
  function createSaveButton() {
    const button = document.createElement('button');
    button.className = BUTTON_CLASS;
    button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      <span>Save</span>
    `;
    button.title = 'Save to Artifact Manager';
    return button;
  }

  // Extract artifact data from the panel
  function extractArtifactData(panel) {
    const data = {
      name: 'Untitled Artifact',
      description: '',
      artifact_type: 'code',
      source_type: 'downloaded',
      file_content: '',
      language: '',
      conversation_url: window.location.href
    };

    // Find the artifact title - look for text content in the header area
    // The title appears as text like "Smith event options" with type "HTML" nearby
    const headerTexts = panel.querySelectorAll('div, span');
    for (const el of headerTexts) {
      const text = el.textContent.trim();
      // Skip very short or very long text, and skip known labels
      if (text.length > 2 && text.length < 100 &&
          !['Copy', 'HTML', 'Code', 'Preview', 'Download'].includes(text) &&
          !el.querySelector('*')) { // Only leaf text nodes
        data.name = text;
        break;
      }
    }

    // Detect artifact type from the panel
    const panelText = panel.textContent.toLowerCase();
    if (panelText.includes('html')) {
      data.artifact_type = 'html';
      data.language = 'HTML';
    } else if (panelText.includes('react') || panelText.includes('jsx')) {
      data.artifact_type = 'code';
      data.language = 'React';
    } else if (panelText.includes('python')) {
      data.artifact_type = 'code';
      data.language = 'Python';
    } else if (panelText.includes('javascript') || panelText.includes('typescript')) {
      data.artifact_type = 'code';
      data.language = 'JavaScript';
    }

    // Try to get content by clicking Copy button and reading clipboard
    // This is async and may not always work
    const copyBtn = panel.querySelector('button[aria-label*="Copy"], button:has(svg)');
    if (copyBtn) {
      data._copyButton = copyBtn; // Store reference for later
    }

    return data;
  }

  // Handle save button click
  async function handleSaveClick(event, panel) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const originalContent = button.innerHTML;

    // Show loading
    button.innerHTML = `
      <svg class="artifact-manager-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12a9 9 0 11-6.219-8.56"/>
      </svg>
      <span>Saving...</span>
    `;
    button.disabled = true;

    try {
      const artifactData = extractArtifactData(panel);

      // Try to get content from clipboard by clicking Copy
      if (artifactData._copyButton) {
        try {
          artifactData._copyButton.click();
          await new Promise(r => setTimeout(r, 100));
          const clipboardText = await navigator.clipboard.readText();
          if (clipboardText && clipboardText.length > 10) {
            artifactData.file_content = clipboardText;
          }
        } catch (e) {
          console.log('Could not read clipboard:', e);
        }
        delete artifactData._copyButton;
      }

      const response = await chrome.runtime.sendMessage({
        action: 'saveArtifact',
        data: artifactData
      });

      if (response.success) {
        button.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span>Saved!</span>
        `;
        button.classList.add('artifact-manager-success');
        showNotification('Artifact saved to Artifact Manager!', 'success');
      } else {
        throw new Error(response.error || 'Failed to save');
      }
    } catch (error) {
      console.error('Artifact Manager: Save failed', error);
      button.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <span>Error</span>
      `;
      button.classList.add('artifact-manager-error');
      showNotification(error.message || 'Failed to save artifact', 'error');
    }

    setTimeout(() => {
      button.innerHTML = originalContent;
      button.classList.remove('artifact-manager-success', 'artifact-manager-error');
      button.disabled = false;
    }, 2500);
  }

  // Show notification toast
  function showNotification(message, type = 'info') {
    const existing = document.querySelector('.artifact-manager-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `artifact-manager-notification artifact-manager-notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 4000);
  }

  // Find and process artifact panels
  function processArtifacts() {
    // Look for the artifact preview panel
    // Based on the DOM, it contains an iframe from claudeusercontent.com
    const iframes = document.querySelectorAll('iframe[src*="claudeusercontent.com"]');

    iframes.forEach(iframe => {
      // Find the panel container (go up to find the header)
      let panel = iframe.closest('div[class*="flex"]');

      // Walk up to find a suitable container with the title
      for (let i = 0; i < 10 && panel; i++) {
        if (panel.querySelector('button') && panel.offsetWidth > 200) {
          break;
        }
        panel = panel.parentElement;
      }

      if (!panel || panel.hasAttribute(PROCESSED_ATTR)) return;
      panel.setAttribute(PROCESSED_ATTR, 'true');

      // Find where to insert the button - look for the Copy button
      const copyButton = panel.querySelector('button');
      if (copyButton) {
        const buttonContainer = copyButton.parentElement;

        // Check if we already added our button
        if (buttonContainer && !buttonContainer.querySelector(`.${BUTTON_CLASS}`)) {
          const saveButton = createSaveButton();
          saveButton.addEventListener('click', (e) => handleSaveClick(e, panel));

          // Insert before the copy button
          buttonContainer.insertBefore(saveButton, copyButton);
        }
      }
    });

    // Also look for artifact mentions in the chat (the small preview cards)
    const artifactCards = document.querySelectorAll('[class*="artifact"], [data-testid*="artifact"]');
    artifactCards.forEach(card => {
      if (card.hasAttribute(PROCESSED_ATTR)) return;
      if (card.offsetHeight < 30 || card.offsetWidth < 100) return;

      card.setAttribute(PROCESSED_ATTR, 'true');

      // Add a subtle save indicator
      const existingBtn = card.querySelector(`.${BUTTON_CLASS}`);
      if (!existingBtn) {
        const saveButton = createSaveButton();
        saveButton.style.cssText = 'position: absolute; top: 4px; right: 4px; z-index: 100;';
        saveButton.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          // Extract basic info from the card
          const title = card.querySelector('[class*="title"], strong, b')?.textContent || 'Artifact';
          const type = card.textContent.includes('HTML') ? 'html' : 'code';

          handleSaveClick(e, card);
        });

        card.style.position = 'relative';
        card.appendChild(saveButton);
      }
    });
  }

  // Setup mutation observer
  function setupObserver() {
    const debouncedProcess = debounce(processArtifacts, 300);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          debouncedProcess();
          break;
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }

  // Initialize
  function init() {
    console.log('Artifact Manager: Initializing...');

    // Initial scan
    setTimeout(processArtifacts, 1000);

    // Watch for changes
    setupObserver();

    // Re-scan periodically (Claude.ai is very dynamic)
    setInterval(processArtifacts, 3000);

    console.log('Artifact Manager: Ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
