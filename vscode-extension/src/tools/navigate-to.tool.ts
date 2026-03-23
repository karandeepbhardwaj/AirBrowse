import { BaseBrowserTool } from './base-tool';

interface NavigateToInput {
  url: string;
  waitForLoad?: boolean;
}

export class NavigateToTool extends BaseBrowserTool<NavigateToInput> {
  readonly commandName = 'navigate.goto';
  readonly invocationMessage = 'Navigating to URL...';
}
