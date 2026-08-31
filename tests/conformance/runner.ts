import type { CapabilityProfile } from '../../packages/protocol/src/index.js';

export type AdapterResult = Record<string, unknown>;

export interface AdapterSurface {
  readonly name: 'codex' | 'claude';
  readonly normalize: (input: unknown) => AdapterResult;
  readonly observe: (input: unknown) => unknown;
  readonly capabilities: (inputs: readonly unknown[]) => CapabilityProfile['signals'];
}

export interface GoldenScenario {
  readonly name: string;
  readonly codex: readonly unknown[];
  readonly claude: readonly unknown[];
  readonly signals: readonly string[];
  readonly capability?: Readonly<{ signal: string; availability: string }>;
  readonly correlations?: readonly string[];
  readonly canaries?: readonly string[];
  readonly duplicateInputs?: boolean;
  readonly requiresFailureClassification?: boolean;
  readonly requiresNestedAgent?: boolean;
  readonly requiresPermissionEvidence?: boolean;
  readonly requiresRejection?: boolean;
}

export interface AdapterObservation {
  readonly accepted: boolean;
  readonly signal: string;
  readonly classification?: string;
  readonly correlation?: string;
  readonly status?: string;
  readonly taskEvidence?: string;
  readonly failureClass?: string;
  readonly operationId?: string;
  readonly agentId?: string;
  readonly parentAgentId?: string;
}

/**
 * Projects either adapter's sanitized public result onto the shared AAP
 * vocabulary. It deliberately ignores native payloads and renderer concerns.
 */
export function summarizeAdapterResult(result: AdapterResult): AdapterObservation {
  const payload = (result.payload ?? result.observation ?? result) as Record<string, unknown>;
  const kind = typeof result.kind === 'string' ? result.kind : undefined;
  const phase = typeof payload.phase === 'string' ? payload.phase : undefined;
  const signal = phase
    ? phase === 'prompt'
      ? 'prompt'
      : phase === 'stop' || phase === 'stop-failure'
        ? 'quiescent'
        : phase
    : kind?.startsWith('turn.')
      ? kind === 'turn.quiescent'
        ? 'quiescent'
        : kind === 'turn.requested'
          ? 'prompt'
          : 'turn'
      : kind?.startsWith('tool.')
        ? 'tool'
        : kind?.startsWith('permission.')
          ? 'permission'
          : kind?.startsWith('agent.')
            ? 'subagent'
            : kind?.startsWith('task.')
              ? 'task'
              : kind?.startsWith('session.')
                ? 'session'
                : 'unknown';
  const classification =
    typeof result.classification === 'string'
      ? result.classification
      : typeof payload.finality === 'string'
        ? payload.finality
        : undefined;
  const correlation =
    typeof result.correlation === 'string'
      ? result.correlation
      : typeof payload.correlation === 'string'
        ? payload.correlation
        : undefined;
  return {
    accepted: result.status === undefined || result.status === 'accepted',
    signal,
    ...(classification === undefined ? {} : { classification }),
    ...(correlation === undefined ? {} : { correlation }),
    ...(typeof payload.status === 'string' ? { status: payload.status } : {}),
    ...(typeof payload.taskEvidence === 'string' ? { taskEvidence: payload.taskEvidence } : {}),
    ...(typeof payload.failureClass === 'string' ? { failureClass: payload.failureClass } : {}),
    ...(typeof result.operationId === 'string'
      ? { operationId: result.operationId }
      : typeof payload.operationId === 'string'
        ? { operationId: payload.operationId }
        : {}),
    ...(typeof result.agentId === 'string'
      ? { agentId: result.agentId }
      : typeof payload.agentId === 'string'
        ? { agentId: payload.agentId }
        : {}),
    ...(typeof result.parentAgentId === 'string'
      ? { parentAgentId: result.parentAgentId }
      : typeof payload.parentAgentId === 'string'
        ? { parentAgentId: payload.parentAgentId }
        : {}),
  };
}

export function runGoldenScenario(
  adapter: AdapterSurface,
  scenario: GoldenScenario,
): Readonly<{ results: readonly AdapterResult[]; observations: readonly AdapterObservation[] }> {
  const inputs = adapter.name === 'codex' ? scenario.codex : scenario.claude;
  const results = inputs.map((input) => adapter.normalize(input));
  return Object.freeze({ results, observations: results.map(summarizeAdapterResult) });
}

export function nativeInputs(
  scenario: GoldenScenario,
  adapter: AdapterSurface,
): readonly unknown[] {
  return adapter.name === 'codex' ? scenario.codex : scenario.claude;
}
