import * as vscode from 'vscode';
import { RelayClient } from '../relay/client';
import { SYSTEM_PROMPT } from './prompts';
import { truncateText } from '../utils/chunker';
import { log, logError } from '../utils/logger';

const MAX_ITERATIONS = 15;

interface ParsedAction {
  tool: string;
  params: Record<string, unknown>;
}

/**
 * Run an agentic loop: send the user request to Copilot, parse any action
 * blocks from the response, execute them via the relay, feed results back,
 * and repeat until the model responds without actions or we hit the limit.
 */
export async function runAgentLoop(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  relay: RelayClient,
  token: vscode.CancellationToken,
  initialContext?: string
): Promise<void> {
  const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (models.length === 0) {
    stream.markdown('No Copilot model available. Please ensure GitHub Copilot is signed in.');
    return;
  }
  const model = models[0];

  const history: vscode.LanguageModelChatMessage[] = [];

  // System prompt (sent as User message since vscode.lm doesn't support system role)
  history.push(vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT));

  // Include initial context if provided
  if (initialContext) {
    history.push(
      vscode.LanguageModelChatMessage.User(
        `Current page content:\n\n${truncateText(initialContext, 30000)}`
      )
    );
  }

  // User request
  history.push(vscode.LanguageModelChatMessage.User(request.prompt));

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (token.isCancellationRequested) {
      break;
    }

    let fullText: string;
    try {
      const response = await model.sendRequest(history, {}, token);
      fullText = '';
      for await (const fragment of response.text) {
        fullText += fragment;
      }
    } catch (err) {
      if (err instanceof vscode.CancellationError) {
        break;
      }
      logError('Agent loop: model request failed', err);
      stream.markdown('An error occurred while communicating with the model.');
      return;
    }

    // Parse for action blocks
    const actions = parseActions(fullText);

    if (actions.length === 0) {
      // No actions = task complete, stream the response
      stream.markdown(fullText);
      break;
    }

    // Stream the reasoning part (text before/between actions)
    const reasoning = extractReasoning(fullText);
    if (reasoning) {
      stream.markdown(reasoning + '\n\n');
    }

    // Record assistant response in history
    history.push(vscode.LanguageModelChatMessage.Assistant(fullText));

    // Execute each action and feed results back
    for (const action of actions) {
      if (token.isCancellationRequested) {
        break;
      }

      stream.progress(`Executing: ${action.tool}...`);
      try {
        const result = await relay.sendCommand(action.tool, action.params);
        const resultStr = truncateText(JSON.stringify(result, null, 2), 8000);
        history.push(
          vscode.LanguageModelChatMessage.User(
            `Tool "${action.tool}" returned:\n${resultStr}`
          )
        );
        log(`Agent loop: ${action.tool} succeeded`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        history.push(
          vscode.LanguageModelChatMessage.User(
            `Tool "${action.tool}" failed with error: ${errMsg}`
          )
        );
        logError(`Agent loop: ${action.tool} failed`, err);
      }
    }

    // Context management: if history is getting long, trim old messages
    // but always keep the system prompt (index 0) and the last N messages
    if (history.length > 20) {
      const keep = [history[0], ...history.slice(-14)];
      history.length = 0;
      history.push(...keep);
    }
  }
}

/**
 * Extract action blocks from model output and parse them as JSON.
 * Supports multiple formats:
 *   1. ```action\n{...}\n```
 *   2. ```json\n{...}\n```  (if it contains "tool")
 *   3. Bare JSON objects like {"tool": "...", "params": {...}}
 */
export function parseActions(text: string): ParsedAction[] {
  const actions: ParsedAction[] = [];

  // Pattern 1: ```action or ```json fenced blocks
  const fencedPattern = /```(?:action|json)\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fencedPattern.exec(text)) !== null) {
    const jsonStr = match[1].trim();
    tryParseAction(jsonStr, actions);
  }

  // If we found fenced actions, return them
  if (actions.length > 0) {
    return actions;
  }

  // Pattern 2: Bare JSON objects with "tool" key on their own line or inline
  const barePattern = /\{[^{}]*"tool"\s*:\s*"[^"]+?"[^{}]*(?:"params"\s*:\s*\{[^{}]*\})?[^{}]*\}/g;
  while ((match = barePattern.exec(text)) !== null) {
    tryParseAction(match[0].trim(), actions);
  }

  return actions;
}

function tryParseAction(jsonStr: string, actions: ParsedAction[]): void {
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed.tool === 'string') {
      actions.push({
        tool: parsed.tool,
        params: parsed.params ?? {},
      });
    }
  } catch {
    logError(`Agent loop: failed to parse action block: ${jsonStr.slice(0, 200)}`);
  }
}

/**
 * Extract the reasoning text (everything outside action blocks and bare JSON).
 */
export function extractReasoning(text: string): string {
  return text
    .replace(/```(?:action|json)\s*\n[\s\S]*?```/g, '')
    .replace(/\{[^{}]*"tool"\s*:\s*"[^"]+?"[^{}]*(?:"params"\s*:\s*\{[^{}]*\})?[^{}]*\}/g, '')
    .trim();
}
