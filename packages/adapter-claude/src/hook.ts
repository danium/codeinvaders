import { runClaudeHookProcess } from './index.js';

/* The native hook response is intentionally always the exact empty object. */
let responded = false;
const deadline = setTimeout(() => {
  if (!responded) {
    responded = true;
    process.stdout.write('{}', () => process.exit(0));
  }
}, 245);
void runClaudeHookProcess()
  .catch(() => undefined)
  .finally(() => {
    clearTimeout(deadline);
    if (!responded) {
      responded = true;
      process.stdout.write('{}', () => process.exit(0));
    }
  });
