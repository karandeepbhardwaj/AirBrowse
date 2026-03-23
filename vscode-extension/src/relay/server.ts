/**
 * AirBrowse WebSocket Relay Server
 *
 * Sits between the VS Code extension and the Chrome extension, routing
 * commands from VS Code to the browser and responses back. Can run as:
 *   1. A child process spawned via child_process.fork() (IPC mode)
 *   2. A standalone WebSocket server (CLI mode)
 */

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClientType = 'vscode' | 'browser';
export type MessageType = 'command' | 'response' | 'event' | 'register' | 'heartbeat';

export interface RelayMessage {
  id: string;
  type: MessageType;
  from: ClientType;
  action: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: string | null;
  timestamp?: number;
}

interface PendingCommand {
  message: RelayMessage;
  resolve: (response: RelayMessage) => void;
  timer: ReturnType<typeof setTimeout>;
  source: 'ws' | 'ipc';
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(message: string): void {
  const ts = new Date().toISOString();
  console.log(`[Relay] [${ts}] ${message}`);
}

function logError(message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : String(err ?? '');
  const ts = new Date().toISOString();
  console.error(`[Relay] [${ts}] ERROR: ${message} ${detail}`);
}

// ---------------------------------------------------------------------------
// Relay Server
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const HEARTBEAT_TIMEOUT = 10_000;  // 10 seconds grace period
const COMMAND_TIMEOUT = 60_000;    // 60 seconds per command

export class RelayServer {
  private wss: WebSocketServer | null = null;
  private vsCodeSocket: WebSocket | null = null;
  private browserSocket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private aliveSockets = new Map<WebSocket, boolean>();

  // Sequential command queue
  private commandQueue: PendingCommand[] = [];
  private activeCommand: PendingCommand | null = null;

  private port: number;
  private isShuttingDown = false;

  constructor(port: number = 8765) {
    this.port = port;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ host: 'localhost', port: this.port }, () => {
        log(`WebSocket server listening on ws://localhost:${this.port}`);
        this.setupIPC();
        this.startHeartbeat();
        resolve();
      });

      this.wss.on('error', (err: Error) => {
        logError('WebSocket server error', err);
        reject(err);
      });

      this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        this.handleConnection(ws, req);
      });
    });
  }

  stop(): void {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    log('Shutting down relay server...');

    // Clear heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Reject any pending commands
    this.rejectPendingCommands('Relay server shutting down');

    // Close all client connections
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

  private setupIPC(): void {
    if (typeof process.send !== 'function') {
      return; // Not running as a forked child
    }

    log('IPC channel detected, listening for parent process messages');

    process.on('message', (raw: unknown) => {
      try {
        const msg = raw as RelayMessage;
        if (!msg || typeof msg !== 'object') return;

        // Treat IPC messages as if they came from 'vscode'
        msg.from = 'vscode';
        msg.timestamp = msg.timestamp ?? Date.now();

        this.handleVSCodeMessage(msg, 'ipc');
      } catch (err) {
        logError('Failed to handle IPC message', err);
      }
    });

    // Notify parent that we're ready
    process.send({ type: 'ready', port: this.port });
  }

  private sendToParent(msg: RelayMessage): void {
    if (typeof process.send === 'function') {
      process.send(msg);
    }
  }

  // -----------------------------------------------------------------------
  // Connection handling
  // -----------------------------------------------------------------------

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const addr = req.socket.remoteAddress ?? 'unknown';
    log(`New connection from ${addr}`);

    // Mark alive for heartbeat
    this.aliveSockets.set(ws, true);

    ws.on('pong', () => {
      this.aliveSockets.set(ws, true);
    });

    ws.on('message', (data: Buffer | string) => {
      this.handleRawMessage(ws, data);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.handleDisconnect(ws, code, reason.toString());
    });

    ws.on('error', (err: Error) => {
      logError('Client socket error', err);
    });
  }

  private handleRawMessage(ws: WebSocket, data: Buffer | string): void {
    let msg: RelayMessage;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8'));
    } catch {
      logError('Failed to parse message', data.toString().slice(0, 200));
      return;
    }

    msg.timestamp = msg.timestamp ?? Date.now();

    // Handle registration
    if (msg.type === 'register') {
      this.registerClient(ws, msg);
      return;
    }

    // Handle heartbeat response
    if (msg.type === 'heartbeat') {
      this.aliveSockets.set(ws, true);
      return;
    }

    // Route based on sender
    if (ws === this.vsCodeSocket) {
      this.handleVSCodeMessage(msg, 'ws');
    } else if (ws === this.browserSocket) {
      this.handleBrowserMessage(msg);
    } else {
      log(`Message from unregistered client, ignoring: ${msg.action}`);
    }
  }

  private registerClient(ws: WebSocket, msg: RelayMessage): void {
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
    const ack: RelayMessage = {
      id: msg.id,
      type: 'response',
      from: 'vscode', // server acts on behalf of relay
      action: 'register',
      result: { status: 'registered', clientType },
      error: null,
      timestamp: Date.now(),
    };
    this.sendToSocket(ws, ack);
  }

  private handleDisconnect(ws: WebSocket, code: number, reason: string): void {
    this.aliveSockets.delete(ws);

    if (ws === this.vsCodeSocket) {
      log(`VS Code client disconnected (code=${code}, reason=${reason})`);
      this.vsCodeSocket = null;
    } else if (ws === this.browserSocket) {
      log(`Browser client disconnected (code=${code}, reason=${reason})`);
      this.browserSocket = null;
      // Reject any pending/active commands that were waiting for the browser
      this.rejectPendingCommands('Browser client disconnected');
    } else {
      log(`Unknown client disconnected (code=${code})`);
    }
  }

  // -----------------------------------------------------------------------
  // Message routing
  // -----------------------------------------------------------------------

  /** Handle a command originating from VS Code (either WebSocket or IPC). */
  private handleVSCodeMessage(msg: RelayMessage, source: 'ws' | 'ipc'): void {
    if (msg.type === 'command') {
      this.enqueueCommand(msg, source);
    } else if (msg.type === 'event') {
      // Forward events directly to browser
      if (this.browserSocket) {
        this.sendToSocket(this.browserSocket, msg);
      }
    }
  }

  /** Handle a message from the browser client (responses and events). */
  private handleBrowserMessage(msg: RelayMessage): void {
    if (msg.type === 'response') {
      this.resolveActiveCommand(msg);
    } else if (msg.type === 'event') {
      // Forward browser events to VS Code
      if (this.vsCodeSocket) {
        this.sendToSocket(this.vsCodeSocket, msg);
      }
      // Also relay via IPC if available
      this.sendToParent(msg);
    }
  }

  // -----------------------------------------------------------------------
  // Sequential command queue
  // -----------------------------------------------------------------------

  private enqueueCommand(msg: RelayMessage, source: 'ws' | 'ipc'): void {
    if (!this.browserSocket) {
      const errorResponse: RelayMessage = {
        id: msg.id,
        type: 'response',
        from: 'browser',
        action: msg.action,
        error: 'No browser client connected',
        timestamp: Date.now(),
      };
      this.sendResponse(errorResponse, source);
      return;
    }

    const pending: PendingCommand = {
      message: msg,
      resolve: (response: RelayMessage) => {
        this.sendResponse(response, source);
      },
      timer: setTimeout(() => {
        this.timeoutCommand(msg.id);
      }, COMMAND_TIMEOUT),
      source,
    };

    this.commandQueue.push(pending);
    log(`Command queued: ${msg.action} (id=${msg.id}, queue=${this.commandQueue.length})`);

    // If nothing is actively executing, start processing
    if (!this.activeCommand) {
      this.processNextCommand();
    }
  }

  private processNextCommand(): void {
    if (this.commandQueue.length === 0) {
      this.activeCommand = null;
      return;
    }

    const pending = this.commandQueue.shift()!;
    this.activeCommand = pending;

    if (!this.browserSocket) {
      clearTimeout(pending.timer);
      const errorResponse: RelayMessage = {
        id: pending.message.id,
        type: 'response',
        from: 'browser',
        action: pending.message.action,
        error: 'No browser client connected',
        timestamp: Date.now(),
      };
      pending.resolve(errorResponse);
      this.processNextCommand();
      return;
    }

    log(`Executing command: ${pending.message.action} (id=${pending.message.id})`);
    this.sendToSocket(this.browserSocket, pending.message);
  }

  private resolveActiveCommand(response: RelayMessage): void {
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
    this.processNextCommand();
  }

  private timeoutCommand(id: string): void {
    if (this.activeCommand && this.activeCommand.message.id === id) {
      log(`Command timed out: ${this.activeCommand.message.action} (id=${id})`);
      const errorResponse: RelayMessage = {
        id,
        type: 'response',
        from: 'browser',
        action: this.activeCommand.message.action,
        error: 'Command timed out',
        timestamp: Date.now(),
      };
      this.activeCommand.resolve(errorResponse);
      this.activeCommand = null;
      this.processNextCommand();
    } else {
      // Command is still in the queue, remove it
      const idx = this.commandQueue.findIndex((p) => p.message.id === id);
      if (idx !== -1) {
        const pending = this.commandQueue.splice(idx, 1)[0];
        log(`Queued command timed out: ${pending.message.action} (id=${id})`);
        const errorResponse: RelayMessage = {
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

  private rejectPendingCommands(reason: string): void {
    // Reject active command
    if (this.activeCommand) {
      clearTimeout(this.activeCommand.timer);
      const errorResponse: RelayMessage = {
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
      const errorResponse: RelayMessage = {
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

  private sendResponse(msg: RelayMessage, source: 'ws' | 'ipc'): void {
    if (source === 'ipc') {
      this.sendToParent(msg);
    } else if (this.vsCodeSocket) {
      this.sendToSocket(this.vsCodeSocket, msg);
    }
  }

  private sendToSocket(ws: WebSocket, msg: RelayMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // -----------------------------------------------------------------------
  // Heartbeat
  // -----------------------------------------------------------------------

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.wss) return;

      const heartbeatMsg: RelayMessage = {
        id: `hb-${Date.now()}`,
        type: 'heartbeat',
        from: 'vscode',
        action: 'ping',
        timestamp: Date.now(),
      };

      this.wss.clients.forEach((ws: WebSocket) => {
        if (this.aliveSockets.get(ws) === false) {
          // Did not respond to previous heartbeat within timeout
          log('Terminating unresponsive client');
          ws.terminate();
          return;
        }

        // Mark as pending, wait for pong
        this.aliveSockets.set(ws, false);
        this.sendToSocket(ws, heartbeatMsg);
        ws.ping();
      });
    }, HEARTBEAT_INTERVAL);
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  get isVSCodeConnected(): boolean {
    return this.vsCodeSocket !== null && this.vsCodeSocket.readyState === WebSocket.OPEN;
  }

  get isBrowserConnected(): boolean {
    return this.browserSocket !== null && this.browserSocket.readyState === WebSocket.OPEN;
  }

  get queueLength(): number {
    return this.commandQueue.length + (this.activeCommand ? 1 : 0);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parsePort(args: string[]): number {
  const idx = args.indexOf('--port');
  if (idx !== -1 && idx + 1 < args.length) {
    const port = parseInt(args[idx + 1], 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      return port;
    }
  }
  return 8765;
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
