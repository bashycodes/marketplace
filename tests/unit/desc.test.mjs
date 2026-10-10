import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise, hashText, buildDesc, parseDesc, buildItems, classifyItems, OTHER_TITLE, KEY_RE, prefixTitle, parseTitlePrefix, taskUrl, LINK_FIELD, nextLine } from '../../plugins/grill-over-ticktick/lib/desc.mjs';

const Q = { key: 'r2.1', context: 'Where does the token live?\nTwo options matter.', rec: { label: '~/.config/tt-grill/token', why: 'survives uninstall' } };

test('normalise: CRLF, trailing spaces, trailing blank lines', () => {
  assert.equal(normalise('a  \r\nb\t\r\n\r\n\n'), 'a\nb');
  assert.equal(normalise(''), '');
});

test('hashText is 8 lowercase hex and stable across normalisation', () => {
  assert.match(hashText('x'), /^[0-9a-f]{8}$/);
  assert.equal(hashText('a \r\nb\n\n'), hashText('a\nb'));
});

test('buildDesc has the exact layout and a footer that parses back unchanged', () => {
  const d = buildDesc(Q);
  assert.equal(d, `Where does the token live?\nTwo options matter.\n\n⭐ Recommended: ~/.config/tt-grill/token — survives uninstall\n\n✍️ Answer:\n\n⌁ r2.1 ${hashText('Where does the token live?\nTwo options matter.\n\n⭐ Recommended: ~/.config/tt-grill/token — survives uninstall\n\n✍️ Answer:')}`);
  const p = parseDesc(d);
  assert.equal(p.key, 'r2.1'); assert.equal(p.changed, false); assert.equal(p.answerText, '');
});

test('normalises CRLF and trailing whitespace before hashing (app re-serialisation is not an edit)', () => {
  const d = buildDesc(Q).replace(/\n/g, '\r\n') + '\r\n\r\n';
  const mangled = d.split('\r\n').map((l) => l + '  ').join('\r\n');
  assert.equal(parseDesc(mangled).changed, false);
});

test('typed answer → changed:true and answerText (inline and next-line)', () => {
  const d = buildDesc(Q);
  const nextLine = d.replace('✍️ Answer:\n', '✍️ Answer:\nenv only, laptop is shared\n');
  assert.equal(parseDesc(nextLine).changed, true);
  assert.equal(parseDesc(nextLine).answerText, 'env only, laptop is shared');
  const inline = d.replace('✍️ Answer:', '✍️ Answer: file');
  assert.equal(parseDesc(inline).answerText, 'file');
  assert.equal(parseDesc(inline).key, 'r2.1');
});

test('edited context (not the answer) still counts as changed; marker removed → answerText null', () => {
  const d = buildDesc(Q).replace('Two options', 'Three options');
  assert.equal(parseDesc(d).changed, true);
  const noMarker = buildDesc(Q).replace('✍️ Answer:', '');
  assert.equal(parseDesc(noMarker).answerText, null); assert.equal(parseDesc(noMarker).changed, true);
});

test('missing/garbled footer → key null, changed true; empty desc handled', () => {
  assert.deepEqual(parseDesc(undefined), { key: null, hash: null, body: '', changed: true, answerText: null });
  const p = parseDesc('hello\n⌁ r1.1 zzzzzzzz');
  assert.equal(p.key, null); assert.equal(p.changed, true);
});

test('footer must be the last non-blank line', () => {
  const d = buildDesc(Q) + '\n\nps: typed below';
  assert.equal(parseDesc(d).key, null);
});

test('buildItems: rec first with ⭐, others in order, Other last, no duplicate of rec', () => {
  assert.deepEqual(buildItems(['a', 'b', 'c'], 'b'), [{ title: '⭐ b' }, { title: 'a' }, { title: 'c' }, { title: OTHER_TITLE }]);
});

test('classifyItems maps status 1 → ticked and flags rec/other', () => {
  assert.deepEqual(classifyItems([{ title: '⭐ b', status: 1 }, { title: 'a', status: 0 }, { title: OTHER_TITLE }]), [
    { title: '⭐ b', ticked: true, isRec: true, isOther: false },
    { title: 'a', ticked: false, isRec: false, isOther: false },
    { title: OTHER_TITLE, ticked: false, isRec: false, isOther: true },
  ]);
  assert.deepEqual(classifyItems(undefined), []);
});

test('KEY_RE', () => { assert.ok(KEY_RE.test('r10.3')); assert.ok(!KEY_RE.test('r1')); assert.ok(!KEY_RE.test('R1.1')); });

test('TickTick markdown escaping of punctuation is not an edit', () => {
  const d = buildDesc({
    key: 'r1.3',
    context: 'Spec §11 kept the door open. Options range from a thin hand-back (grill result → /wayfinder in the terminal) to the full map/tickets/columns design in TickTick.',
    rec: { label: 'full wayfinder map + tickets in TickTick', why: 'that was the original goal; v1 already preserved the host abstraction and block-last contract for it' },
  });
  const lines = d.split('\n');
  const footer = lines.pop();
  const escaped = lines.join('\n').replace(/[().+]/g, (c) => `\\${c}`) + '\n' + footer;
  const p = parseDesc(escaped);
  assert.equal(p.changed, false);
  assert.equal(p.answerText, '');
  assert.equal(p.key, 'r1.3');
});

test('typed answer after the marker still gives changed:true with the text even when the rest is escaped', () => {
  const d = buildDesc({
    key: 'r1.3',
    context: 'Spec §11 kept the door open. Options range from a thin hand-back (grill result → /wayfinder in the terminal) to the full map/tickets/columns design in TickTick.',
    rec: { label: 'full wayfinder map + tickets in TickTick', why: 'that was the original goal; v1 already preserved the host abstraction and block-last contract for it' },
  });
  const withAnswer = d.replace('✍️ Answer:', '✍️ Answer: full wayfinder map + tickets');
  const lines = withAnswer.split('\n');
  const footer = lines.pop();
  const escaped = lines.join('\n').replace(/[().+]/g, (c) => `\\${c}`) + '\n' + footer;
  const p = parseDesc(escaped);
  assert.equal(p.changed, true);
  assert.equal(p.answerText, 'full wayfinder map + tickets');
});

test('normalise strips TickTick-style backslash escapes around markdown punctuation', () => {
  assert.equal(normalise('a \\(b\\) \\*c\\*'), 'a (b) *c*');
});

const NEXT = { label: '(2/3) Which columns does a phase-2 map list get?', url: taskUrl('p1', 't9') };

test('buildDesc with next: link line sits between the marker and the footer, covered by the hash', () => {
  const d = buildDesc({ ...Q, next: NEXT });
  const body = 'Where does the token live?\nTwo options matter.\n\n⭐ Recommended: ~/.config/tt-grill/token — survives uninstall\n\n✍️ Answer:\n\nNext → [(2/3) Which columns does a phase-2 map list get?](https://ticktick.com/webapp/#p/p1/tasks/t9)';
  assert.equal(d, `${body}\n\n⌁ r2.1 ${hashText(body)}`);
  assert.deepEqual([parseDesc(d).changed, parseDesc(d).answerText, parseDesc(d).key], [false, '', 'r2.1']);
  assert.equal(parseDesc(d.replace('t9)', 't8)')).changed, true);   // editing the link is an edit
  assert.equal(LINK_FIELD, 'desc');
});

test('parseDesc: answerText stops at the Next line (typed above it is captured, the link is not)', () => {
  const d = buildDesc({ ...Q, next: NEXT });
  const typed = d.replace('✍️ Answer:\n', '✍️ Answer:\nenv only\nsecond line\n');
  assert.deepEqual([parseDesc(typed).changed, parseDesc(typed).answerText], [true, 'env only\nsecond line']);
  assert.equal(parseDesc(d.replace('✍️ Answer:', '✍️ Answer: file')).answerText, 'file');
});

test('Next link survives TickTick markdown escaping: not an edit, answerText empty', () => {
  const d = buildDesc({ ...Q, next: NEXT });
  const lines = d.split('\n'); const footer = lines.pop();
  const escaped = lines.join('\n').replace(/[()[\]#.\-]/g, (c) => `\\${c}`) + '\n' + footer;
  assert.deepEqual([parseDesc(escaped).changed, parseDesc(escaped).answerText], [false, '']);
});

test('prefixTitle / parseTitlePrefix', () => {
  assert.equal(prefixTitle('Which columns?', 2, 3), '(2/3) Which columns?');
  assert.deepEqual(parseTitlePrefix('(2/3) Which columns?'), { position: 2, total: 3 });
  assert.deepEqual(parseTitlePrefix('\\[12/30\\] x'), { position: 12, total: 30 });   // 1.0.x titles, server-escaped
  assert.deepEqual(parseTitlePrefix('[4/9] x'), { position: 4, total: 9 });
  assert.deepEqual(parseTitlePrefix('\\(12/30\\) x'), { position: 12, total: 30 });
  assert.equal(prefixTitle('t', 1, 2).includes('['), false, 'a bracket in the title breaks task chips in the Android app');
  assert.deepEqual(parseTitlePrefix('Which columns?'), { position: null, total: null });
  assert.deepEqual(parseTitlePrefix(null), { position: null, total: null });
});

test('backslash-punctuation in context round-trips unchanged (normalised once)', () => {
  for (const context of ['path a\\\\*b', 'C:\\\\(x)', 'C:\\(x)', 'regex \\\\d+ and \\\\server\\share']) {
    for (const next of [null, { label: 'q2', url: taskUrl('p1', 't2') }]) {
      const p = parseDesc(buildDesc({ ...Q, context, next }));
      assert.equal(p.changed, false, `${context} next=${!!next}`);
      assert.equal(p.answerText, '');
      assert.equal(p.key, 'r2.1');
    }
  }
});

test('classifyItems tolerates a missing/null title', () => {
  assert.deepEqual(classifyItems(/** @type {any} */ ([{}, { title: null, status: 1 }])), [
    { title: '', ticked: false, isRec: false, isOther: false },
    { title: '', ticked: true, isRec: false, isOther: false },
  ]);
});

test('Next label: free-form brackets go fullwidth; hashes unchanged, even escaped', () => {
  const next = { label: '(1/2) foo]bar [x] (y)', url: taskUrl('p1', 't2') };
  assert.equal(nextLine(next), `Next → [(1/2) foo］bar ［x］ (y)](${next.url})`);
  const d = buildDesc({ ...Q, next });
  const p = parseDesc(d);
  assert.equal(p.changed, false); assert.equal(p.answerText, '');
  const lines = d.split('\n'); const footer = lines.pop();
  const escaped = lines.join('\n').replace(/[()[\]#.\-]/g, (c) => `\\${c}`) + '\n' + footer;
  assert.equal(parseDesc(escaped).changed, false);
  const typed = d.replace('✍️ Answer:', '✍️ Answer: mine');
  assert.equal(parseDesc(typed).answerText, 'mine');
});
