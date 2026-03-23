/**
 * AirBrowse WebSocket Relay Server (compiled JS version)
 *
 * This is the plain JavaScript version of src/relay/server.ts, intended to be
 * forked directly as a child process without requiring TypeScript compilation.
 *
 * It sits between the VS Code extension and the Chrome extension, routing
 * commands from VS Code to the browser and responses back.
 *
 * Usage:
 *   node relay/server.js --port 8765
 *   # Or spawned via child_process.fork() from the VS Code extension
 */

'use strict';

const { WebSocketServer, WebSocket } = require('ws');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 10000;  // 10 seconds grace period (unused directly; checked each interval)
const COMMAND_TIMEOUT = 60000;    // 60 seconds per command
const DEFAULT_PORT = 8765;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(message) {
  const ts = new Date().toISOString();
  console.log(`[Relay] [${ts}] ${message}`);
}

function logError(message, err) {
  const detail = err instanceof Error ? err.message : String(err ?? '');
  const ts = new Date().toISOString();
  console.error(`[Relay] [${ts}] ERROR: ${message} ${detail}`);
}

// ---------------------------------------------------------------------------
// RelayServer
// ---------------------------------------------------------------------------

class RelayServer {
  constructor(port) {
    this.port = port || DEFAULT_PORT;

    /** @type {import('ws').WebSocketServer | null} */
    this.wss = null;
    /** @type {import('ws').WebSocket | null} */
    this.vsCodeSocket = null;
    /** @type {import('ws').WebSocket | null} */
    this.browserSocket = null;

    /** @type {ReturnType<typeof setInterval> | null} */
    this.heartbeatTimer = null;

    /** Map<WebSocket, boolean> — tracks pong responses for heartbeat */
    this.aliveSockets = new Map();

    // Sequential command queue
    /** @type {Array<{message: object, resolve: function, timer: *, source: string}>} */
    this.commandQueue = [];
    /** @type {{message: object, resolve: function, timer: *, source: string} | null} */
    this.activeCommand = null;

    this.isShuttingDown = false;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Start the WebSocket server. Returns a Promise that resolves once listening. */
  start() {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ host: 'localhost', port: this.port }, () => {
        log(`WebSocket server listening on ws://localhost:${this.port}`);
        this._setupIPC();
        this._startHeartbeat();
        resolve();
      });

      this.wss.on('error', (err) => {
        logError('WebSocket server error', err);
        reject(err);
      });

      this.wss.on('connection', (ws, req) => {
        this._handleConnection(ws, req);
      });
    });
  }

  /** Gracefully shut down the server. */
  stop() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    log('Shutting down relay server...');

    // Clear heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Reject any pending commands
    this._rejectPendingCommands('Relay server shutting down');

    // Close client connections
    if (this.vsCodeSocket) {
      this.vsCodeSocket.close(1001, 'Server shutting down');
      this.vsCodeSocket = null;
    }
    if (this.browserSocket) {
      this.browserSocket.close(1001, 'Server shutting down');
      this.browserSocket = null;
    }

    // Close server
    if (this.wss) {
      this.wss.close(() => {
        log('WebSocket server closed');
      });
      this.wss = null;
    }
  }

  // -----------------------------------------------------------------------
  // IPC with parent process (fork mode)
  // -----------------------------------------------------------------------

  _setupIPC() {
    if (typeof process.send !== 'function') {
      return; // Not running as a forked child
    }

    log('IPC channel detected, listening for parent process messages');

    process.on('message', (raw) => {
      try {
        const msg = raw;
        if (!msg || typeof msg !== 'object') return;

        // Treat IPC messages as coming from 'vscode'
        msg.from = 'vscode';
        msg.timestamp = msg.timestamp ?? Date.now();

        this._handleVSCodeMessage(msg, 'ipc');
      } catch (err) {
        logError('Failed to handle IPC message', err);
      }
    });

    // Notify parent that the server is ready
    process.send({ type: 'ready', port: this.port });
  }

  _sendToParent(msg) {
    if (typeof process.send === 'function') {
      process.send(msg);
    }
  }

  // -----------------------------------------------------------------------
  // Connection handling
  // -----------------------------------------------------------------------

  _handleConnection(ws, req) {
    const addr = (req.socket && req.socket.remoteAddress) || 'unknown';
    log(`New connection from ${addr}`);

    // Mark alive for heartbeat
    this.aliveSockets.set(ws, true);

    ws.on('pong', () => {
      this.aliveSockets.set(ws, true);
    });

    ws.on('message', (data) => {
      this._handleRawMessage(ws, data);
    });

    ws.on('close', (code, reason) => {
      this._handleDisconnect(ws, code, reason.toString());
    });

    ws.on('error', (err) => {
      logError('Client socket error', err);
    });
  }

  _handleRawMessage(ws, data) {
    let msg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
    } catch (_) {
      logError('Failed to parse message', data.toString().slice(0, 200));
      return;
    }

    msg.timestamp = msg.timestamp ?? Date.now();

    // Handle registration
    if (msg.type === 'register') {
      this._registerClient(ws, msg);
      return;
    }

    // Handle heartbeat response
    if (msg.type === 'heartbeat') {
      this.aliveSockets.set(ws, true);
      return;
    }

    // Route based on sender
    if (ws === this.vsCodeSocket) {
      this._handleVSCodeMessage(msg, 'ws');
    } else if (ws === this.browserSocket) {
      this._handleBrowserMessage(msg);
    } else {
      log(`Message from unregistered client, ignoring: ${msg.action}`);
    }
  }

  _registerClient(ws, msg) {
    const clientType = msg.from;

    if (clientType === 'vscode') {
      if (this.vsCodeSocket && this.vsCodeSocket !== ws) {
        log('Replacing existing VS Code client');
        this.vsCodeSocket.close(1000, 'Replaced by new connection');
      }
      this.vsCodeSocket = ws;
      log('VS Code client registered');
    } else if (clientType === 'browser') {
      if (this.browserSocket && this.browserSocket !== ws) {
        log('Replacing existing browser client');
        this.browserSocket.close(1000, 'Replaced by new connection');
      }
      this.browserSocket = ws;
      log('Browser client registered');
    } else {
      log(`Unknown client type: ${clientType}`);
      return;
    }

    // Acknowledge registration
    const ack = {
      id: msg.id,
      type: 'response',
      from: 'vscode',
      action: 'register',
      result: { status: 'registered', clientType },
      error: null,
      timestamp: Date.now(),
    };
    this._sendToSocket(ws, ack);

    // Notify the other side about the connection
    if (clientType === 'browser') {
      // Tell VS Code that a browser connected
      const event = {
        id: 'evt-' + Date.now(),
        type: 'event',
        from: 'browser',
        action: 'browser.connected',
        result: { status: 'connected' },
        timestamp: Date.now(),
      };
      if (this.vsCodeSocket) {
        this._sendToSocket(this.vsCodeSocket, event);
      }
      this._sendToParent(event);
    } else if (clientType === 'vscode') {
      // If browser is already connected, notify VS Code immediately
      if (this.browserSocket) {
        const event = {
          id: 'evt-' + Date.now(),
          type: 'event',
          from: 'browser',
          action: 'browser.connected',
          result: { status: 'connected' },
          timestamp: Date.now(),
        };
        this._sendToSocket(ws, event);
        this._sendToParent(event);
      }
    }
  }

  _handleDisconnect(ws, code, reason) {
    this.aliveSockets.delete(ws);

    if (ws === this.vsCodeSocket) {
      log(`VS Code client disconnected (code=${code}, reason=${reason})`);
      this.vsCodeSocket = null;
    } else if (ws === this.browserSocket) {
      log(`Browser client disconnected (code=${code}, reason=${reason})`);
      this.browserSocket = null;
      // Notify VS Code that browser disconnected
      const event = {
        id: 'evt-' + Date.now(),
        type: 'event',
        from: 'browser',
        action: 'browser.disconnected',
        result: { status: 'disconnected' },
        timestamp: Date.now(),
      };
      if (this.vsCodeSocket) {
        this._sendToSocket(this.vsCodeSocket, event);
      }
      this._sendToParent(event);
      // Reject any pending/active commands that were waiting for the browser
      this._rejectPendingCommands('Browser client disconnected');
    } else {
      log(`Unknown client disconnected (code=${code})`);
    }
  }

  // -----------------------------------------------------------------------
  // Message routing
  // -----------------------------------------------------------------------

  /** Handle a command originating from VS Code (WebSocket or IPC). */
  _handleVSCodeMessage(msg, source) {
    if (msg.type === 'command') {
      this._enqueueCommand(msg, source);
    } else if (msg.type === 'event') {
      // Forward events directly to browser
      if (this.browserSocket) {
        this._sendToSocket(this.browserSocket, msg);
      }
    }
  }

  /** Handle a message from the browser client. */
  _handleBrowserMessage(msg) {
    if (msg.type === 'response') {
      this._resolveActiveCommand(msg);
    } else if (msg.type === 'event') {
      // Forward browser events to VS Code
      if (this.vsCodeSocket) {
        this._sendToSocket(this.vsCodeSocket, msg);
      }
      // Also relay via IPC if available
      this._sendToParent(msg);
    }
  }

  // -----------------------------------------------------------------------
  // Sequential command queue
  // -----------------------------------------------------------------------

  _enqueueCommand(msg, source) {
    if (!this.browserSocket) {
      const errorResponse = {
        id: msg.id,
        type: 'response',
        from: 'browser',
        action: msg.action,
        error: 'No browser client connected',
        timestamp: Date.now(),
      };
      this._sendResponse(errorResponse, source);
      return;
    }

    const pending = {
      message: msg,
      resolve: (response) => {
        this._sendResponse(response, source);
      },
      timer: setTimeout(() => {
        this._timeoutCommand(msg.id);
      }, COMMAND_TIMEOUT),
      source,
    };

    this.commandQueue.push(pending);
    log(`Command queued: ${msg.action} (id=${msg.id}, queue=${this.commandQueue.length})`);

    // If nothing is actively executing, start processing
    if (!this.activeCommand) {
      this._processNextCommand();
    }
  }

  _processNextCommand() {
    if (this.commandQueue.length === 0) {
      this.activeCommand = null;
      return;
    }

    const pending = this.commandQueue.shift();
    this.activeCommand = pending;

    if (!this.browserSocket) {
      clearTimeout(pending.timer);
      const errorResponse = {
        id: pending.message.id,
        type: 'response',
        from: 'browser',
        action: pending.message.action,
        error: 'No browser client connected',
        timestamp: Date.now(),
      };
      pending.resolve(errorResponse);
      this._processNextCommand();
      return;
    }

    log(`Executing command: ${pending.message.action} (id=${pending.message.id})`);
    this._sendToSocket(this.browserSocket, pending.message);
  }

  _resolveActiveCommand(response) {
    if (!this.activeCommand) {
      log(`Received response with no active command (id=${response.id})`);
      return;
    }

    if (this.activeCommand.message.id !== response.id) {
      log(`Response id mismatch: expected=${this.activeCommand.message.id}, got=${response.id}`);
      return;
    }

    clearTimeout(this.activeCommand.timer);
    log(`Command completed: ${this.activeCommand.message.action} (id=${response.id})`);
    this.activeCommand.resolve(response);
    this.activeCommand = null;

    // Process next in queue
    this._processNextCommand();
  }

  _timeoutCommand(id) {
    if (this.activeCommand && this.activeCommand.message.id === id) {
      log(`Command timed out: ${this.activeCommand.message.action} (id=${id})`);
      const errorResponse = {
        id,
        type: 'response',
        from: 'browser',
        action: this.activeCommand.message.action,
        error: 'Command timed out',
        timestamp: Date.now(),
      };
      this.activeCommand.resolve(errorResponse);
      this.activeCommand = null;
      this._processNextCommand();
    } else {
      // Command is still in the queue
      const idx = this.commandQueue.findIndex((p) => p.message.id === id);
      if (idx !== -1) {
        const pending = this.commandQueue.splice(idx, 1)[0];
        log(`Queued command timed out: ${pending.message.action} (id=${id})`);
        const errorResponse = {
          id,
          type: 'response',
          from: 'browser',
          action: pending.message.action,
          error: 'Command timed out while queued',
          timestamp: Date.now(),
        };
        pending.resolve(errorResponse);
      }
    }
  }

  _rejectPendingCommands(reason) {
    // Reject active command
    if (this.activeCommand) {
      clearTimeout(this.activeCommand.timer);
      const errorResponse = {
        id: this.activeCommand.message.id,
        type: 'response',
        from: 'browser',
        action: this.activeCommand.message.action,
        error: reason,
        timestamp: Date.now(),
      };
      this.activeCommand.resolve(errorResponse);
      this.activeCommand = null;
    }

    // Reject all queued commands
    for (const pending of this.commandQueue) {
      clearTimeout(pending.timer);
      const errorResponse = {
        id: pending.message.id,
        type: 'response',
        from: 'browser',
        action: pending.message.action,
        error: reason,
        timestamp: Date.now(),
      };
      pending.resolve(errorResponse);
    }
    this.commandQueue = [];
  }

  // -----------------------------------------------------------------------
  // Transport helpers
  // -----------------------------------------------------------------------

  _sendResponse(msg, source) {
    if (source === 'ipc') {
      this._sendToParent(msg);
    } else if (this.vsCodeSocket) {
      this._sendToSocket(this.vsCodeSocket, msg);
    }
  }

  _sendToSocket(ws, msg) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // -----------------------------------------------------------------------
  // Heartbeat
  // -----------------------------------------------------------------------

  _startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (!this.wss) return;

      const heartbeatMsg = {
        id: `hb-${Date.now()}`,
        type: 'heartbeat',
        from: 'vscode',
        action: 'ping',
        timestamp: Date.now(),
      };

      this.wss.clients.forEach((ws) => {
        if (this.aliveSockets.get(ws) === false) {
          // Did not respond to previous heartbeat
          log('Terminating unresponsive client');
          ws.terminate();
          return;
        }

        // Mark as pending, wait for pong
        this.aliveSockets.set(ws, false);
        this._sendToSocket(ws, heartbeatMsg);
        ws.ping();
      });
    }, HEARTBEAT_INTERVAL);
  }

  // -----------------------------------------------------------------------
  // Status accessors
  // -----------------------------------------------------------------------

  get isVSCodeConnected() {
    return this.vsCodeSocket !== null && this.vsCodeSocket.readyState === WebSocket.OPEN;
  }

  get isBrowserConnected() {
    return this.browserSocket !== null && this.browserSocket.readyState === WebSocket.OPEN;
  }

  get queueLength() {
    return this.commandQueue.length + (this.activeCommand ? 1 : 0);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parsePort(args) {
  const idx = args.indexOf('--port');
  if (idx !== -1 && idx + 1 < args.length) {
    const port = parseInt(args[idx + 1], 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      return port;
    }
  }
  return DEFAULT_PORT;
}

if (require.main === module || process.argv.includes('--standalone')) {
  const port = parsePort(process.argv);
  const server = new RelayServer(port);

  const shutdown = () => {
    server.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.start().catch((err) => {
    logError('Failed to start relay server', err);
    process.exit(1);
  });
}

module.exports = { RelayServer };
