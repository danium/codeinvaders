import { runCodexHookProcess } from './index.js';

/* The native hook response is intentionally always the exact empty object. */
let responded = false;
const deadline = setTimeout(() => {
  if (!responded) {
    responded = true;
    process.stdout.write('{}', () => process.exit(0));
  }
}, 245);
void runCodexHookProcess()
  .catch(() => undefined)
  .finally(() => {
    clearTimeout(deadline);
    if (!responded) {
      responded = true;
      process.stdout.write('{}', () => process.exit(0));
    }
  });
