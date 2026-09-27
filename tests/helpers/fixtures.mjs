import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ticktick');
/** @param {string} name @returns {any} */
export function fixture(name) { return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')); }
/** @param {string} name @returns {any} */
export function body(name) { return fixture(name).response.body; }
