import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, createLogger } from '../../plugins/grill-over-ticktick/lib/log.mjs';

test('redact replaces every occurrence of every secret, ignores empty secrets', () => {
  assert.equal(redact('a s1 b s1 c s2', ['s1', 's2', '']), 'a [redacted] b [redacted] c [redacted]');
  assert.equal(redact('nothing', []), 'nothing');
});

test('logger prefixes, redacts, and honours debug flag + addSecret', () => {
  /** @type {string[]} */ const lines = [];
  const stderr = /** @type {any} */ ({ write: (/** @type {string} */ s) => { lines.push(s); return true; } });
  const log = createLogger({ stderr, secrets: ['abc'] });
  log.warn('token abc leaked'); log.debug('hidden');
  log.addSecret('xyz'); log.warn('xyz');
  assert.deepEqual(lines, ['tt-grill: token [redacted] leaked\n', 'tt-grill: [redacted]\n']);
  const dbg = createLogger({ stderr, secrets: [], debug: true });
  dbg.debug('shown');
  assert.equal(lines.at(-1), 'tt-grill: shown\n');
});
