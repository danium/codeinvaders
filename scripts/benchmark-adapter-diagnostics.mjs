import { buildAdapterDiagnostic } from '../packages/adapter-sdk/dist/index.js';

const RUNS = 50;
const P95_THRESHOLD_MS = 10;
const MAX_THRESHOLD_MS = 15;

function createMaximumShape() {
  const root = Object.create(null);
  root.code = 'native-input-invalid';

  // Exactly 1,024 records, each with at most 256 own properties.
  for (let childIndex = 0; childIndex < 255; childIndex += 1) {
    const child = Object.create(null);
    const grandchildCount = childIndex < 3 ? 4 : 3;
    for (let grandchildIndex = 0; grandchildIndex < grandchildCount; grandchildIndex += 1) {
      const grandchild = Object.create(null);
      for (let propertyIndex = 0; propertyIndex < 256; propertyIndex += 1)
        grandchild[`property-${childIndex}-${grandchildIndex}-${propertyIndex}`] = propertyIndex;
      child[`grandchild-${childIndex}-${grandchildIndex}`] = grandchild;
    }
    const fillerCount = 256 - grandchildCount;
    for (let propertyIndex = 0; propertyIndex < fillerCount; propertyIndex += 1)
      child[`filler-${childIndex}-${propertyIndex}`] = propertyIndex;
    root[`child-${childIndex}`] = child;
  }
  return root;
}

const input = createMaximumShape();
const durations = new Array(RUNS);
for (let run = 0; run < RUNS; run += 1) {
  const start = globalThis.process.hrtime.bigint();
  const diagnostic = buildAdapterDiagnostic(input);
  const elapsedMs = Number(globalThis.process.hrtime.bigint() - start) / 1_000_000;
  if (diagnostic.code !== 'diagnostic-invalid')
    throw new Error('maximum-shape diagnostic did not fail closed');
  durations[run] = elapsedMs;
}

durations.sort((left, right) => left - right);
const p95 = durations[Math.ceil(RUNS * 0.95) - 1];
const maximum = durations[RUNS - 1];
if (p95 === undefined || maximum === undefined) throw new Error('benchmark did not produce runs');

globalThis.console.log(
  `adapter diagnostics benchmark: runs=${RUNS} p95=${p95.toFixed(4)}ms max=${maximum.toFixed(4)}ms ` +
    `thresholds=${P95_THRESHOLD_MS}ms/${MAX_THRESHOLD_MS}ms`,
);
if (p95 > P95_THRESHOLD_MS || maximum > MAX_THRESHOLD_MS)
  throw new Error('adapter diagnostics benchmark exceeded its conservative latency thresholds');
