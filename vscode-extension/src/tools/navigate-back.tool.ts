import { BaseBrowserTool } from './base-tool';

type NavigateBackInput = Record<string, never>;

export class NavigateBackTool extends BaseBrowserTool<NavigateBackInput> {
  readonly commandName = 'navigate.back';
  readonly invocationMessage = 'Going back...';
}
