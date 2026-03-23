import { BaseBrowserTool } from './base-tool';

interface PageStructureInput {
  maxDepth?: number;
}

export class PageStructureTool extends BaseBrowserTool<PageStructureInput> {
  readonly commandName = 'page.getStructure';
  readonly invocationMessage = 'Getting page structure...';
}
