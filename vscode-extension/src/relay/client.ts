import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import * as path from 'path';
import * as cp from 'child_process';
import { log, logError } from '../utils/logger';

interface RelayMessage {
  id: string;
  type: 'command' | 'response' | 'event' | 'register' | 'heartbeat';
  from: 'vscode' | 'browser';
  action: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: string | null;
  timestamp?: number;
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RelayClient extends EventEmitter {
  private relayProcess: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private connected: boolean = false;
  private browserConnected: boolean = false;
  private port: number;
  private commandTimeout: number = 30000;
  private disposed: boolean = false;
  private reconnectDelay: number = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(port?: number) {
    super();
    this.port = port ?? 8765;
  }

  /**
   * Start the relay server as a forked child process and communicate via IPC.
   */
  async startRelay(extensionPath: string): Promise<void> {
    if (this.relayProcess) {
      log('Relay process already running');
      return;
    }

    const serverPath = path.join(extensionPath, 'relay', 'server.js');
    log(`Starting relay server: ${serverPath} on port ${this.port}`);

    return new Promise<void>((resolve, reject) => {
      try {
        this.relayProcess = cp.fork(serverPath, ['--port', this.port.toString()], {
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        });
      } catch (err) {
        logError('Failed to fork relay server', err);
        reject(err);
        return;
      }

      const startupTimeout = setTimeout(() => {
        reject(new Error('Relay server startup timed out'));
      }, 10000);

      this.relayProcess.on('message', (msg: RelayMessage) => {
        this.handleMessage(msg);
      });

      this.relayProcess.on('error', (err) => {
        logError('Relay process error', err);
        this.emit('error', err);
      });

      this.relayProcess.on('exit', (code, signal) => {
        log(`Relay process exited (code=${code}, signal=${signal})`);
        this.connected = false;
        this.browserConnected = false;
        this.relayProcess = null;
        this.emit('disconnected');
      });

      if (this.relayProcess.stdout) {
        this.relayProcess.stdout.on('data', (data: Buffer) => {
          log(`[relay stdout] ${data.toString().trim()}`);
        });
      }

      if (this.relayProcess.stderr) {
        this.relayProcess.stderr.on('data', (data: Buffer) => {
          logError(`[relay stderr] ${data.toString().trim()}`);
        });
      }

      // Send registration message
      this.relayProcess.send({
        id: crypto.randomUUID(),
        type: 'register',
        from: 'vscode',
        action: 'register',
        timestamp: Date.now(),
      });

      // Listen for the connected event we emit from handleMessage
      this.once('connected', () => {
        clearTimeout(startupTimeout);
        resolve();
      });

      // Also resolve on a short delay if server is running but doesn't send
      // an explicit connected response (the registration itself succeeds via IPC)
      setTimeout(() => {
        if (!this.connected) {
          this.connected = true;
          clearTimeout(startupTimeout);
          this.emit('connected');
        }
      }, 2000);
    });
  }

  /**
   * Connect to an existing relay server via WebSocket (fallback mode).
   */
  async connectWebSocket(): Promise<void> {
    if (this.ws) {
      log('WebSocket already connected');
      return;
    }

    const url = `ws://localhost:${this.port}`;
    log(`Connecting to relay via WebSocket: ${url}`);

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        logError('Failed to create WebSocket', err);
        reject(err);
        return;
      }

      this.ws.onopen = () => {
        log('WebSocket connected');
        this.connected = true;
        this.reconnectDelay = 1000;

        // Send registration
        this.sendRaw({
          id: crypto.randomUUID(),
          type: 'register',
          from: 'vscode',
          action: 'register',
          timestamp: Date.now(),
        });

        this.emit('connected');
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: RelayMessage = JSON.parse(
            typeof event.data === 'string' ? event.data : event.data.toString()
          );
          this.handleMessage(msg);
        } catch (err) {
          logError('Failed to parse WebSocket message', err);
        }
      };

      this.ws.onerror = (event) => {
        logError('WebSocket error', (event as { message?: string }).message ?? 'unknown');
        this.emit('error', new Error('WebSocket error'));
      };

      this.ws.onclose = () => {
        log('WebSocket closed');
        this.connected = false;
        this.browserConnected = false;
        this.ws = null;
        this.emit('disconnected');
        this.scheduleReconnect();
      };

      // Timeout for initial connection
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('WebSocket connection timed out'));
          if (this.ws) {
            this.ws.close();
            this.ws = null;
          }
        }
      }, 10000);
    });
  }

  /**
   * Send a command to the browser extension and wait for a response.
   */
  async sendCommand(action: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) {
      throw new Error('Not connected to relay server');
    }

    const id = crypto.randomUUID();
    const message: RelayMessage = {
      id,
      type: 'command',
      from: 'vscode',
      action,
      params,
      timestamp: Date.now(),
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`Command '${action}' timed out after ${this.commandTimeout}ms`));
      }, this.commandTimeout);

      this.pendingCommands.set(id, { resolve, reject, timer });
      this.sendRaw(message);
    });
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get isBrowserConnected(): boolean {
    return this.browserConnected;
  }

  /**
   * Dispose all resources and clean up.
   */
  dispose(): void {
    this.disposed = true;

    // Cancel reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reject all pending commands
    for (const [id, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Client disposed'));
    }
    this.pendingCommands.clear();

    // Kill relay child process
    if (this.relayProcess) {
      log('Killing relay process');
      this.relayProcess.kill();
      this.relayProcess = null;
    }

    // Close WebSocket
    if (this.ws) {
      log('Closing WebSocket');
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.browserConnected = false;
    this.removeAllListeners();
  }

  // ---- Private methods ----

  private handleMessage(msg: RelayMessage): void {
    switch (msg.type) {
      case 'response':
        this.handleResponse(msg);
        break;

      case 'event':
        this.handleEvent(msg);
        break;

      case 'heartbeat':
        // Heartbeats keep the connection alive; nothing to do
        break;

      default:
        log(`Received unhandled message type: ${msg.type}`);
        break;
    }
  }

  private handleResponse(msg: RelayMessage): void {
    const pending = this.pendingCommands.get(msg.id);
    if (!pending) {
      log(`Received response for unknown command id: ${msg.id}`);
      return;
    }

    clearTimeout(pending.timer);
    this.pendingCommands.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleEvent(msg: RelayMessage): void {
    const { action } = msg;

    // Handle browser connection state events
    if (action === 'browser.connected') {
      this.browserConnected = true;
      this.emit('browserConnected');
      log('Browser extension connected');
      return;
    }

    if (action === 'browser.disconnected') {
      this.browserConnected = false;
      this.emit('browserDisconnected');
      log('Browser extension disconnected');
      return;
    }

    if (action === 'relay.ready') {
      this.connected = true;
      this.emit('connected');
      log('Relay server ready');
      return;
    }

    // Forward all other events
    this.emit(action, msg.params ?? msg.result);
  }

  private sendRaw(msg: RelayMessage): void {
    if (this.relayProcess) {
      this.relayProcess.send(msg);
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      logError('Cannot send message: no active connection');
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) {
      return;
    }

    log(`Scheduling WebSocket reconnect in ${this.reconnectDelay}ms`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.disposed) {
        return;
      }

      try {
        await this.connectWebSocket();
      } catch {
        // Exponential backoff: 1s, 2s, 4s, 8s, ..., max 30s
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      }
    }, this.reconnectDelay);
  }
}
