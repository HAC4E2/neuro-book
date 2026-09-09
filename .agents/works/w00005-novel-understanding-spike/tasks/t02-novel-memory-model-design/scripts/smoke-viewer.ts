/**
 * 无头冒烟测试：把两个页面在 jsdom 里跑起来，断言核心渲染与语义。
 *
 *   node .agents/works/w00005-novel-understanding-spike/tasks/t02-novel-memory-model-design/scripts/smoke-viewer.ts
 *
 * 必须用 node 跑，不能用 bun：bun 的 vm 实现与 jsdom 冲突
 * （Proxy is not allowed in the global prototype chain）。
 *
 * 覆盖：脚本能否无异常执行、节点/边/表格是否渲染、页面内置校验器是否与
 * schema.ts 的 validate 一致、别名的 since 是否随叙述位置生效、状态过滤是否真的减边。
 * 不覆盖：视觉呈现、字体、布局、真实浏览器行为。这些需要单独的浏览器人工验收授权。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const ok = (cond: unknown, label: string, detail = '') => {
  if (cond) console.log(`  pass  ${label}${detail ? '  · ' + detail : ''}`);
  else { failed++; console.log(`  FAIL  ${label}${detail ? '  · ' + detail : ''}`); }
};

function load(file: string) {
  const html = readFileSync(join(root, file), 'utf8');
  const errors: string[] = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // jsdom 不实现这两个，页面里都有降级分支，这里补最小桩以走到主路径
      (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      (window as any).SVGElement.prototype.setPointerCapture = () => {};
      (window as any).SVGElement.prototype.releasePointerCapture = () => {};
    },
  });
  return { dom, win: dom.window as any, doc: dom.window.document as any, errors };
}
const click = (win: any, node: any) => node?.dispatchEvent(new win.Event('click', { bubbles: true }));

/* ═══ viewer.html ═══════════════════════════════════════ */
console.log('viewer.html');
{
  const { dom, win, doc, errors } = load('viewer.html');
  ok(errors.length === 0, '脚本无未捕获异常', errors.join(' | '));

  const badge = doc.querySelector('#badge');
  ok(/校验通过/.test(badge.textContent), '页面内置校验器 0 错误', badge.textContent);
  const issues = JSON.parse(badge.dataset.issues ?? '[]');
  ok(issues.filter((i: any) => i.level === 'error').length === 0,
     '与 schema.ts 的 validate 结论一致', `${issues.length} warn`);

  ok(doc.querySelectorAll('#nodes .node').length === 16,
     '默认图层 = 9 Individual + 7 Kind', `nodes=${doc.querySelectorAll('#nodes .node').length}`);
  ok(doc.querySelectorAll('#edges g').length === 10,
     '引用型事实渲染成 10 条边', `edges=${doc.querySelectorAll('#edges g').length}`);
  ok(doc.querySelectorAll('#tabs .tab').length === 8, '八类记录都有入口');
  ok(doc.querySelectorAll('#list .item').length === 9, '默认列出 9 个 Individual');

  const slider = doc.querySelector('#slider');
  const setPos = (v: number) => { slider.value = String(v); slider.dispatchEvent(new win.Event('input', { bubbles: true })); };
  const labelOf = (id: string) => [...doc.querySelectorAll('#nodes .node')]
    .find((g: any) => g.dataset.node === id)?.querySelector('.node-lab')?.textContent ?? '';

  setPos(5);
  ok(labelOf('codex') === '黑色典籍', '第 5 段：古书还只有描述性称呼', labelOf('codex'));
  const early = doc.querySelectorAll('#edges g').length;
  setPos(27);
  ok(labelOf('codex') === '墨丘利秘典', '第 27 段：专名揭晓后节点改名', labelOf('codex'));
  setPos(64);
  const late = doc.querySelectorAll('#edges g').length;
  ok(early < late, '越往后读，图上的边越多', `${early} → ${late}`);

  const chip = [...doc.querySelectorAll('[data-st]')].find((c: any) => c.dataset.st === 'narrated');
  click(win, chip);
  const filtered = doc.querySelectorAll('#edges g').length;
  ok(filtered < late, '关掉 narrated 后边数下降', `${late} → ${filtered}`);
  click(win, chip);

  const first: Record<string, string> = {
    individual: 'su_tianqing', kind: 'person', predicate: 'inhabits', fact: 'F02',
    episode: 'E1', summary: 'S1', question: 'Q1', mention: 'M1',
  };
  let inspOk = 0;
  for (const k of Object.keys(first)) {
    click(win, [...doc.querySelectorAll('[data-tab]')].find((t: any) => t.dataset.tab === k));
    click(win, doc.querySelector(`.item[data-pick="${k}:${first[k]}"]`));
    const name = doc.querySelector('#insp .insp-name');
    if (name?.textContent.trim()) inspOk++;
    else console.log(`        ${k} 检视器为空`);
  }
  ok(inspOk === 8, '八类记录的检视器都渲染出内容', `${inspOk}/8`);

  click(win, [...doc.querySelectorAll('[data-tab]')].find((t: any) => t.dataset.tab === 'fact'));
  click(win, doc.querySelector('.item[data-pick="fact:F02"]'));
  const insp = doc.querySelector('#insp').textContent;
  const missing = ['STATUS', 'HOLDER', 'EVIDENCE', 'INFERRED_FROM', 'ASSERTED_AT', 'CENTRALITY', 'MODALITY']
    .filter(f => !insp.includes(f));
  ok(missing.length === 0, 'F02 检视器带出全部关键字段', missing.join(','));
  ok(insp.includes('speculation') && insp.includes('苏天晴'), 'F02 带出 status 与 holder');

  click(win, doc.querySelector('#btn-stats'));
  ok(doc.querySelector('#sheet').className.includes('open'), '统计面板可打开');
  ok(doc.querySelector('#sheet-body').textContent.includes('活跃'), '统计面板给出单节点 Fact 负载');

  dom.window.close();
}

/* ═══ chapter-01-graph.html ═════════════════════════════ */
console.log('\nchapter-01-graph.html');
{
  const { dom, doc, errors } = load('chapter-01-graph.html');
  ok(errors.length === 0, '脚本无未捕获异常', errors.join(' | '));
  ok(doc.querySelectorAll('#rails-top .ep-g').length === 8, '叙述轨 8 个场景');
  ok(doc.querySelectorAll('#rails-bot .ep-g').length === 8, '故事轨 8 个场景');
  ok(doc.querySelectorAll('#rails-ribbons .ribbon').length === 8, '8 条丝带');
  ok(doc.querySelectorAll('#g-nodes .g-node').length === 10, '图谱 10 个节点');
  ok(doc.querySelectorAll('#g-edges g').length === 10, '图谱 10 条边');
  ok(doc.querySelectorAll('#ep-tbody tr').length === 8, '场景表 8 行');
  ok(doc.querySelectorAll('#fact-tbody tr').length === 26, '事实表 26 行');
  ok(doc.querySelectorAll('#pred-tbody tr').length === 19, '谓词表 19 行');
  ok(doc.querySelectorAll('#q-tbody tr').length === 5, '未决表 5 行');
  ok(doc.querySelectorAll('#record-g div').length === 18, 'F02 全字段 18 格');
  ok(doc.querySelector('#side').textContent.includes('苏天晴'), '默认侧栏选中苏天晴');
  ok(doc.querySelector('#notation').textContent.includes('%speculation'), '记法区渲染出认识论标记');
  dom.window.close();
}

console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
process.exit(failed ? 1 : 0);
