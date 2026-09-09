/**
 * 校验 chapter-01.json 并把它注入 viewer.html。
 *
 *   bun run .agents/works/w00005-novel-understanding-spike/tasks/t02-novel-memory-model-design/scripts/build-viewer.ts
 *
 * 数据只有一份真源（chapter-01.json）；viewer.html 里的副本由本脚本写入，
 * 不要手改。校验用的是 schema.ts 的 validate()，与 viewer 内置的轻量校验器
 * 相互独立——两边都通过才算数。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, factLoad, storyOrder, type MemoryGraph } from '../schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const DATA = join(root, 'chapter-01.json');
const VIEW = join(root, 'viewer.html');

const raw = readFileSync(DATA, 'utf8');
const db = JSON.parse(raw) as MemoryGraph;
for (const episode of db.episodes) {
  const pointer = episode.sourcePointer;
  if (!pointer || pointer.chapter < 1 || pointer.paragraph.start < 1 || pointer.paragraph.end < pointer.paragraph.start) throw new Error(`Episode ${episode.id} 缺少有效 sourcePointer`);
}
const issues = validate(db);
const errors = issues.filter(i => i.level === 'error');
const warns = issues.filter(i => i.level === 'warn');

const counts = {
  kind: db.kinds.length,
  individual: db.individuals.length,
  predicate: db.predicates.length,
  fact: db.facts.length,
  episode: db.episodes.length,
  summary: db.summaries?.length ?? 0,
  question: db.questions?.length ?? 0,
  mention: db.mentions?.length ?? 0,
};

console.log('dataset  ' + DATA);
console.log('counts   ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
console.log('story    ' + storyOrder(db).join(' → '));
console.log('factload ' + factLoad(db).slice(0, 5).map(f => `${f.subject}:${f.live}/${f.total}`).join('  '));

const byStatus = db.facts.reduce<Record<string, number>>((a, f) => ((a[f.status] = (a[f.status] ?? 0) + 1), a), {});
console.log('status   ' + Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(' '));

for (const w of warns) console.log(`WARN  ${w.at}: ${w.message}`);
for (const e of errors) console.log(`ERROR ${e.at}: ${e.message}`);

if (errors.length) {
  console.log(`\n${errors.length} error(s) — viewer 未更新。`);
  process.exit(1);
}

const html = readFileSync(VIEW, 'utf8');
const open = '<script type="application/json" id="dataset">';
const close = '</' + 'script>';
const a = html.indexOf(open);
if (a < 0) { console.log('viewer.html 缺少 dataset 注入点'); process.exit(1); }
const b = html.indexOf(close, a);
const dataset = JSON.stringify(db).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
const next = html.slice(0, a + open.length) + '\n' + dataset + '\n' + html.slice(b);
if (next === html) console.log('\nviewer 已是最新。');
else { writeFileSync(VIEW, next, 'utf8'); console.log('\nviewer 已更新。'); }
console.log(`0 error / ${warns.length} warn`);

