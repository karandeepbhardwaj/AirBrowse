import { BaseBrowserTool } from './base-tool';

interface ConsoleLogsInput {
  level?: 'all' | 'error' | 'warn' | 'log' | 'info' | 'debug';
  limit?: number;
}

export class ConsoleLogsTool extends BaseBrowserTool<ConsoleLogsInput> {
  readonly commandName = 'monitor.console';
  readonly invocationMessage = 'Getting console logs...';
}
