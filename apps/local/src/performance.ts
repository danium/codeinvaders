import type { AnimationIntent } from './mapper.js';
import { ArenaModel, coalesceEffects, reduceDensity } from './arena.js';

export interface PerformanceSample {
  readonly semanticEntities: number;
  readonly requestedEffects: number;
  readonly retainedEffects: number;
  readonly boundedEffects: boolean;
  readonly durationMs: number;
  /** Time from applying the fixture intents until the semantic snapshot is available. */
  readonly eventToPresentationMs: number;
  readonly semanticDrops: number;
  readonly memoryBytes?: number;
}
export function runArenaLoadProfile(
  semanticEntities = 100,
  cosmeticEffects = 300,
): PerformanceSample {
  const started = Date.now();
  const model = new ArenaModel({ maxEffects: cosmeticEffects });
  const intents: AnimationIntent[] = [];
  for (let index = 0; index < semanticEntities; index++)
    intents.push({
      version: 1,
      kind: 'task',
      entityId: `task:${index}`,
      semanticTime: index,
      seed: index,
      terminal: false,
      reversible: true,
      priority: 'semantic',
      status: 'in_progress',
      text: 'task',
    });
  for (let index = 0; index < cosmeticEffects; index++)
    intents.push({
      version: 1,
      kind: 'tool-charge',
      entityId: `operation:${index % Math.max(1, semanticEntities)}`,
      semanticTime: index,
      seed: index,
      terminal: false,
      reversible: true,
      priority: 'cosmetic',
      text: 'tool',
    });
  const presentationStarted = Date.now();
  const retained = reduceDensity(coalesceEffects(intents), cosmeticEffects);
  for (const intent of retained) model.apply(intent);
  const snapshot = model.snapshot();
  const eventToPresentationMs = Date.now() - presentationStarted;
  model.dispose();
  return {
    semanticEntities,
    requestedEffects: cosmeticEffects,
    retainedEffects: snapshot.effects,
    boundedEffects: snapshot.effects <= cosmeticEffects,
    durationMs: Date.now() - started,
    eventToPresentationMs,
    semanticDrops:
      intents.filter((intent) => intent.priority === 'semantic').length - snapshot.entities.length,
  };
}
