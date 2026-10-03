import { checkToolPermissions, requestApproval } from '../tools/permissions.js';
import { createLogger } from '../core/logger.js';
import { pluginConfigForTool } from '../plugins/manager.js';

const log = createLogger('tool-exec');

export const TOOL_ACTIVITY_LABELS = {
  read_file: 'Reading file',
  list_dir: 'Listing directory',
  search_files: 'Searching files',
  write_file: 'Writing file',
  run_command: 'Running command',
  fetch_url: 'Fetching page',
  http_request: 'Calling API',
  workspace_search: 'Searching workspace',
  calculate: 'Calculating',
  remember: 'Storing memory',
  recall: 'Recalling memory',
  generate_image: 'Generating image',
  github_list_repos: 'Listing repositories',
  github_read_file: 'Reading remote file',
  github_create_file: 'Creating remote file',
  github_create_branch: 'Creating branch',
  github_create_issue: 'Opening issue',
  github_create_pr: 'Opening pull request',
  analyze_csv: 'Analyzing CSV',
};

export function activityLabel(toolName) {
  return TOOL_ACTIVITY_LABELS[toolName] || `Using tool ${toolName}`;
}

/**
 * Execute one tool call through the full permission pipeline:
 * schema validation -> permission check -> user approval (when needed) -> execute.
 *
 * `notify(event, data)` streams progress to the caller's SSE connection.
 */
export async function executeToolCall(tool, rawArgs, ctx, { notify = () => {}, settings } = {}) {
  const args = rawArgs || {};
  notify('tool_event', { phase: 'started', tool: tool.name, label: activityLabel(tool.name), args: safeArgs(tool, args) });

  const parsed = tool.schema.safeParse(args);
  if (!parsed.success) {
    const message = `Invalid arguments for ${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
    notify('tool_event', { phase: 'failed', tool: tool.name, error: message });
    return { ok: false, error: message };
  }

  const check = checkToolPermissions(tool, ctx.granted);
  const needsApproval =
    !check.ok ||
    (tool.dangerous && settings?.security?.requireApprovalForDangerous !== false);

  if (needsApproval) {
    notify('tool_event', {
      phase: 'approval_required',
      tool: tool.name,
      label: activityLabel(tool.name),
      missing: check.missing || [],
      dangerous: tool.dangerous,
      args: safeArgs(tool, args),
    });
    const decision = await requestApproval({
      tool,
      args: parsed.data,
      missing: check.missing || [],
      chatId: ctx.chatId,
      taskId: ctx.taskId,
    });
    if (!decision.approved) {
      const message = `User denied permission for ${tool.name}. ${decision.reason || ''}`.trim();
      notify('tool_event', { phase: 'denied', tool: tool.name, error: message });
      return { ok: false, error: message, denied: true };
    }
    notify('tool_event', { phase: 'approved', tool: tool.name });
  }

  try {
    const result = await tool.execute(parsed.data, { ...ctx, pluginConfig: pluginConfigForTool(tool.name, tool.pluginId) });
    notify('tool_event', { phase: 'completed', tool: tool.name, label: activityLabel(tool.name), summary: result?.summary });
    return { ok: true, summary: result?.summary, data: result?.data };
  } catch (err) {
    const message = err?.message || 'Tool execution failed.';
    log.warn(`tool ${tool.name} failed`, { error: message });
    notify('tool_event', { phase: 'failed', tool: tool.name, error: message });
    return { ok: false, error: message };
  }
}

/** Arguments shown in the UI: cap long strings, never dump secrets. */
function safeArgs(tool, args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (/key|token|secret|password/i.test(k)) out[k] = '[redacted]';
    else if (typeof v === 'string') out[k] = v.length > 400 ? `${v.slice(0, 400)}…` : v;
    else out[k] = v;
  }
  return out;
}
