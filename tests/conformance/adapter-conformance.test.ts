import { describe, expect, it } from 'vitest';
import { readFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as codex from '../../packages/adapter-codex/src/index.js';
import * as claude from '../../packages/adapter-claude/src/index.js';
import { scanPrivacyCanaries } from '../../packages/adapter-sdk/src/index.js';
import { makeSnapshot, reduceEvents, writeSnapshot } from '../../packages/core/src/index.js';
import { LocalBroker } from '../../apps/local/src/index.js';
import {
  runGoldenScenario,
  nativeInputs,
  type AdapterSurface,
  type GoldenScenario,
} from './runner.js';

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures/conformance/golden-scenarios.json'), 'utf8'),
) as { readonly version: number; readonly scenarios: readonly GoldenScenario[] };

const surfaces: readonly AdapterSurface[] = [
  {
    name: 'codex',
    normalize: (input) => codex.normalizeCodexHook(input) as unknown as Record<string, unknown>,
    observe: codex.codexHook,
    capabilities: (inputs) => codex.detectCodexCapabilities(inputs),
  },
  {
    name: 'claude',
    normalize: (input) =>
      claude.normalizeClaudeLifecycle(input) as unknown as Record<string, unknown>,
    observe: claude.claudeHook,
    capabilities: (inputs) => claude.detectClaudeCapabilities(inputs),
  },
];

async function filesBelow(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile()) files.push(path);
    else if (entry.isDirectory() && !entry.isSymbolicLink())
      files.push(...(await filesBelow(path)));
  }
  return files;
}

describe('shared adapter conformance goldens', () => {
  it('loads a versioned sanitized scenario catalog', () => {
    expect(fixture.version).toBe(1);
    expect(fixture.scenarios.length).toBeGreaterThanOrEqual(8);
  });

  for (const surface of surfaces) {
    describe(surface.name, () => {
      for (const scenario of fixture.scenarios) {
        it(scenario.name, () => {
          const run = runGoldenScenario(surface, scenario);
          const observations = run.observations;
          expect(
            observations.map((observation) => observation.signal).filter((x) => x !== 'unknown'),
          ).toEqual(expect.arrayContaining([...scenario.signals]));

          if (scenario.requiresRejection) {
            expect(observations.some((observation) => !observation.accepted)).toBe(true);
          } else {
            expect(observations.every((observation) => observation.accepted)).toBe(true);
          }
          if (scenario.correlations) {
            expect(observations.map((observation) => observation.correlation)).toEqual(
              expect.arrayContaining([...scenario.correlations]),
            );
          }
          if (scenario.name === 'parallel-tools')
            expect(observations.every((observation) => observation.operationId !== undefined)).toBe(
              true,
            );
          if (scenario.capability) {
            const capability = surface.capabilities(nativeInputs(scenario, surface))[
              scenario.capability.signal as keyof ReturnType<AdapterSurface['capabilities']>
            ];
            expect(capability?.availability).toBe(scenario.capability.availability);
          }
          if (scenario.requiresFailureClassification)
            expect(
              observations.some(
                (observation) =>
                  observation.classification === 'failure' ||
                  observation.failureClass !== undefined,
              ),
            ).toBe(true);
          if (scenario.requiresNestedAgent)
            expect(observations.some((observation) => observation.signal === 'subagent')).toBe(
              true,
            );
          if (scenario.requiresNestedAgent && surface.name === 'claude')
            expect(observations.every((observation) => observation.agentId !== undefined)).toBe(
              true,
            );
          if (scenario.requiresPermissionEvidence)
            expect(
              observations.filter((observation) => observation.signal === 'permission'),
            ).toHaveLength(2);
          if (scenario.duplicateInputs)
            expect(JSON.stringify(run.results[0])).toBe(JSON.stringify(run.results[1]));
          if (scenario.canaries) {
            const serialized = JSON.stringify(run.results);
            for (const canary of scenario.canaries) expect(serialized).not.toContain(canary);
          }

          // Hook entries are observational and fail open for both delivery surfaces.
          for (const input of nativeInputs(scenario, surface)) {
            expect(surface.observe(input)).toEqual({});
          }
        });
      }
    });
  }

  it('normalizes equivalent completed tools into the same shared semantic observation', () => {
    const codexResult = runGoldenScenario(surfaces[0]!, {
      name: 'codex-equivalent',
      codex: [
        {
          hook: 'PostToolUse',
          toolUseId: 'oid1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          category: 'shell',
          duration_ms: 4,
        },
      ],
      claude: [],
      signals: ['tool'],
    }).observations[0];
    const claudeResult = runGoldenScenario(surfaces[1]!, {
      name: 'claude-equivalent',
      codex: [],
      claude: [
        {
          hook: 'PostToolUse',
          tool_name: 'Bash',
          tool_use_id: 'opaque-equivalent',
          duration_ms: 4,
          status: 'completed',
        },
      ],
      signals: ['tool'],
    }).observations[0];
    expect(codexResult).toMatchObject({
      accepted: true,
      signal: 'tool',
      classification: 'confirmed',
    });
    expect(claudeResult).toMatchObject({
      accepted: true,
      signal: 'tool',
      classification: 'confirmed',
    });
  });

  it('runs sensitive native fields through every production persistence writer', async () => {
    const scenario = fixture.scenarios.find(
      (candidate) => candidate.name === 'sensitive-native-fields',
    );
    expect(scenario?.canaries).toBeDefined();
    const root = await mkdtemp(join(process.cwd(), '.codex-conformance-'));
    const previousDataRoot = process.env.CODEINVADERS_DATA_DIR;
    process.env.CODEINVADERS_DATA_DIR = root;
    try {
      const codexInput = scenario!.codex[0]!;
      const claudeInput = scenario!.claude[0]!;
      await expect(codex.runDirectCodexHook(codexInput)).resolves.toMatchObject({
        status: 'spooled',
      });
      await expect(
        claude.runDirectClaudeHook({
          ...claudeInput,
          hook_event_name: claudeInput.hook,
          hook: undefined,
        }),
      ).resolves.toMatchObject({ status: 'spooled' });

      // Recovery exercises the real spool reader, per-stream EventJournal, and manifest writer.
      const broker = new LocalBroker({ dataRoot: root, port: 0 });
      await broker.start();
      await broker.stop();

      const firstPass = await filesBelow(root);
      const journalFiles = firstPass.filter((path) => path.endsWith('.jsonl'));
      const grouped = new Map<string, Record<string, unknown>[]>();
      for (const path of journalFiles) {
        for (const line of (await readFile(path, 'utf8')).split('\n').filter(Boolean)) {
          const event = JSON.parse(line) as Record<string, unknown> & {
            source: { streamId: string };
          };
          const events = grouped.get(event.source.streamId) ?? [];
          events.push(event);
          grouped.set(event.source.streamId, events);
        }
      }
      expect(grouped.size).toBeGreaterThanOrEqual(2);
      let snapshotIndex = 0;
      for (const [streamId, events] of grouped) {
        const state = reduceEvents(events as never[]);
        const snapshotPath = join(root, 'snapshots', `privacy-${snapshotIndex++}.snapshot.json`);
        await expect(
          writeSnapshot(snapshotPath, makeSnapshot(state, streamId)),
        ).resolves.toMatchObject({ ok: true });
      }

      // Invalid native input exercises the real bounded diagnostic writer with canaries present.
      await codex.runDirectCodexHook({ ...codexInput, hook: 'UnknownFutureHook' });

      const paths = await filesBelow(root);
      expect(paths.some((path) => path.endsWith('.ingress.retired'))).toBe(true);
      expect(paths.some((path) => path.endsWith('.jsonl'))).toBe(true);
      expect(paths.some((path) => path.endsWith('.snapshot.json'))).toBe(true);
      expect(paths.some((path) => path.endsWith('manifest.json'))).toBe(true);
      expect(paths.some((path) => path.endsWith('.diagnostic'))).toBe(true);

      const scan = await scanPrivacyCanaries(paths, scenario!.canaries!);
      expect(scan).toMatchObject({
        files: paths.length,
        checked: paths.length,
        leaked: false,
      });
      // Confirm the scanner would fail the release gate on a leaked artifact.
      const regression = paths[0]!;
      const existing = await readFile(regression, 'utf8');
      await writeFile(regression, `${existing}CANARY_PROMPT_001`, 'utf8');
      expect((await scanPrivacyCanaries([regression], scenario!.canaries!)).leaked).toBe(true);
    } finally {
      if (previousDataRoot === undefined) delete process.env.CODEINVADERS_DATA_DIR;
      else process.env.CODEINVADERS_DATA_DIR = previousDataRoot;
      await rm(root, { recursive: true, force: true });
    }
  });
});
