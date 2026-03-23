import { BaseBrowserTool } from './base-tool';

interface TypeTextInput {
  selector: string;
  text: string;
  clearFirst?: boolean;
}

export class TypeTextTool extends BaseBrowserTool<TypeTextInput> {
  readonly commandName = 'interact.type';
  readonly invocationMessage = 'Typing text...';
}
