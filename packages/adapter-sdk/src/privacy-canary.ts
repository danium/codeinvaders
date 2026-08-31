import { promises as fs } from 'node:fs';

export type CanaryScanResult = Readonly<{
  files: number;
  canaries: number;
  leaked: boolean;
  checked: number;
}>;

/** Scans explicitly supplied artifacts and returns counts, never paths or contents. */
export async function scanPrivacyCanaries(
  paths: readonly string[],
  canaries: readonly string[],
): Promise<CanaryScanResult> {
  let checked = 0;
  let leaked = false;
  for (const path of paths.slice(0, 128)) {
    try {
      const content = await fs.readFile(path, 'utf8');
      checked += 1;
      for (const canary of canaries.slice(0, 256))
        if (canary.length > 0 && content.includes(canary)) leaked = true;
    } catch {
      /* absent/unreadable artifacts are not disclosed */
    }
  }
  return Object.freeze({
    files: Math.min(paths.length, 128),
    canaries: Math.min(canaries.length, 256),
    leaked,
    checked,
  });
}
