import { BaseBrowserTool } from './base-tool';

interface ScrollInput {
  direction?: 'up' | 'down';
  amount?: number;
  selector?: string;
}

export class ScrollTool extends BaseBrowserTool<ScrollInput> {
  readonly commandName = 'interact.scroll';
  readonly invocationMessage = 'Scrolling...';
}
