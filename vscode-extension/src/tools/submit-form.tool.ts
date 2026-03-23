import { BaseBrowserTool } from './base-tool';

interface SubmitFormInput {
  selector: string;
}

export class SubmitFormTool extends BaseBrowserTool<SubmitFormInput> {
  readonly commandName = 'interact.submit';
  readonly invocationMessage = 'Submitting form...';
}
