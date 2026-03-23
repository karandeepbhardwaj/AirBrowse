import * as vscode from 'vscode';
import { RelayClient } from '../relay/client';
import { runAgentLoop } from './agent-loop';
import { parseInstructions, TestStep } from './instruction-parser';
import {
  QUESTION_PROMPT,
  CRAWL_SUMMARIZE_PROMPT,
  DATA_EXTRACT_PROMPT,
  UI_TEST_PROMPT,
} from './prompts';
import { truncateText } from '../utils/chunker';
import { log, logError } from '../utils/logger';

type TaskMode = 'QUESTION' | 'CRAWL' | 'TEST' | 'EXTRACT' | 'GENERATE' | 'AGENT';

function detectMode(prompt: string): TaskMode {
  const lower = prompt.toLowerCase();
  if (/\b(test|step\s*\d|verify|assert)\b/.test(lower) && /\d+\.\s/.test(prompt)) {
    return 'TEST';
  }
  if (/\b(crawl|scrape|spider)\b/.test(lower)) {
    return 'CRAWL';
  }
  if (/\b(extract|table|data)\b/.test(lower)) {
    return 'EXTRACT';
  }
  if (/\b(excel|xlsx|csv|word|docx|export)\b/.test(lower)) {
    return 'GENERATE';
  }
  if (/\b(go to|navigate|click|type|fill|submit|then)\b/.test(lower)) {
    return 'AGENT';
  }
  return 'QUESTION';
}

/**
 * Register the @browse chat participant with VS Code.
 */
export function registerBrowseParticipant(
  context: vscode.ExtensionContext,
  relay: RelayClient
): void {
  const handler: vscode.ChatRequestHandler = async (
    request,
    _chatContext,
    stream,
    token
  ) => {
    log(`@browse request: ${request.prompt.slice(0, 100)}`);

    if (!relay.isBrowserConnected) {
      stream.markdown(
        '**No browser connected.** Please:\n' +
          '1. Start the AirBrowse relay (Command Palette > "AirBrowse: Connect")\n' +
          '2. Open Chrome with the AirBrowse extension installed\n'
      );
      return;
    }

    const mode = detectMode(request.prompt);
    log(`Detected mode: ${mode}`);

    try {
      switch (mode) {
        case 'QUESTION':
          await handleQuestion(request, stream, relay, token);
          break;
        case 'CRAWL':
          await handleCrawl(request, stream, relay, token);
          break;
        case 'TEST':
          await handleTest(request, stream, relay, token);
          break;
        case 'EXTRACT':
          await handleExtract(request, stream, relay, token);
          break;
        case 'GENERATE':
        case 'AGENT': {
          // Pre-fetch page content so the LLM has context to work with
          stream.progress('Reading page content...');
          let pageContext: string | undefined;
          try {
            const page = await relay.sendCommand('page.getMarkdown');
            const raw = typeof page === 'object' && page !== null
              ? (page as { markdown?: string }).markdown ?? JSON.stringify(page)
              : String(page);
            pageContext = raw;
          } catch {
            // Continue without page context
          }
          await runAgentLoop(request, stream, relay, token, pageContext);
          break;
        }
      }
    } catch (err) {
      logError('@browse handler error', err);
      const msg = err instanceof Error ? err.message : String(err);
      stream.markdown(`**Error:** ${msg}`);
    }
  };

  const participant = vscode.chat.createChatParticipant(
    'airbrowse.browse',
    handler
  );
  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    'icons',
    'icon128.png'
  );
  context.subscriptions.push(participant);
}

// ---- Mode handlers ----

/**
 * QUESTION mode: fetch page content as markdown, send to Copilot with the
 * user's question, and stream the answer.
 */
async function handleQuestion(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  relay: RelayClient,
  token: vscode.CancellationToken
): Promise<void> {
  stream.progress('Reading page content...');

  const pageContent = await relay.sendCommand('page.getMarkdown');
  const content = typeof pageContent === 'string'
    ? pageContent
    : JSON.stringify(pageContent, null, 2);
  const truncated = truncateText(content, 30000);

  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (models.length === 0) {
    stream.markdown('No Copilot model available.');
    return;
  }

  const messages = [
    vscode.LanguageModelChatMessage.User(QUESTION_PROMPT),
    vscode.LanguageModelChatMessage.User(
      `Page content:\n\n${truncated}`
    ),
    vscode.LanguageModelChatMessage.User(request.prompt),
  ];

  const response = await models[0].sendRequest(messages, {}, token);
  for await (const fragment of response.text) {
    stream.markdown(fragment);
  }
}

/**
 * CRAWL mode: start a multi-page crawl, stream progress, then summarise
 * the collected content with the LLM.
 */
async function handleCrawl(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  relay: RelayClient,
  token: vscode.CancellationToken
): Promise<void> {
  // Extract URL from the prompt, or fall back to the current page
  const urlMatch = request.prompt.match(/(https?:\/\/\S+)/i);
  let startUrl: string;

  if (urlMatch) {
    startUrl = urlMatch[1];
  } else {
    const currentUrl = await relay.sendCommand('page.getCurrentUrl');
    startUrl = typeof currentUrl === 'string' ? currentUrl : String(currentUrl);
  }

  // Parse optional depth / page limits
  const depthMatch = request.prompt.match(/\bdepth\s*[:=]?\s*(\d+)/i);
  const pagesMatch = request.prompt.match(/\b(?:max\s*)?pages?\s*[:=]?\s*(\d+)/i);

  const maxDepth = depthMatch ? parseInt(depthMatch[1], 10) : 2;
  const maxPages = pagesMatch ? parseInt(pagesMatch[1], 10) : 10;

  stream.progress(`Crawling ${startUrl} (depth ${maxDepth}, max ${maxPages} pages)...`);

  let crawlResult: unknown;
  try {
    crawlResult = await relay.sendCommand('crawl.start', {
      startUrl,
      maxDepth,
      maxPages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stream.markdown(`**Crawl failed:** ${msg}`);
    return;
  }

  const crawlText = typeof crawlResult === 'string'
    ? crawlResult
    : JSON.stringify(crawlResult, null, 2);

  stream.progress('Summarising crawled content...');

  const truncated = truncateText(crawlText, 40000);

  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (models.length === 0) {
    stream.markdown('No Copilot model available to summarise crawl results.');
    stream.markdown('\n\n```\n' + truncated + '\n```');
    return;
  }

  const messages = [
    vscode.LanguageModelChatMessage.User(CRAWL_SUMMARIZE_PROMPT),
    vscode.LanguageModelChatMessage.User(truncated),
  ];

  if (request.prompt) {
    messages.push(
      vscode.LanguageModelChatMessage.User(
        `The user's original request was: ${request.prompt}`
      )
    );
  }

  const response = await models[0].sendRequest(messages, {}, token);
  for await (const fragment of response.text) {
    stream.markdown(fragment);
  }

  // Offer export buttons
  stream.button({
    command: 'airbrowse.exportMarkdown',
    title: 'Export as Markdown',
    arguments: [crawlText],
  });
}

/**
 * TEST mode: parse natural-language steps, execute each sequentially via
 * the relay, collect results, then ask the LLM to evaluate.
 */
async function handleTest(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  relay: RelayClient,
  token: vscode.CancellationToken
): Promise<void> {
  const steps = parseInstructions(request.prompt);

  if (steps.length === 0) {
    stream.markdown('Could not parse any test steps from your instructions. Please use numbered steps like:\n\n1. Go to http://example.com\n2. Click the Login button\n3. Verify the page says "Welcome"');
    return;
  }

  stream.markdown(`**Running ${steps.length} test step(s)...**\n\n`);

  interface StepResult {
    step: TestStep;
    success: boolean;
    output?: string;
    error?: string;
  }

  const results: StepResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    if (token.isCancellationRequested) {
      break;
    }

    const step = steps[i];
    stream.progress(`Step ${i + 1}/${steps.length}: ${step.raw}`);

    try {
      const result = await executeTestStep(step, relay);
      results.push({
        step,
        success: true,
        output: typeof result === 'string' ? result : JSON.stringify(result),
      });
      stream.markdown(`**Step ${i + 1}** - ${step.raw}  \nResult: Executed successfully\n\n`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({ step, success: false, error: errMsg });
      stream.markdown(`**Step ${i + 1}** - ${step.raw}  \nResult: **FAILED** - ${errMsg}\n\n`);
    }
  }

  // Send results to LLM for evaluation
  stream.progress('Evaluating test results...');

  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (models.length === 0) {
    return;
  }

  const resultSummary = results
    .map(
      (r, i) =>
        `Step ${i + 1}: ${r.step.raw}\n  Status: ${r.success ? 'PASS' : 'FAIL'}\n  ${r.success ? `Output: ${truncateText(r.output ?? '', 500)}` : `Error: ${r.error}`}`
    )
    .join('\n\n');

  const messages = [
    vscode.LanguageModelChatMessage.User(UI_TEST_PROMPT),
    vscode.LanguageModelChatMessage.User(resultSummary),
  ];

  const response = await models[0].sendRequest(messages, {}, token);
  stream.markdown('\n---\n\n**Test Evaluation:**\n\n');
  for await (const fragment of response.text) {
    stream.markdown(fragment);
  }
}

/**
 * Execute a single test step via the relay.
 */
async function executeTestStep(
  step: TestStep,
  relay: RelayClient
): Promise<unknown> {
  switch (step.type) {
    case 'navigate':
      return relay.sendCommand('navigate.goto', { url: step.target });

    case 'click':
      if (step.value && (!step.target || step.target === 'button')) {
        // Click by visible text -- build an XPath-style selector or let the
        // browser extension handle text-based matching.
        return relay.sendCommand('interact.click', {
          selector: step.target ?? 'button',
          text: step.value,
        });
      }
      return relay.sendCommand('interact.click', { selector: step.target });

    case 'type':
      return relay.sendCommand('interact.type', {
        selector: step.target,
        text: step.value,
      });

    case 'select':
      return relay.sendCommand('interact.select', {
        selector: step.target,
        value: step.value,
      });

    case 'verify': {
      // Get page text and check for the condition string
      const pageText = await relay.sendCommand('page.getText');
      const text = typeof pageText === 'string' ? pageText : JSON.stringify(pageText);
      if (step.condition && !text.toLowerCase().includes(step.condition.toLowerCase())) {
        throw new Error(
          `Verification failed: expected page to contain "${step.condition}"`
        );
      }
      return { verified: true, condition: step.condition };
    }

    case 'wait': {
      const ms = step.value ? parseInt(step.value, 10) : 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10000)));
      return { waited: ms };
    }

    case 'scroll':
      return relay.sendCommand('interact.scroll', {
        selector: step.target,
        y: step.value ? parseInt(step.value, 10) : undefined,
      });

    case 'screenshot':
      return relay.sendCommand('page.screenshot');

    default:
      throw new Error(`Unsupported step type: ${step.type}`);
  }
}

/**
 * EXTRACT mode: pull tables from the page, send to the LLM for cleanup,
 * and offer export buttons.
 */
async function handleExtract(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  relay: RelayClient,
  token: vscode.CancellationToken
): Promise<void> {
  stream.progress('Extracting tables from page...');

  let tables: unknown;
  try {
    tables = await relay.sendCommand('page.getTables');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stream.markdown(`**Failed to extract tables:** ${msg}`);
    return;
  }

  const tableStr = typeof tables === 'string'
    ? tables
    : JSON.stringify(tables, null, 2);

  if (!tableStr || tableStr === '[]' || tableStr === 'null') {
    // Fall back to page text extraction
    stream.progress('No tables found, extracting page text...');
    const pageText = await relay.sendCommand('page.getText');
    const text = typeof pageText === 'string' ? pageText : JSON.stringify(pageText);
    await runAgentLoop(
      request,
      stream,
      relay,
      token,
      text
    );
    return;
  }

  stream.progress('Analysing extracted data...');

  const truncated = truncateText(tableStr, 25000);

  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (models.length === 0) {
    stream.markdown('No Copilot model available.');
    stream.markdown('\n\n```json\n' + truncated + '\n```');
    return;
  }

  const messages = [
    vscode.LanguageModelChatMessage.User(DATA_EXTRACT_PROMPT),
    vscode.LanguageModelChatMessage.User(truncated),
    vscode.LanguageModelChatMessage.User(
      `The user asked: ${request.prompt}`
    ),
  ];

  const response = await models[0].sendRequest(messages, {}, token);
  let fullResponse = '';
  for await (const fragment of response.text) {
    stream.markdown(fragment);
    fullResponse += fragment;
  }

  // Offer export buttons
  stream.button({
    command: 'airbrowse.exportCsv',
    title: 'Export as CSV',
    arguments: [tableStr],
  });
  stream.button({
    command: 'airbrowse.exportExcel',
    title: 'Export as Excel',
    arguments: [tableStr],
  });
}
