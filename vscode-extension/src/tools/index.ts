import * as vscode from 'vscode';
import { RelayClient } from '../relay/client';
import { BaseBrowserTool } from './base-tool';
import { PageTextTool } from './page-text.tool';
import { PageMarkdownTool } from './page-markdown.tool';
import { PageHtmlTool } from './page-html.tool';
import { PageTablesTool } from './page-tables.tool';
import { PageLinksTool } from './page-links.tool';
import { PageStructureTool } from './page-structure.tool';
import { PageScreenshotTool } from './page-screenshot.tool';
import { NavigateToTool } from './navigate-to.tool';
import { NavigateBackTool } from './navigate-back.tool';
import { GetUrlTool } from './get-url.tool';
import { ClickTool } from './click.tool';
import { TypeTextTool } from './type-text.tool';
import { SelectOptionTool } from './select-option.tool';
import { SubmitFormTool } from './submit-form.tool';
import { ScrollTool } from './scroll.tool';
import { CrawlSiteTool } from './crawl-site.tool';
import { CrawlCancelTool } from './crawl-cancel.tool';
import { ConsoleLogsTool } from './console-logs.tool';
import { NetworkRequestsTool } from './network-requests.tool';
import { GenerateExcelTool } from './generate-excel.tool';
import { GenerateCsvTool } from './generate-csv.tool';
import { GenerateWordTool } from './generate-word.tool';
import { GenerateMarkdownTool } from './generate-markdown.tool';
import { log } from '../utils/logger';

const TOOL_REGISTRY: Array<{
  name: string;
  tool: new (relay: RelayClient) => BaseBrowserTool<any>;
}> = [
  { name: 'airbrowse_getPageText', tool: PageTextTool },
  { name: 'airbrowse_getPageMarkdown', tool: PageMarkdownTool },
  { name: 'airbrowse_getPageHTML', tool: PageHtmlTool },
  { name: 'airbrowse_getPageTables', tool: PageTablesTool },
  { name: 'airbrowse_getPageLinks', tool: PageLinksTool },
  { name: 'airbrowse_getPageStructure', tool: PageStructureTool },
  { name: 'airbrowse_takeScreenshot', tool: PageScreenshotTool },
  { name: 'airbrowse_navigateTo', tool: NavigateToTool },
  { name: 'airbrowse_navigateBack', tool: NavigateBackTool },
  { name: 'airbrowse_getCurrentUrl', tool: GetUrlTool },
  { name: 'airbrowse_click', tool: ClickTool },
  { name: 'airbrowse_typeText', tool: TypeTextTool },
  { name: 'airbrowse_selectOption', tool: SelectOptionTool },
  { name: 'airbrowse_submitForm', tool: SubmitFormTool },
  { name: 'airbrowse_scroll', tool: ScrollTool },
  { name: 'airbrowse_crawlSite', tool: CrawlSiteTool },
  { name: 'airbrowse_crawlCancel', tool: CrawlCancelTool },
  { name: 'airbrowse_getConsoleLogs', tool: ConsoleLogsTool },
  { name: 'airbrowse_getNetworkRequests', tool: NetworkRequestsTool },
  { name: 'airbrowse_generateExcel', tool: GenerateExcelTool },
  { name: 'airbrowse_generateCsv', tool: GenerateCsvTool },
  { name: 'airbrowse_generateWord', tool: GenerateWordTool },
  { name: 'airbrowse_generateMarkdown', tool: GenerateMarkdownTool },
];

export function registerAllTools(
  context: vscode.ExtensionContext,
  relay: RelayClient
): void {
  for (const { name, tool: ToolClass } of TOOL_REGISTRY) {
    const instance = new ToolClass(relay);
    context.subscriptions.push(vscode.lm.registerTool(name, instance));
    log(`Registered tool: ${name}`);
  }

  log(`Registered ${TOOL_REGISTRY.length} tools`);
}
