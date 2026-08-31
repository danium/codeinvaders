import type { AnimationIntent } from './mapper.js';

export type ArenaEntityKind = 'carrier' | 'child-ship' | 'task' | 'fallback' | 'effect';
export interface ArenaEntity {
  readonly id: string;
  readonly kind: ArenaEntityKind;
  readonly status: string;
  readonly parentId?: string;
  readonly visible: boolean;
}
export interface ArenaSnapshot {
  readonly entities: readonly ArenaEntity[];
  readonly effects: number;
  readonly reducedMotion: boolean;
  readonly webgl: boolean;
}

/** A renderer-neutral scene model. A Three.js adapter can consume this without owning semantic state. */
export class ArenaModel {
  readonly maxEffects: number;
  private readonly entities = new Map<string, ArenaEntity>();
  private effects = 0;
  private reducedMotion = false;
  private webgl = true;
  constructor(options: { maxEffects?: number; reducedMotion?: boolean } = {}) {
    this.maxEffects = Math.max(1, Math.min(300, options.maxEffects ?? 300));
    this.reducedMotion = options.reducedMotion ?? false;
  }
  setWebGLAvailable(value: boolean): void {
    this.webgl = value;
  }
  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
  }
  apply(intent: AnimationIntent): void {
    if (
      intent.kind === 'tool-charge' ||
      intent.kind === 'success-impact' ||
      intent.kind === 'failure'
    ) {
      if (!this.reducedMotion) this.effects = Math.min(this.maxEffects, this.effects + 1);
    }
    const kind: ArenaEntityKind =
      intent.kind === 'carrier'
        ? 'carrier'
        : intent.kind === 'child-ship'
          ? 'child-ship'
          : intent.kind === 'fallback'
            ? 'fallback'
            : intent.kind === 'task' || intent.kind === 'correction'
              ? 'task'
              : 'effect';
    if (kind !== 'effect')
      this.entities.set(intent.entityId, {
        id: intent.entityId,
        kind,
        status: intent.status ?? 'active',
        ...(intent.parentId ? { parentId: intent.parentId } : {}),
        visible: true,
      });
    if (
      intent.terminal &&
      (intent.kind === 'success-impact' ||
        intent.kind === 'retreat' ||
        intent.kind === 'abandonment')
    ) {
      const existing = this.entities.get(intent.entityId);
      if (existing)
        this.entities.set(intent.entityId, {
          ...existing,
          status: intent.status ?? 'terminal',
          visible: intent.kind === 'success-impact' ? false : true,
        });
    }
  }
  tick(): void {
    if (this.effects > 0) this.effects--;
  }
  dispose(): void {
    this.entities.clear();
    this.effects = 0;
  }
  snapshot(): ArenaSnapshot {
    return {
      entities: [...this.entities.values()].sort((a, b) => a.id.localeCompare(b.id)),
      effects: this.effects,
      reducedMotion: this.reducedMotion,
      webgl: this.webgl,
    };
  }
}

export function reduceDensity(
  intents: readonly AnimationIntent[],
  maxEffects = 300,
): readonly AnimationIntent[] {
  const semantic = intents.filter((intent) => intent.priority === 'semantic');
  const cosmetic = intents.filter((intent) => intent.priority === 'cosmetic');
  return [
    ...semantic,
    ...cosmetic.slice(Math.max(0, cosmetic.length - Math.max(0, maxEffects - semantic.length))),
  ];
}

export function coalesceEffects(intents: readonly AnimationIntent[]): readonly AnimationIntent[] {
  const output: AnimationIntent[] = [];
  const index = new Map<string, number>();
  for (const intent of intents) {
    if (intent.priority === 'semantic') {
      output.push(intent);
      continue;
    }
    const key = `${intent.kind}:${intent.entityId}`;
    const prior = index.get(key);
    if (prior === undefined) {
      index.set(key, output.length);
      output.push(intent);
    } else output[prior] = intent;
  }
  return output;
}

export function semanticTimeAt(sequence: number, origin = 0): number {
  return Math.max(0, sequence - origin);
}
