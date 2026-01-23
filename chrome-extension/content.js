// Artifact Manager Content Script for Claude.ai
// Detects artifacts and adds "Save to Artifact Manager" buttons

(function() {
  'use strict';

  // Configuration
  const BUTTON_CLASS = 'artifact-manager-save-btn';
  const PROCESSED_ATTR = 'data-artifact-manager-processed';

  // Debounce function
  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // Create save button element
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

  // Extract artifact data from an artifact element
  function extractArtifactData(artifactElement) {
    const data = {
      name: '',
      description: '',
      artifact_type: 'code',
      source_type: 'downloaded',
      file_content: '',
      language: '',
      conversation_url: window.location.href
    };

    // Try to find the artifact title/name
    // Claude.ai uses various selectors depending on the artifact type
    const titleSelectors = [
      '[data-testid="artifact-title"]',
      '.artifact-title',
      '[class*="artifact"] h1',
      '[class*="artifact"] h2',
      '[class*="artifact"] [class*="title"]',
      '[class*="ArtifactTitle"]'
    ];

    for (const selector of titleSelectors) {
      const titleEl = artifactElement.querySelector(selector);
      if (titleEl && titleEl.textContent.trim()) {
        data.name = titleEl.textContent.trim();
        break;
      }
    }

    // If no title found, try the artifact container's closest heading
    if (!data.name) {
      const parent = artifactElement.closest('[class*="message"]') || artifactElement.parentElement;
      if (parent) {
        const headings = parent.querySelectorAll('h1, h2, h3, strong');
        for (const h of headings) {
          const text = h.textContent.trim();
          if (text && text.length < 100) {
            data.name = text;
            break;
          }
        }
      }
    }

    // Fallback name
    if (!data.name) {
      data.name = 'Untitled Artifact';
    }

    // Try to get the artifact content
    const codeSelectors = [
      'pre code',
      'pre',
      '[class*="code"]',
      'code',
      '[class*="CodeBlock"]'
    ];

    for (const selector of codeSelectors) {
      const codeEl = artifactElement.querySelector(selector);
      if (codeEl && codeEl.textContent.trim()) {
        data.file_content = codeEl.textContent.trim();

        // Try to detect language from class
        const classes = codeEl.className || '';
        const langMatch = classes.match(/language-(\w+)/);
        if (langMatch) {
          data.language = langMatch[1];
        }
        break;
      }
    }

    // Detect artifact type based on content or language
    const content = data.file_content.toLowerCase();
    const lang = data.language.toLowerCase();

    if (lang === 'html' || content.includes('<!doctype html') || content.includes('<html')) {
      data.artifact_type = 'html';
    } else if (lang === 'svg' || content.startsWith('<svg')) {
      data.artifact_type = 'image';
    } else if (lang === 'json' || lang === 'csv') {
      data.artifact_type = 'data';
    } else if (lang === 'markdown' || lang === 'md' || lang === 'text') {
      data.artifact_type = 'document';
    } else {
      data.artifact_type = 'code';
    }

    // Try to get description from surrounding text
    const messageContainer = artifactElement.closest('[class*="message"]');
    if (messageContainer) {
      const paragraphs = messageContainer.querySelectorAll('p');
      for (const p of paragraphs) {
        const text = p.textContent.trim();
        if (text && text.length > 20 && text.length < 500) {
          data.description = text;
          break;
        }
      }
    }

    return data;
  }

  // Handle save button click
  async function handleSaveClick(event, artifactElement) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const originalContent = button.innerHTML;

    // Show loading state
    button.innerHTML = `
      <svg class="artifact-manager-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12a9 9 0 11-6.219-8.56"/>
      </svg>
      <span>Saving...</span>
    `;
    button.disabled = true;

    try {
      // Extract artifact data
      const artifactData = extractArtifactData(artifactElement);

      // Send to background script
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

        setTimeout(() => {
          button.innerHTML = originalContent;
          button.classList.remove('artifact-manager-success');
          button.disabled = false;
        }, 2000);
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

      // Show error notification
      showNotification(error.message || 'Failed to save artifact. Check extension settings.', 'error');

      setTimeout(() => {
        button.innerHTML = originalContent;
        button.classList.remove('artifact-manager-error');
        button.disabled = false;
      }, 3000);
    }
  }

  // Show notification toast
  function showNotification(message, type = 'info') {
    const existing = document.querySelector('.artifact-manager-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `artifact-manager-notification artifact-manager-notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 5000);
  }

  // Find and process artifacts
  function processArtifacts() {
    // Claude.ai artifact selectors - these may need updates as Claude.ai evolves
    const artifactSelectors = [
      '[data-testid="artifact-container"]',
      '[class*="artifact-container"]',
      '[class*="ArtifactContainer"]',
      '[class*="artifact"][class*="preview"]',
      '[class*="code-block"]',
      'pre:has(code)',
      '[class*="CodeBlock"]'
    ];

    const processedArtifacts = new Set();

    for (const selector of artifactSelectors) {
      try {
        const artifacts = document.querySelectorAll(selector);

        artifacts.forEach(artifact => {
          // Skip if already processed
          if (artifact.hasAttribute(PROCESSED_ATTR)) {
            return;
          }

          // Skip if it's a very small element (probably not a real artifact)
          if (artifact.offsetHeight < 50) {
            return;
          }

          // Skip if no meaningful content
          const content = artifact.textContent.trim();
          if (content.length < 10) {
            return;
          }

          // Mark as processed
          artifact.setAttribute(PROCESSED_ATTR, 'true');

          // Find or create button container
          let buttonContainer = artifact.querySelector('.artifact-manager-btn-container');
          if (!buttonContainer) {
            buttonContainer = document.createElement('div');
            buttonContainer.className = 'artifact-manager-btn-container';

            // Try to find a good place to insert the button
            // Look for existing action buttons/toolbar
            const toolbarSelectors = [
              '[class*="toolbar"]',
              '[class*="actions"]',
              '[class*="header"]',
              '[class*="top"]'
            ];

            let inserted = false;
            for (const tbSelector of toolbarSelectors) {
              const toolbar = artifact.querySelector(tbSelector);
              if (toolbar) {
                toolbar.appendChild(buttonContainer);
                inserted = true;
                break;
              }
            }

            if (!inserted) {
              // Insert at the top of the artifact
              artifact.style.position = 'relative';
              artifact.insertBefore(buttonContainer, artifact.firstChild);
            }
          }

          // Add save button if not already present
          if (!buttonContainer.querySelector(`.${BUTTON_CLASS}`)) {
            const saveButton = createSaveButton();
            saveButton.addEventListener('click', (e) => handleSaveClick(e, artifact));
            buttonContainer.appendChild(saveButton);
          }
        });
      } catch (e) {
        // Selector might not be valid, skip it
      }
    }
  }

  // Observe DOM changes to detect new artifacts
  function setupObserver() {
    const debouncedProcess = debounce(processArtifacts, 500);

    const observer = new MutationObserver((mutations) => {
      // Check if any mutations might have added new artifacts
      let shouldProcess = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldProcess = true;
          break;
        }
      }
      if (shouldProcess) {
        debouncedProcess();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return observer;
  }

  // Initialize
  function init() {
    // Wait for page to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        processArtifacts();
        setupObserver();
      });
    } else {
      processArtifacts();
      setupObserver();
    }

    // Also process on URL changes (SPA navigation)
    let lastUrl = location.href;
    new MutationObserver(() => {
      const url = location.href;
      if (url !== lastUrl) {
        lastUrl = url;
        setTimeout(processArtifacts, 1000);
      }
    }).observe(document, { subtree: true, childList: true });
  }

  init();
})();
