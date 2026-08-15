import { describe, expect, it } from 'vitest';
import {
  buildToolPayload,
  canonicalToolName,
  categorizeBuiltInTool,
  categorizeBuiltinTool,
  categorizeTool,
  isMcpToolName,
  MCP_TOOL_CATEGORY,
  toolCategories,
  UNKNOWN_TOOL_CATEGORY,
} from './index.js';

const expectedBuiltinCategories: Readonly<Record<string, string>> = Object.freeze({
  read: 'read',
  search: 'search',
  shell: 'shell',
  edit: 'edit',
  test: 'test',
  build: 'build',
  browser: 'browser',
  web: 'web',
  agent: 'agent',
  planning: 'planning',
  media: 'media',
});

describe('safe built-in tool categorization', () => {
  it('exposes exactly the closed protocol category vocabulary', () => {
    expect(toolCategories).toEqual([
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
    ]);
    expect(Object.isFrozen(toolCategories)).toBe(true);
  });

  it('covers every documented safe category with fixed aliases', () => {
    for (const [name, category] of Object.entries(expectedBuiltinCategories)) {
      expect(categorizeBuiltinTool(name)).toBe(category);
      expect(categorizeBuiltInTool(name)).toBe(category);
    }
    expect(categorizeBuiltinTool('apply_patch')).toBe('edit');
    expect(categorizeBuiltinTool('unified_exec')).toBe('shell');
    expect(categorizeBuiltinTool('update_plan')).toBe('planning');
    expect(categorizeBuiltinTool('Agent')).toBe('agent');
  });

  it('maps unknown built-ins and every MCP naming form to generic codes', () => {
    const unknown = 'vendor_tool_SECRET_PATH_PASSWORD=https://example.invalid';
    expect(categorizeBuiltinTool(unknown)).toBe(UNKNOWN_TOOL_CATEGORY);
    expect(canonicalToolName(unknown)).toBe('other');

    for (const name of [
      'mcp',
      'mcp__server__tool',
      'mcp_server_tool',
      'mcp:server/tool',
      'mcp/server/tool',
    ]) {
      expect(isMcpToolName(name)).toBe(true);
      expect(categorizeBuiltinTool(name)).toBe(MCP_TOOL_CATEGORY);
      expect(canonicalToolName(name)).toBe('mcp');
    }
    expect(categorizeBuiltinTool('MCP')).toBe('mcp');
  });

  it('does not coerce spoofed objects, boxed strings, symbols, or numbers', () => {
    const canary = 'SPOOFED_TOOL_CANARY /secret?token=1';
    const objectWithToString = {
      toString: () => canary,
      valueOf: () => 'shell',
    };

    expect(categorizeBuiltinTool(objectWithToString)).toBe('other');
    expect(categorizeBuiltinTool(new String('shell'))).toBe('other');
    expect(categorizeBuiltinTool(Symbol('shell'))).toBe('other');
    expect(categorizeBuiltinTool(42)).toBe('other');
    expect(JSON.stringify(buildToolPayload(objectWithToString))).not.toContain(canary);
  });

  it('ignores inherited pollution and accepts null-prototype records', () => {
    const inherited = Object.create({ name: 'shell', source: 'mcp' }) as object;
    expect(categorizeTool(inherited)).toBe('other');

    const nullPrototype = Object.create(null) as Record<string, unknown>;
    nullPrototype.name = 'apply_patch';
    expect(categorizeTool(nullPrototype)).toBe('edit');
  });

  it('does not invoke getters or general proxy get traps', () => {
    const canary = 'GETTER_TOOL_CANARY command --secret';
    let getterCalls = 0;
    const input = {} as Record<string, unknown>;
    Object.defineProperty(input, 'name', {
      configurable: true,
      get: () => {
        getterCalls += 1;
        throw new Error(canary);
      },
    });
    expect(categorizeTool(input)).toBe('other');
    expect(getterCalls).toBe(0);

    const proxied = new Proxy(
      { name: 'shell' },
      {
        get: () => {
          throw new Error(canary);
        },
      },
    );
    expect(categorizeTool(proxied)).toBe('other');
    expect(JSON.stringify(buildToolPayload(input))).not.toContain(canary);
  });

  it('fails closed for revoked and exotic proxies without leaking exception text', () => {
    const canary = 'REVOKED_PROXY_CANARY /home/user/.ssh/id';
    const revoked = Proxy.revocable({ name: 'shell' }, {});
    revoked.revoke();
    expect(() => categorizeTool(revoked.proxy)).not.toThrow();
    expect(buildToolPayload(revoked.proxy)).toEqual({ name: 'other', category: 'other' });
    expect(JSON.stringify(buildToolPayload(revoked.proxy))).not.toContain(canary);
  });

  it('never returns a native name, server, identifier, or unknown metadata', () => {
    const canary = 'NATIVE_NAME_CANARY server/path?query=1';
    const payload = buildToolPayload({
      name: canary,
      serverIdentifier: canary,
      arguments: canary,
      output: canary,
      unknownMetadata: canary,
    });
    expect(payload).toEqual({ name: 'other', category: 'other' });
    expect(JSON.stringify(payload)).not.toContain(canary);
    expect(Object.keys(payload)).toEqual(['name', 'category']);
    expect(Object.isFrozen(payload)).toBe(true);
  });
});
