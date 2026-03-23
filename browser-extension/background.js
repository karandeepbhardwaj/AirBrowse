/**
 * AirBrowse Background Service Worker
 *
 * WebSocket client connecting to the relay server at ws://localhost:8765.
 * Routes commands from the relay to content scripts and returns responses.
 */

const RELAY_URL = 'ws://localhost:8765';
const MAX_BACKOFF = 30000;

let ws = null;
let reconnectDelay = 1000;
let reconnectTimer = null;
let connected = false;

// ---------------------------------------------------------------------------
// Connection state helpers
// ---------------------------------------------------------------------------

function setConnectionState(state) {
  connected = state;
  chrome.storage.local.set({ connectionState: state ? 'connected' : 'disconnected' });
}

function setLastCommand(action) {
  chrome.storage.local.set({ lastCommand: action, lastCommandTime: Date.now() });
}

// ---------------------------------------------------------------------------
// WebSocket lifecycle
// ---------------------------------------------------------------------------

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  try {
    ws = new WebSocket(RELAY_URL);
  } catch (err) {
    console.error('[AirBrowse] WebSocket creation error:', err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[AirBrowse] Connected to relay');
    reconnectDelay = 1000;
    setConnectionState(true);

    // Register with the relay
    ws.send(JSON.stringify({
      type: 'register',
      from: 'browser',
      timestamp: Date.now()
    }));
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      console.error('[AirBrowse] Invalid JSON from relay:', err);
      return;
    }

    handleRelayMessage(msg);
  };

  ws.onerror = (err) => {
    console.error('[AirBrowse] WebSocket error:', err);
  };

  ws.onclose = () => {
    console.log('[AirBrowse] Disconnected from relay');
    setConnectionState(false);
    ws = null;
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  console.log(`[AirBrowse] Reconnecting in ${reconnectDelay}ms...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_BACKOFF);
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  setConnectionState(false);
}

// ---------------------------------------------------------------------------
// Send helper
// ---------------------------------------------------------------------------

function sendToRelay(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ ...msg, from: 'browser', timestamp: Date.now() }));
  } else {
    console.warn('[AirBrowse] Cannot send — not connected');
  }
}

// ---------------------------------------------------------------------------
// Command routing
// ---------------------------------------------------------------------------

async function handleRelayMessage(msg) {
  // Heartbeat / ping-pong
  if (msg.type === 'ping' || msg.type === 'heartbeat') {
    sendToRelay({ type: 'pong', id: msg.id });
    return;
  }

  // Only process command messages
  if (msg.type !== 'command') return;

  const { id, action, params } = msg;
  setLastCommand(action);

  try {
    // Commands handled directly in the background script
    if (action === 'page.screenshot') {
      const result = await handleScreenshot(params);
      sendToRelay({ type: 'response', id, result });
      return;
    }

    if (action === 'navigate.goto') {
      const result = await handleNavigate(params);
      sendToRelay({ type: 'response', id, result });
      return;
    }

    // Everything else goes to the content script on the active tab
    const tab = await getActiveTab();
    if (!tab) {
      sendToRelay({ type: 'response', id, error: 'No active tab found' });
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action, params, id });

    if (response && response.error) {
      sendToRelay({ type: 'response', id, error: response.error });
    } else {
      sendToRelay({ type: 'response', id, result: response ? response.result : null });
    }
  } catch (err) {
    sendToRelay({ type: 'response', id, error: err.message || String(err) });
  }
}

// ---------------------------------------------------------------------------
// Background-handled commands
// ---------------------------------------------------------------------------

async function handleScreenshot(params) {
  const tab = await getActiveTab();
  if (!tab) throw new Error('No active tab');

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: params?.format || 'png',
    quality: params?.quality || 80
  });

  return { dataUrl, url: tab.url, title: tab.title };
}

async function handleNavigate(params) {
  if (!params || !params.url) throw new Error('navigate.goto requires a url param');

  const tab = await getActiveTab();
  if (!tab) throw new Error('No active tab');

  await chrome.tabs.update(tab.id, { url: params.url });

  // Wait for navigation to complete
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Navigation timed out after 30s'));
    }, 30000);

    function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        // Small delay to let the page settle
        setTimeout(async () => {
          try {
            const updatedTab = await chrome.tabs.get(tab.id);
            resolve({ url: updatedTab.url, title: updatedTab.title });
          } catch (err) {
            resolve({ url: params.url });
          }
        }, 200);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// ---------------------------------------------------------------------------
// Listen for messages from content scripts and popup
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'reconnect') {
    disconnect();
    reconnectDelay = 1000;
    connect();
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'getStatus') {
    sendResponse({ connected });
    return;
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

connect();
