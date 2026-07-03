#!/usr/bin/env ts-node
/**
 * Refresh Covernor critic fixtures from Doctrine Lab injection holdout.
 *
 * Requires sibling checkout:
 *   ../thinking-DT/doctrine-lab  (or set DOCTRINE_LAB_ROOT)
 *
 * Usage:
 *   npm run fixtures:sync-doctrine
 *   DOCTRINE_LAB_ROOT=/path/to/doctrine-lab npm run fixtures:sync-doctrine
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const COVERNOR_ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(COVERNOR_ROOT, 'tests/fixtures/doctrine-critic-cases.json');

const DOCTRINE_CANDIDATES = [
  process.env.DOCTRINE_LAB_ROOT,
  path.resolve(COVERNOR_ROOT, '../thinking-DT/doctrine-lab'),
  path.resolve(COVERNOR_ROOT, '../doctrine-lab'),
].filter(Boolean) as string[];

function resolveDoctrineRoot(): string {
  for (const candidate of DOCTRINE_CANDIDATES) {
    const root = path.resolve(candidate);
    if (fs.existsSync(path.join(root, 'scripts/export_covernor_critic_fixtures.py'))) {
      return root;
    }
  }
  throw new Error(
    'Doctrine Lab not found. Set DOCTRINE_LAB_ROOT or clone doctrine-lab (e.g. ../thinking-DT/doctrine-lab).',
  );
}

function main(): void {
  const doctrineRoot = resolveDoctrineRoot();
  const script = path.join(doctrineRoot, 'scripts/export_covernor_critic_fixtures.py');
  execSync(`python3 "${script}" --out "${OUT_PATH}"`, {
    stdio: 'inherit',
    cwd: doctrineRoot,
  });
  const bundle = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) as { stats: { total: number; required: number } };
  console.log(`Synced ${bundle.stats.total} fixtures (${bundle.stats.required} required) -> ${OUT_PATH}`);
}

main();
