import { BaseBrowserTool } from './base-tool';

interface SelectOptionInput {
  selector: string;
  value: string;
}

export class SelectOptionTool extends BaseBrowserTool<SelectOptionInput> {
  readonly commandName = 'interact.select';
  readonly invocationMessage = 'Selecting option...';
}
