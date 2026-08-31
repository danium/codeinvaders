import { describe, expect, it } from 'vitest';
import { benchmarkHookLifecycle } from '../../scripts/benchmark-hook-lifecycle.mjs';
import { profileOverload } from '../../scripts/profile-overload.mjs';

describe('release performance evidence', () => {
  it('measures shipped Codex and Claude hooks through direct child processes', async () => {
    const report = await benchmarkHookLifecycle({ iterations: 2, budgetMs: 250 });
    for (const agent of Object.values(report.agents)) {
      expect(agent.fallback.successful).toBe(report.iterations);
      expect(agent.fallback.spoolRecords).toBe(report.iterations);
      expect(agent.fallback.spoolBytes).toBeGreaterThan(0);
      expect(agent.ipc.successful).toBe(report.iterations);
      expect(agent.ipc.journalRecords).toBe(report.iterations);
      expect(agent.ipc.spoolRecords).toBe(0);
      expect(agent.deliveryPass).toBe(true);
      expect(agent.fallback.spoolBoundPass).toBe(true);
      expect(agent.ipc.spoolBoundPass).toBe(true);
      expect(agent.budgetPass).toBe(true);
      expect(agent.fallback.p95Ms).toBeLessThanOrEqual(report.budgetMs);
      expect(agent.ipc.p95Ms).toBeLessThanOrEqual(report.budgetMs);
    }
  }, 30_000);

  it('profiles sustained journal/replay load with no accepted-event loss', async () => {
    const report = await profileOverload({
      events: 200,
      maxHeapDeltaMb: 256,
      spoolAttempts: 20,
      spoolRecordLimit: 16,
    });
    expect(report.accepted).toBe(report.events);
    expect(report.replayFrames).toBe(report.events);
    expect(report.noSemanticDrops).toBe(true);
    expect(report.journalSegments).toBeGreaterThan(1);
    expect(report.appendP95Ms).toBeGreaterThanOrEqual(0);
    expect(report.replaySeekMs).toBeGreaterThanOrEqual(0);
    expect(report.replaySeekLastSequence).toBe(100);
    expect(report.spoolOverflowObserved).toBe(true);
    expect(report.spoolAccepted).toBe(16);
    expect(report.spoolFull).toBe(4);
    expect(report.boundedMemoryPass).toBe(true);
  }, 30_000);
});
