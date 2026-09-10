import assert from 'node:assert/strict';

const FORMAL_IDS = Array.from({ length: 12 }, (_, i) => String(675 + i).padStart(4, '0'));
const TARGET_BASE_ID = '0684';

function normalizeFormalBaseId(name) {
  const normalized = name.normalize('NFKC').replace(/\\/g, '/').split('/').pop() || '';
  const m = normalized.match(/(?:^|[^0-9])(?:IMG[_\- ]*)?(067[5-9]|068[0-6])(?=[^0-9]|$)/i);
  return m ? m[1] : null;
}

function resolve(names) {
  if (names.length !== 12) return { target: null, reason: `formal-count:${names.length}` };
  const mapped = names.map((name) => ({ name, id: normalizeFormalBaseId(name) }));
  const ids = mapped.map((x) => x.id).filter(Boolean);
  const unique = new Set(ids);
  const coverage = FORMAL_IDS.every((id) => unique.has(id));
  const targets = mapped.filter((x) => x.id === TARGET_BASE_ID);
  if (!coverage || unique.size !== 12) return { target: null, reason: 'formal-mapping-incomplete-or-ambiguous' };
  if (targets.length !== 1) return { target: null, reason: `target-match-count:${targets.length}` };
  return { target: targets[0].name, reason: 'ok' };
}

for (const variant of ['IMG_0684(1).jpeg', 'IMG_0684.jpeg', 'IMG_0684.JPG', 'IMG_0684(4).jpg', 'img-0684.PNG', 'IMG 0684.heic']) {
  assert.equal(normalizeFormalBaseId(variant), '0684', variant);
}

const suffixes = ['(1).jpeg', '.jpeg', '.JPG', '(4).jpg', '.HEIC'];
const formal12 = FORMAL_IDS.map((id, i) => `IMG_${id}${suffixes[i % suffixes.length]}`);
const shuffled = [...formal12].sort((a, b) => b.localeCompare(a));
const solved = resolve(shuffled);
assert.equal(solved.reason, 'ok');
assert.equal(normalizeFormalBaseId(solved.target), '0684');

const duplicate = [...formal12];
duplicate[0] = 'IMG_0684(9).jpeg';
assert.equal(resolve(duplicate).target, null);
assert.equal(resolve(formal12.slice(0, 11)).target, null);

console.log('PASS Stage A21 target auto-resolver: suffix normalization, order independence, unique formal12 coverage, target=0684, ambiguous/incomplete STOP');
