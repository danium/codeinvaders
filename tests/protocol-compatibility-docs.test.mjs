import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkerRelativePath = path.join('scripts', 'check-protocol-compatibility-docs.mjs');
const documentationRelativePath = path.join('docs', 'protocol-compatibility.md');
const protocolDistributionDirectory = path.join('packages', 'protocol', 'dist');

function runChecker(rootDirectory, write = false) {
  const argumentsList = [path.join(rootDirectory, checkerRelativePath)];
  if (write) argumentsList.push('--write');
  return execFileSync(process.execPath, argumentsList, {
    cwd: rootDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('protocol compatibility documentation gate', () => {
  it('fails closed on drift and produces idempotent isolated writes', async () => {
    execFileSync(
      process.execPath,
      [
        path.join(repositoryDirectory, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p',
        path.join(repositoryDirectory, 'packages', 'protocol', 'tsconfig.json'),
      ],
      {
        cwd: repositoryDirectory,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const realDocumentationPath = path.join(repositoryDirectory, documentationRelativePath);
    const realDocumentation = await readFile(realDocumentationPath, 'utf8');
    const temporaryRoot = await mkdtemp(
      path.join(repositoryDirectory, '.protocol-compatibility-docs-test-'),
    );

    try {
      await mkdir(path.join(temporaryRoot, 'scripts'), { recursive: true });
      await mkdir(path.join(temporaryRoot, 'docs'), { recursive: true });
      await mkdir(path.join(temporaryRoot, 'packages', 'protocol', 'node_modules'), {
        recursive: true,
      });
      await cp(
        path.join(repositoryDirectory, checkerRelativePath),
        path.join(temporaryRoot, checkerRelativePath),
      );
      await cp(realDocumentationPath, path.join(temporaryRoot, documentationRelativePath));
      await cp(
        path.join(repositoryDirectory, protocolDistributionDirectory),
        path.join(temporaryRoot, protocolDistributionDirectory),
        { recursive: true },
      );
      for (const dependency of ['ajv', 'ajv-formats']) {
        const dependencySource = await realpath(
          path.join(repositoryDirectory, 'packages', 'protocol', 'node_modules', dependency),
        );
        await cp(
          dependencySource,
          path.join(temporaryRoot, 'packages', 'protocol', 'node_modules', dependency),
          { recursive: true },
        );
      }

      expect(runChecker(temporaryRoot)).toContain('in sync');
      const originalTemporaryDocumentation = await readFile(
        path.join(temporaryRoot, documentationRelativePath),
        'utf8',
      );
      const driftedDocumentation = originalTemporaryDocumentation.replace(
        'x.a.b` is the minimum accepted form',
        'x.a.c` is the minimum accepted form',
      );
      expect(driftedDocumentation).not.toBe(originalTemporaryDocumentation);
      await writeFile(path.join(temporaryRoot, documentationRelativePath), driftedDocumentation);

      let failure;
      try {
        runChecker(temporaryRoot);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeDefined();
      expect(String(failure?.stderr)).toContain('out of date');
      expect(await readFile(path.join(temporaryRoot, documentationRelativePath), 'utf8')).toBe(
        driftedDocumentation,
      );
      expect(await readFile(realDocumentationPath, 'utf8')).toBe(realDocumentation);

      expect(runChecker(temporaryRoot, true)).toContain('updated');
      const generatedDocumentation = await readFile(
        path.join(temporaryRoot, documentationRelativePath),
        'utf8',
      );
      expect(runChecker(temporaryRoot, true)).not.toContain('updated');
      expect(await readFile(path.join(temporaryRoot, documentationRelativePath), 'utf8')).toBe(
        generatedDocumentation,
      );
      expect(await readFile(realDocumentationPath, 'utf8')).toBe(realDocumentation);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
