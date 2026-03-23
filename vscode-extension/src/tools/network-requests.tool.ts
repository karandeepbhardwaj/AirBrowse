import { BaseBrowserTool } from './base-tool';

interface NetworkRequestsInput {
  filter?: string;
  limit?: number;
  includeBody?: boolean;
}

export class NetworkRequestsTool extends BaseBrowserTool<NetworkRequestsInput> {
  readonly commandName = 'monitor.network';
  readonly invocationMessage = 'Getting network requests...';
}
