import { describe, expect, it } from 'vitest';
import {
  codexHook,
  CODEX_HOOKS,
  detectCodexCapabilities,
  normalizeCodexEvidence,
  normalizeCodexHook,
  normalizeCodexLifecycle,
  reconcileCodexPlan,
} from './index.js';

describe('Codex adapter boundary', () => {
  it('rejects unknown kinds without echoing hostile input', () => {
    const result = normalizeCodexLifecycle({ kind: 'CANARY_COMMAND', payload: 'CANARY_OUTPUT' });
    expect(result.status).toBe('rejected');
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });

  it('does not invoke hostile getters', () => {
    let touched = false;
    const input = Object.create(null) as { kind: string; payload: unknown };
    Object.defineProperty(input, 'kind', { value: 'tool.completed' });
    Object.defineProperty(input, 'payload', {
      get() {
        touched = true;
        throw new Error('secret');
      },
    });
    const result = normalizeCodexLifecycle(input);
    expect(result.status).toBe('accepted');
    expect(touched).toBe(false);
  });

  it('allowlists payload data and remains observational', () => {
    const result = normalizeCodexLifecycle({
      kind: 'tool.completed',
      payload: {
        name: 'shell',
        category: 'shell',
        durationMs: 3,
        output: 'CANARY_OUTPUT',
        command: 'CANARY_COMMAND',
      },
    });
    expect(result).toEqual({
      status: 'accepted',
      kind: 'tool.completed',
      payload: { name: 'shell', category: 'shell', durationMs: 3 },
    });
    expect(codexHook({ kind: 'tool.completed', payload: {} })).toEqual({});
    expect(Object.keys(codexHook({ kind: 'tool.completed', payload: {} }))).not.toEqual(
      expect.arrayContaining(['control', 'decision', 'context']),
    );
  });

  it('preserves truthful requested/active/quiescent/confirmed evidence', () => {
    expect(normalizeCodexEvidence({ kind: 'turn.requested', payload: {} }).evidence).toBe(
      'requested',
    );
    expect(normalizeCodexEvidence({ kind: 'tool.started', payload: {} }).evidence).toBe('active');
    expect(normalizeCodexEvidence({ kind: 'turn.quiescent', payload: {} }).evidence).toBe(
      'quiescent',
    );
    expect(normalizeCodexEvidence({ kind: 'tool.completed', payload: {} }).evidence).toBe(
      'confirmed',
    );
    expect(normalizeCodexEvidence({ kind: 'turn.quiescent', payload: {} }).payload).toEqual({
      reason: 'unknown',
    });
  });

  it('detects active coverage and hosted-tool gaps', () => {
    const signals = detectCodexCapabilities(['SessionStart', 'PreToolUse']);
    expect(signals.sessions.availability).toBe('partial');
    expect(signals.tools.availability).toBe('unsupported');
    expect(signals.tools.exclusions).toEqual([{ code: 'hosted-tools' }]);
  });

  it('publishes only the currently supported native hook names', () => {
    expect(CODEX_HOOKS).toEqual([
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PermissionRequest',
      'SubagentStart',
      'SubagentStop',
      'Stop',
      'PreCompact',
      'PostCompact',
    ]);
  });

  it('cancels removed plan identities without fuzzy terminal transfer', () => {
    const result = reconcileCodexPlan(
      [
        { nativeId: 'native-a', ordinal: 0, status: 'completed' },
        { nativeId: 'native-b', ordinal: 1, status: 'in_progress' },
      ],
      [{ nativeId: 'native-a', ordinal: 0, status: 'completed' }],
      3,
    );
    expect(result.revision).toBe(3);
    expect(result.items).toContainEqual(
      expect.objectContaining({ status: 'cancelled', cancellationRequired: true }),
    );
  });

  it('maps every pinned native hook class through the bounded parser', () => {
    const cases = [
      ['SessionStart', 'session.started'],
      ['SessionEnd', 'session.ended'],
      ['UserPromptSubmit', 'turn.requested'],
      ['PreToolUse', 'tool.requested'],
      ['PostToolUse', 'tool.completed'],
      ['PostToolUseFailure', 'tool.failed'],
      ['PermissionRequest', 'permission.requested'],
      ['PermissionResolved', 'permission.resolved'],
      ['SubagentStart', 'agent.spawned'],
      ['SubagentStop', 'agent.checkpoint'],
      ['Stop', 'turn.quiescent'],
      ['PreCompact', 'session.compacted'],
      ['PostCompact', 'session.compacted'],
      ['Compact', 'session.compacted'],
      ['TaskPlanUpdated', 'task.plan.reconciled'],
    ] as const;
    for (const [hook, kind] of cases) expect(normalizeCodexHook({ hook }).kind).toBe(kind);
    expect(normalizeCodexHook({ hook: 'PostToolUseFailure', exitCode: 9 }).payload).toEqual(
      expect.objectContaining({ failureClass: 'exit_nonzero' }),
    );
    expect(
      normalizeCodexHook({ hook: 'PostToolUse', toolUseId: 'raw-native-id' }).correlation,
    ).toBe('missing');
    expect(normalizeCodexHook({ hook: 'PermissionRequest', ambiguous: true }).correlation).toBe(
      'ambiguous',
    );
  });

  it('enforces exact UTF-8 hook size and hostile proxy/getter bounds', () => {
    const prefix = '{"hook":"Stop","pad":"';
    const suffix = '"}';
    const exact =
      prefix + 'x'.repeat(32768 - new TextEncoder().encode(prefix + suffix).byteLength) + suffix;
    expect(new TextEncoder().encode(exact).byteLength).toBe(32768);
    expect(normalizeCodexHook(exact).status).toBe('accepted');
    expect(normalizeCodexHook(exact + 'x').status).toBe('rejected');
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('hostile');
        },
        getOwnPropertyDescriptor: () => {
          throw new Error('hostile');
        },
      },
    );
    expect(normalizeCodexHook(hostile).status).toBe('rejected');
  });

  it('keeps blocked, rewritten, parallel, repeated-stop, restart, and missing-terminal evidence conservative', () => {
    const firstOperationId = 'oid1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const secondOperationId = 'oid1_BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const agentId = 'oid1_CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const parentAgentId = 'oid1_DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const requested = normalizeCodexHook({
      hook: 'PreToolUse',
      toolUseId: firstOperationId,
      toolName: 'shell',
    });
    expect(requested).toMatchObject({
      classification: 'provisional',
      correlation: 'native',
      operationId: firstOperationId,
    });
    expect(requested).not.toHaveProperty('terminal');

    const rewrittenCompletion = normalizeCodexHook({
      hook: 'PostToolUse',
      toolUseId: firstOperationId,
      toolName: 'read',
      output: 'CANARY_OUTPUT',
    });
    expect(rewrittenCompletion).toMatchObject({
      classification: 'confirmed',
      operationId: firstOperationId,
    });
    expect(JSON.stringify(rewrittenCompletion)).not.toContain('CANARY_OUTPUT');

    const parallel = normalizeCodexHook({
      hook: 'PreToolUse',
      toolUseId: secondOperationId,
      agentId,
    });
    expect(parallel).toMatchObject({ operationId: secondOperationId, agentId });
    expect(parallel.operationId).not.toBe(requested.operationId);

    const subagent = normalizeCodexHook({
      hook: 'SubagentStart',
      agentId,
      parentAgentId,
      role: 'worker',
      depth: 1,
    });
    expect(subagent).toMatchObject({ agentId, parentAgentId, classification: 'confirmed' });

    const firstStop = normalizeCodexHook({ hook: 'Stop', reason: 'native' });
    const secondStop = normalizeCodexHook({ hook: 'Stop', reason: 'native' });
    expect(firstStop.classification).toBe('quiescent');
    expect(secondStop.classification).toBe('quiescent');
    expect(firstStop.kind).not.toBe('turn.finished');

    expect(detectCodexCapabilities(['SessionStart']).tools.availability).toBe('unsupported');
    expect(detectCodexCapabilities([]).sessions.availability).toBe('unsupported');
  });
});
