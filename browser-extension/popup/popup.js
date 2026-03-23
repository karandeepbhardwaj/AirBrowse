/**
 * AirBrowse Popup Script
 */

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const currentUrl = document.getElementById('currentUrl');
const lastCommand = document.getElementById('lastCommand');
const reconnectBtn = document.getElementById('reconnectBtn');

// Update connection status
function updateStatus() {
  chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Disconnected';
      return;
    }

    if (response.connected) {
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected to relay';
    } else {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Disconnected';
    }
  });
}

// Update current page URL
function updateCurrentPage() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      currentUrl.textContent = tabs[0].url || '—';
    }
  });
}

// Update last command from storage
function updateLastCommand() {
  chrome.storage.local.get(['lastCommand', 'lastCommandTime'], (data) => {
    if (data.lastCommand) {
      const ago = data.lastCommandTime
        ? ` (${formatTimeAgo(data.lastCommandTime)})`
        : '';
      lastCommand.textContent = data.lastCommand + ago;
    }
  });
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// Reconnect button
reconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'reconnect' }, () => {
    statusText.textContent = 'Reconnecting...';
    setTimeout(updateStatus, 1500);
  });
});

// Initial load
updateStatus();
updateCurrentPage();
updateLastCommand();
