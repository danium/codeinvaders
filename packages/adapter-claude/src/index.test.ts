import { describe, expect, it } from 'vitest';
import {
  claudeCapabilities,
  detectClaudeCapabilities,
  normalizeClaudeHook,
  normalizeClaudeLifecycle,
  claudeHook,
} from './index.js';

describe('claude boundary', () => {
  it('drops hostile text and preserves only category metadata', () => {
    const result = normalizeClaudeHook({
      hook: 'PostToolUse',
      session_id: 's',
      tool_name: 'Read',
      command: 'CANARY',
      output: 'CANARY',
    });
    expect(result).toMatchObject({ phase: 'tool', category: 'read', toolName: 'read' });
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });
  it('fails closed for malformed values without throwing', () => {
    expect(normalizeClaudeHook(null).phase).toBe('unknown');
    expect(claudeCapabilities(false).tasks.availability).toBe('unsupported');
  });

  it('covers every pinned hook and never returns native canaries', () => {
    const hooks = [
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'PermissionRequest',
      'PermissionDenied',
      'TaskCreated',
      'TaskCompleted',
      'SubagentStart',
      'SubagentStop',
      'Stop',
      'StopFailure',
      'SessionEnd',
    ];
    for (const hook of hooks) {
      const result = normalizeClaudeLifecycle({
        hook,
        tool_name: 'Task',
        tool_use_id: 'opaque',
        success: true,
        prompt: 'CANARY',
        output: 'CANARY',
        command: 'CANARY',
      });
      expect(result.status).toBe('accepted');
      expect(JSON.stringify(result)).not.toContain('CANARY');
    }
  });

  it('does not turn validation or permission denial into execution failure', () => {
    const validation = normalizeClaudeHook({
      hook: 'PostToolUseFailure',
      reason: 'validation',
    });
    const permission = normalizeClaudeHook({
      hook: 'PostToolUseFailure',
      reason: 'permission',
    });
    expect(validation.failureClass).toBe('validation');
    expect(permission.failureClass).toBe('permission');
    expect(validation.finality).toBe('confirmed');
    expect(permission.finality).toBe('confirmed');
  });

  it('confirms task completion only from successful Task evidence', () => {
    expect(normalizeClaudeHook({ hook: 'TaskCompleted' }).taskEvidence).toBe('unconfirmed');
    expect(
      normalizeClaudeHook({ hook: 'TaskCompleted', tool_name: 'Task', success: true }).taskEvidence,
    ).toBe('confirmed');
  });

  it('detects per-session gaps and remains observational', () => {
    expect(detectClaudeCapabilities([{ hook: 'UserPromptSubmit' }]).tasks.availability).toBe(
      'unsupported',
    );
    expect(detectClaudeCapabilities([{ hook: 'TaskCreated' }]).tasks.availability).toBe('partial');
    expect(claudeHook({ hook: 'StopFailure', error: 'CANARY' })).toEqual({});
  });

  it('enforces byte, depth, property, getter, and proxy bounds', () => {
    const prefix = '{"hook":"Stop","note":"';
    const suffix = '"}';
    const exact =
      prefix + 'x'.repeat(32768 - new TextEncoder().encode(prefix + suffix).byteLength) + suffix;
    expect(new TextEncoder().encode(exact).byteLength).toBe(32768);
    expect(normalizeClaudeHook(exact).phase).toBe('stop');
    expect(normalizeClaudeHook(exact + 'x').phase).toBe('unknown');
    const getter = {} as Record<string, unknown>;
    Object.defineProperty(getter, 'hook', {
      get: () => {
        throw new Error('CANARY');
      },
    });
    expect(normalizeClaudeHook(getter).phase).toBe('unknown');
    const proxy = new Proxy(
      { hook: 'Stop' },
      {
        ownKeys: () => {
          throw new Error('CANARY');
        },
      },
    );
    expect(normalizeClaudeHook(proxy).phase).toBe('unknown');
    let deep: Record<string, unknown> = { hook: 'Stop' };
    for (let i = 0; i < 18; i++) deep = { nested: deep };
    expect(normalizeClaudeHook(deep).phase).toBe('unknown');
    expect(
      normalizeClaudeHook(Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`p${i}`, i])))
        .phase,
    ).toBe('unknown');
  });

  it('keeps blocked tasks, parallel tools, background agents, and stop failures honest', () => {
    const firstOperationId = 'oid1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const secondOperationId = 'oid1_BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const agentId = 'oid1_CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const parentAgentId = 'oid1_DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    expect(normalizeClaudeHook({ hook: 'TaskCreated' })).toMatchObject({
      taskEvidence: 'requested',
      finality: 'provisional',
    });
    expect(normalizeClaudeHook({ hook: 'TaskCompleted' }).taskEvidence).toBe('unconfirmed');

    const first = normalizeClaudeHook({
      hook: 'PreToolUse',
      tool_name: 'Read',
      tool_use_id: firstOperationId,
      agent_id: agentId,
    });
    const second = normalizeClaudeHook({
      hook: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: secondOperationId,
      agent_id: agentId,
    });
    expect(first).toMatchObject({ operationId: firstOperationId, agentId });
    expect(second).toMatchObject({ operationId: secondOperationId, agentId });

    expect(
      normalizeClaudeHook({
        hook: 'SubagentStart',
        agent_id: agentId,
        parent_agent_id: parentAgentId,
        background: true,
      }),
    ).toMatchObject({ nesting: 'nested', background: true, agentId, parentAgentId });
    expect(normalizeClaudeHook({ hook: 'StopFailure' })).toMatchObject({
      finality: 'failure',
      failureClass: 'execution',
    });
    expect(detectClaudeCapabilities([{ hook: 'UserPromptSubmit' }]).tasks.availability).toBe(
      'unsupported',
    );
  });
});
