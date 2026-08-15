import type { SanitizedToken, ToolCategory } from '@codeinvaders/protocol';
import {
  readFirstSnapshot,
  snapshotAllowedProperties,
  type SafePropertySnapshot,
} from './safe-input.js';

const freeze = Object.freeze;

/** The closed category vocabulary used by canonical tool payloads. */
export const toolCategories = freeze([
  'read',
  'search',
  'shell',
  'edit',
  'test',
  'build',
  'browser',
  'web',
  'mcp',
  'agent',
  'planning',
  'media',
  'other',
] as const satisfies readonly ToolCategory[]);

export type CanonicalToolName = (typeof toolCategories)[number];

/** Generic categories intentionally contain no native tool or server name. */
export const UNKNOWN_TOOL_CATEGORY = 'other' as const;
export const MCP_TOOL_CATEGORY = 'mcp' as const;

const MCP_NAME_PREFIXES = freeze(['mcp__', 'mcp_', 'mcp:', 'mcp/'] as const);

/**
 * This table is deliberately a closed list. Matching is exact and
 * case-sensitive; no caller-controlled object is coerced into a name.
 */
const BUILTIN_TOOL_RULES = freeze([
  freeze({
    category: 'read' as const,
    names: freeze([
      'cat',
      'file_read',
      'list_dir',
      'list_directory',
      'read',
      'read_file',
      'view_file',
    ] as const),
  }),
  freeze({
    category: 'search' as const,
    names: freeze([
      'file_search',
      'find',
      'glob',
      'grep',
      'rg',
      'ripgrep',
      'search',
      'search_files',
    ] as const),
  }),
  freeze({
    category: 'shell' as const,
    names: freeze([
      'bash',
      'cmd',
      'exec',
      'powershell',
      'run_command',
      'shell',
      'shell_command',
      'terminal',
      'unified_exec',
    ] as const),
  }),
  freeze({
    category: 'edit' as const,
    names: freeze(['apply_patch', 'edit', 'file_write', 'replace', 'write_file'] as const),
  }),
  freeze({
    category: 'test' as const,
    names: freeze(['jest', 'pytest', 'run_tests', 'test', 'vitest'] as const),
  }),
  freeze({
    category: 'build' as const,
    names: freeze(['build', 'compile', 'run_build'] as const),
  }),
  freeze({
    category: 'browser' as const,
    names: freeze(['browser', 'browser_control', 'computer', 'playwright'] as const),
  }),
  freeze({
    category: 'web' as const,
    names: freeze([
      'click',
      'finance',
      'image_query',
      'open',
      'search_query',
      'sports',
      'time',
      'weather',
      'web',
      'web_search',
    ] as const),
  }),
  freeze({
    category: 'agent' as const,
    names: freeze(['Agent', 'agent', 'spawn_agent', 'subagent'] as const),
  }),
  freeze({
    category: 'planning' as const,
    names: freeze(['plan', 'planning', 'task_plan', 'update_plan'] as const),
  }),
  freeze({
    category: 'media' as const,
    names: freeze(['audio', 'generate_image', 'image_gen', 'imagegen', 'media', 'video'] as const),
  }),
] as const);

/** The exact own properties accepted when a native hook supplies a descriptor. */
export const TOOL_INPUT_PROPERTY_KEYS = freeze([
  'name',
  'toolName',
  'tool_name',
  'tool',
  'source',
  'kind',
  'toolType',
  'tool_type',
  'type',
  'provider',
  'origin',
  'toolKind',
  'tool_kind',
  'isMcp',
  'is_mcp',
  'mcp',
  'server',
  'serverName',
  'server_name',
  'mcpServer',
  'mcp_server',
  'mcpServerName',
  'mcp_server_name',
] as const);

function startsWithMcpPrefix(value: string): boolean {
  for (let index = 0; index < MCP_NAME_PREFIXES.length; index += 1) {
    const prefix = MCP_NAME_PREFIXES[index];
    if (prefix === undefined || value.length < prefix.length) continue;
    let matches = true;
    for (let characterIndex = 0; characterIndex < prefix.length; characterIndex += 1) {
      if (value[characterIndex] !== prefix[characterIndex]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

/** Identifies MCP names without retaining or returning the name. */
export function isMcpToolName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value === 'mcp' || value === 'MCP' || startsWithMcpPrefix(value);
}

function isMcpDescriptor(snapshot: readonly SafePropertySnapshot[]): boolean {
  const source = readFirstSnapshot(snapshot, [
    'source',
    'kind',
    'toolType',
    'tool_type',
    'type',
    'provider',
    'origin',
    'toolKind',
    'tool_kind',
  ]);
  if (source === 'mcp' || source === 'MCP') return true;

  const marker = readFirstSnapshot(snapshot, ['isMcp', 'is_mcp', 'mcp']);
  if (marker === true) return true;

  const server = readFirstSnapshot(snapshot, [
    'server',
    'serverName',
    'server_name',
    'mcpServer',
    'mcp_server',
    'mcpServerName',
    'mcp_server_name',
  ]);
  return typeof server === 'string';
}

/** Categorizes a snapshotted native descriptor without rereading it. */
export function categorizeToolSnapshot(snapshot: readonly SafePropertySnapshot[]): ToolCategory {
  if (isMcpDescriptor(snapshot)) return MCP_TOOL_CATEGORY;

  const name = readFirstSnapshot(snapshot, ['name', 'toolName', 'tool_name', 'tool']);
  return categorizeBuiltinTool(name);
}

/**
 * Categorizes only known built-ins. Unknown names are mapped to `other` and
 * all MCP names are mapped to `mcp`; the input string is never returned.
 */
export function categorizeBuiltinTool(toolName: unknown): ToolCategory {
  if (isMcpToolName(toolName)) return MCP_TOOL_CATEGORY;
  if (typeof toolName !== 'string') return UNKNOWN_TOOL_CATEGORY;

  for (let ruleIndex = 0; ruleIndex < BUILTIN_TOOL_RULES.length; ruleIndex += 1) {
    const rule = BUILTIN_TOOL_RULES[ruleIndex];
    if (rule === undefined) continue;
    for (let nameIndex = 0; nameIndex < rule.names.length; nameIndex += 1) {
      if (rule.names[nameIndex] === toolName) return rule.category;
    }
  }
  return UNKNOWN_TOOL_CATEGORY;
}

/** Alias with the spelling used in some adapter documentation. */
export const categorizeBuiltInTool = categorizeBuiltinTool;

/** Categorizes either a primitive native name or an allowlisted descriptor. */
export function categorizeTool(input: unknown): ToolCategory {
  if (typeof input === 'string') return categorizeBuiltinTool(input);
  return categorizeToolSnapshot(snapshotAllowedProperties(input, TOOL_INPUT_PROPERTY_KEYS));
}

/** Converts a category into a fixed canonical name code. */
export function canonicalToolNameForCategory(category: ToolCategory): SanitizedToken {
  switch (category) {
    case 'read':
      return 'read' as SanitizedToken;
    case 'search':
      return 'search' as SanitizedToken;
    case 'shell':
      return 'shell' as SanitizedToken;
    case 'edit':
      return 'edit' as SanitizedToken;
    case 'test':
      return 'test' as SanitizedToken;
    case 'build':
      return 'build' as SanitizedToken;
    case 'browser':
      return 'browser' as SanitizedToken;
    case 'web':
      return 'web' as SanitizedToken;
    case 'mcp':
      return 'mcp' as SanitizedToken;
    case 'agent':
      return 'agent' as SanitizedToken;
    case 'planning':
      return 'planning' as SanitizedToken;
    case 'media':
      return 'media' as SanitizedToken;
    case 'other':
      return 'other' as SanitizedToken;
    default:
      return 'other' as SanitizedToken;
  }
}

/** Returns a fixed canonical name code for a hostile native input. */
export function canonicalToolName(input: unknown): SanitizedToken {
  return canonicalToolNameForCategory(categorizeTool(input));
}
