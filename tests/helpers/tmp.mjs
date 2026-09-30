import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/** @param {import('node:test').TestContext} t */
export function tmpDir(t) {
  const d = mkdtempSync(join(tmpdir(), 'tt-grill-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}
