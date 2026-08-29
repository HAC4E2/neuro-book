/**
 * 小说记忆模型 · 数据结构 spike
 *
 * 这是 `memory-model.md` 第 4 节的机器可读形态。定位与该文档一致：
 * 全新模型，不复用 `packages/nb-memory/` 的类型，不受其既有决策约束。
 * 本文件不是业务源码，不导出给任何产品模块使用。
 *
 * 术语提醒：本文件的 `Fact` 指「可取代的语义属性」，不是 nb-memory 里
 * 同名的「发生过的事」。
 */

/* ═══ 基础 ═══════════════════════════════════════════════ */

export type ID = string;

/** 叙述位置。三条轴里唯一永远可得的一条，默认排序键。 */
export interface DiscoursePos {
  chapter: number;
  paragraph: number;
  sentence?: number;
}

/**
 * 故事时间。不存时间戳，存 Episode 引用——文本没给的时间坐标不编造。
 * 排序走 Episode.precedes 偏序。
 */
export type StoryTime =
  | { t: 'episode'; ep: ID }
  | { t: 'labeled'; label: string; ord?: number }
  | { t: 'relative'; anchor: ID; offset: string }
  | null;

export const compareDiscourse = (a: DiscoursePos, b: DiscoursePos): number =>
  a.chapter - b.chapter || a.paragraph - b.paragraph || (a.sentence ?? 0) - (b.sentence ?? 0);

/* ═══ 核心五类 ═══════════════════════════════════════════ */

/**
 * 身份判据。同一性断言只相对于某个类别才成立——问「A 和 B 是不是同一个」
 * 必须先问「同一个什么」。
 */
export type IdentityCriteria =
  | 'continuous'   // 连续存在，属性变化不改变身份。人、角色
  | 'lineage'      // 血缘性，内容全部重写后仍是同一个。文档、稿件
  | 'functional'   // 功能变了就是换了类别。器物、道具
  | 'nominal';     // 由约定的名称决定。组织、地点

export interface Kind {
  id: ID;
  name: string;
  parent?: ID;
  /** 是否为基本层次。对外呈现与默认标注都用基本层；压缩时先丢下位细节。 */
  basicLevel: boolean;
  identityCriteria: IdentityCriteria;
  /** 谓词白名单。不设它，抽取时候选谓词会从十几个膨胀成任意字符串。 */
  attributeSlots: ID[];
}

export type AliasRoute = 'name' | 'epithet' | 'description' | 'pronoun_binding';

export interface Alias {
  surface: string;
  route: AliasRoute;
  /**
   * 读者从文本第几处起知道这个称呼指向该个体。
   * 整个模型里最关键的一个字段：没有它，第一章的检索会泄漏第二十章才揭晓的身份。
   */
  since: DiscoursePos;
  confidence: number;
}

/** 同一性锚点。注意：没有任何内容字段——内容全在挂到它上面的 Fact 里。 */
export interface Individual {
  id: ID;
  kind: ID;
  /**
   * 读者从文本第几处起知道存在这么一个东西。
   * `Alias.since` 管的是「这个称呼指谁」，这个字段管的是「这个节点在不在」——
   * 少了它，第一段就能看见第五十段才出场的角色，只是它还没有名字。
   * v2 起必填。查询原语对缺失值保留「始终可见」的降级，好让 v1 数据仍能打开。
   */
  since: DiscoursePos;
  status: 'provisional' | 'established';
  aliases: Alias[];
  /** 合并后保留，旧引用仍可解析，也留下 split 回退的余地。 */
  mergedFrom?: ID[];
  note?: string;
}

export type Cardinality = 'single' | 'multi';
export type TemporalShape = 'point' | 'interval' | 'state';
export type Volatility = 'low' | 'medium' | 'high';

export interface RangeSpec {
  kinds?: ID[];
  literal?: boolean;
  number?: boolean;
  special?: boolean;
}

/**
 * 谓词是节点，不是自由字符串。它携带的规则决定新 Fact 该取代还是追加。
 * 这个问题必须由谓词自己回答，不能在写入时临时判断。
 */
export interface Predicate {
  id: ID;
  aliases: string[];
  domain: ID[];
  range: RangeSpec;
  /** single: 新值取代旧值并给旧值设失效时点。multi: 追加。 */
  cardinality: Cardinality;
  temporalShape: TemporalShape;
  inverseOf?: ID;
  symmetric?: boolean;
  defaultVolatility: Volatility;
  defaultCentrality: number;
  /** 某些谓词天生带认识论倾向：self_role 默认 claim，suspects 默认 belief。 */
  defaultStatus?: EpistemicStatus;
  note?: string;
}

/** 本模型区别于普通知识图谱的地方。 */
export type EpistemicStatus =
  | 'narrated'      // 叙述层认定为真
  | 'claim'         // 某角色声称
  | 'belief'        // 某角色相信
  | 'speculation'   // 某角色推测，自己也标明不确定
  | 'disputed'      // 文本明确悬置
  | 'inference';    // 读者或系统推断，非文本断言

/** 决定反例怎么处理：constitutive 允许「缺了一条腿」，statistical 不允许。 */
export type Modality = 'constitutive' | 'statistical' | 'stipulated';

/** 保留的 holder：world = 叙述层，reader = 读者/系统。其余必须是 Individual。 */
export const HOLDER_WORLD = 'world';
export const HOLDER_READER = 'reader';
export const RESERVED_HOLDERS = [HOLDER_WORLD, HOLDER_READER];

/**
 * 带标签联合。标签必需——它决定比较语义：两条 Fact 只有在主语相同、
 * 谓词相同、宾语类型可比时才构成冲突。
 */
export type ObjectValue =
  | { t: 'ref'; id: ID }
  | { t: 'kindref'; id: ID; quant: '∃' | '∀'; count?: number; unit?: string }
  | { t: 'literal'; v: string }
  | { t: 'number'; v: number; unit?: string }
  /** UNKNOWN = 文本明确留白，与「库里没有这条 Fact」是两回事。 */
  | { t: 'special'; v: 'UNKNOWN' | 'NONE' }
  /** 合法暂存态。规则：未解析的宾语不得参与默认查询。 */
  | { t: 'unresolved'; surface: string; candidates: ID[] };

export interface Fact {
  id: ID;
  subject: ID;              // Individual 或 Kind。必须是引用，不能是字符串
  predicate: ID;
  object: ObjectValue;

  status: EpistemicStatus;
  holder: ID;

  // 故事轴：世界的状态变迁
  validFrom?: ID;           // Episode
  validUntil?: ID;          // Episode

  // 叙述轴：撤销、修正、反转全部发生在这里
  assertedAt: DiscoursePos;
  retractedAt?: DiscoursePos;

  // 溯源。两者严格分开，后者不缓存、前提变动时失效
  evidence: ID[];           // 只能指向 Episode
  inferredFrom?: ID[];      // 只能指向 Fact

  // 强度三元组。会分离，不能合成一个数
  confidence: number;       // 多可能为真
  strength: number;         // 多容易被检索到。绝不能被读作 confidence
  support: number;          // 有多少证据

  modality: Modality;
  volatility: Volatility;
  /** 推翻一条 Fact 所需的证据量正比于 centrality × 既有 support。 */
  centrality: number;
}

export type ParticipantRole =
  | 'agent' | 'patient' | 'theme' | 'experiencer'
  | 'speaker' | 'addressee' | 'instrument' | 'location';

export interface Participation {
  entity: ID;
  role: ParticipantRole;
}

export interface EpisodeContext {
  chapter: string;
  scene?: string;
  location?: ID;
  pov?: ID;
}

export interface EpisodeSourcePointer {
  chapter: number;
  paragraph: { start: number; end: number };
}

export interface Episode {
  id: ID;
  discoursePos: DiscoursePos;
  storyTime?: StoryTime;
  duration?: string;

  /** 释义与原文段落指针。content 要求释义而非摘抄是为了可检索，不是隐私；指针不可变。 */
  content: string;
  sourcePointer: EpisodeSourcePointer;
  context: EpisodeContext;

  /** 让 Episode 成为情节记忆的唯一字段。没有它就只是带氛围的文本块。 */
  participants: Participation[];
  /** 顺序的权威来源，偏序。 */
  precedes: ID[];
  partOf?: ID;

  outcome?: string;
  valence: number;    // -1..1
  arousal: number;    // 0..1
  register: string[];
  /** 一个信号两个用途：场景切分依据 + 归档保留优先级。 */
  surprise: number;
}

/* ═══ 可选三类 ═══════════════════════════════════════════
   派生物 / 审计物。不建也能跑，加与不加不影响核心语义。 */

export interface Summary {
  id: ID;
  covers: ID[];
  grain: 'scene' | 'chapter' | 'arc';
  gist: string;
  /** MUTABLE。给可变的解释一个存放处，从而保住 Episode 的不可变。 */
  why: string;
  generatedAt: DiscoursePos;
  recomputable: boolean;
}

export interface Question {
  id: ID;
  text: string;
  /** textual = 文本明确悬置，作者欠读者的；reader_hypothesis = 我们自己的猜测。 */
  origin: 'textual' | 'reader_hypothesis';
  raisedAt: DiscoursePos;
  anchors: ID[];
  status: 'open' | 'resolved' | 'abandoned';
  resolvedBy?: ID;
  resolvedAt?: DiscoursePos;
}

export interface Mention {
  id: ID;
  surface: string;
  episode: ID;
  span: [number, number];
  resolvedTo?: ID;
  method: 'exact_alias' | 'coref_llm' | 'manual';
}

/* ═══ 库 ═════════════════════════════════════════════════ */

export interface MemoryGraph {
  meta: {
    schema: 'nbook.novel-memory/v2-spike';
    work: string;
    scope: string;
    provenance: 'hand-authored' | 'extracted';
    note?: string;
  };
  kinds: Kind[];
  individuals: Individual[];
  predicates: Predicate[];
  facts: Fact[];
  episodes: Episode[];
  summaries?: Summary[];
  questions?: Question[];
  mentions?: Mention[];
}

/* ═══ 查询原语 ═══════════════════════════════════════════
   两条轴各有一组。混用就是把倒叙和伏笔从模型里抹掉。 */

/** 读到叙述位置 `at` 为止，读者知道的事实。用于「读者什么时候知道…」。 */
export function factsKnownAt(g: MemoryGraph, at: DiscoursePos): Fact[] {
  return g.facts.filter(f =>
    compareDiscourse(f.assertedAt, at) <= 0 &&
    (!f.retractedAt || compareDiscourse(f.retractedAt, at) > 0));
}

/** 读到叙述位置 `at` 为止，某个称呼是否已知归属于该个体。 */
export function aliasesKnownAt(ind: Individual, at: DiscoursePos): Alias[] {
  return ind.aliases.filter(a => compareDiscourse(a.since, at) <= 0);
}

/** 读到 `at` 为止，这个个体在不在图上。没有 since 的按 v1 数据处理，视为始终可见。 */
export function individualKnownAt(ind: Individual, at: DiscoursePos): boolean {
  return !ind.since || compareDiscourse(ind.since, at) <= 0;
}

/**
 * 读到 `at` 为止的整张图。返回的仍是 `MemoryGraph`，所以 `validate()`、`factLoad()`、
 * 查看器、检索、抽取管线全都能原样跑在切片上，而且物理上看不见后文。
 * 切片自身必须 `validate()` 全绿——这是这个函数的正确性判据。
 *
 * 三层处理：
 *   Episode / Fact / Question / Summary / Mention   自带出生位置，按位置过滤
 *   Individual / Alias                              打戳，按 since 过滤
 *   Kind / Predicate                                **原样保留**。它们是词表不是内容，
 *                                                   「读者第几段才知道 located_in 存在」
 *                                                   不是一个有意义的问题
 *
 * 另有一类字段必须就地抹掉：`validUntil` / `retractedAt` / `resolvedAt` 是回写在原记录上的
 * 失效戳，指向的是后文。留着它们，切片就会「知道自己将来会被推翻」。
 */
export function snapshotAt(g: MemoryGraph, at: DiscoursePos): MemoryGraph {
  const episodes = g.episodes.filter(e => compareDiscourse(e.discoursePos, at) <= 0);
  const epIds = new Set(episodes.map(e => e.id));
  const factIds = new Set(factsKnownAt(g, at).map(f => f.id));

  const facts = factsKnownAt(g, at).map(f => {
    const s: Fact = { ...f };
    if (s.validUntil && !epIds.has(s.validUntil)) delete s.validUntil;   // 还没被取代
    if (s.retractedAt) delete s.retractedAt;                             // 还没被撤销
    if (s.inferredFrom) s.inferredFrom = s.inferredFrom.filter(x => factIds.has(x));
    return s;
  });

  return {
    ...g,
    meta: { ...g.meta, note: `${g.meta.note ? g.meta.note + ' | ' : ''}切片于 ${pos(at)}` },
    kinds: g.kinds,
    predicates: g.predicates,
    individuals: g.individuals
      .filter(i => individualKnownAt(i, at))
      .map(i => ({ ...i, aliases: aliasesKnownAt(i, at) })),
    facts,
    episodes: episodes.map(e => ({ ...e, precedes: e.precedes.filter(n => epIds.has(n)) })),
    summaries: g.summaries?.filter(s => compareDiscourse(s.generatedAt, at) <= 0),
    questions: g.questions
      ?.filter(q => compareDiscourse(q.raisedAt, at) <= 0)
      .map(q => (q.resolvedAt && compareDiscourse(q.resolvedAt, at) > 0)
        ? { ...q, status: 'open' as const, resolvedBy: undefined, resolvedAt: undefined }
        : q),
    mentions: g.mentions?.filter(m => epIds.has(m.episode)),
  };
}

/** 故事时间落在 `ep` 上时为真的事实。用于「她当时什么状态」。 */
export function factsValidDuring(g: MemoryGraph, ep: ID): Fact[] {
  const order = storyOrder(g);
  const k = order.indexOf(ep);
  if (k < 0) return [];
  return g.facts.filter(f => {
    const from = f.validFrom ? order.indexOf(f.validFrom) : -Infinity;
    const until = f.validUntil ? order.indexOf(f.validUntil) : Infinity;
    return from <= k && k < until;
  });
}

/** Episode.precedes 的拓扑序。有环时退回叙述序并在 validate 里报错。 */
export function storyOrder(g: MemoryGraph): ID[] {
  const indeg = new Map<ID, number>(g.episodes.map(e => [e.id, 0]));
  const adj = new Map<ID, ID[]>(g.episodes.map(e => [e.id, []]));
  for (const e of g.episodes) {
    for (const n of e.precedes) {
      if (!indeg.has(n)) continue;
      adj.get(e.id)!.push(n);
      indeg.set(n, indeg.get(n)! + 1);
    }
  }
  const byDiscourse = [...g.episodes].sort((a, b) => compareDiscourse(a.discoursePos, b.discoursePos));
  const queue = byDiscourse.filter(e => indeg.get(e.id) === 0).map(e => e.id);
  const out: ID[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const n of adj.get(id) ?? []) {
      indeg.set(n, indeg.get(n)! - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  return out.length === g.episodes.length ? out : byDiscourse.map(e => e.id);
}

/* ═══ 校验 ═══════════════════════════════════════════════ */

export interface Issue {
  level: 'error' | 'warn';
  at: string;
  message: string;
}

const STATUSES: EpistemicStatus[] = ['narrated', 'claim', 'belief', 'speculation', 'disputed', 'inference'];
const ROLES: ParticipantRole[] = ['agent', 'patient', 'theme', 'experiencer', 'speaker', 'addressee', 'instrument', 'location'];
const pos = (p: DiscoursePos) => `${p.chapter}·${p.paragraph}` + (p.sentence ? `·${p.sentence}` : '');
export function validate(g: MemoryGraph): Issue[] {
  const out: Issue[] = [];
  const err = (at: string, message: string) => out.push({ level: 'error', at, message });
  const warn = (at: string, message: string) => out.push({ level: 'warn', at, message });

  const checkUnique = (name: string, rows: Array<{id: ID}>) => {
    const seen = new Set<ID>();
    for (const row of rows) {
      if (seen.has(row.id)) err(row.id, `${name} id 重复 -> ${row.id}`);
      seen.add(row.id);
    }
  };
  checkUnique('kind', g.kinds);
  checkUnique('individual', g.individuals);
  checkUnique('predicate', g.predicates);
  checkUnique('fact', g.facts);
  checkUnique('episode', g.episodes);
  checkUnique('summary', g.summaries ?? []);
  checkUnique('question', g.questions ?? []);
  checkUnique('mention', g.mentions ?? []);

  const kinds = new Map(g.kinds.map(k => [k.id, k]));
  const inds = new Map(g.individuals.map(i => [i.id, i]));
  const preds = new Map(g.predicates.map(p => [p.id, p]));
  const eps = new Map(g.episodes.map(e => [e.id, e]));
  const facts = new Map(g.facts.map(f => [f.id, f]));
  const story = storyOrder(g);
  const subjects = (id: ID) => inds.has(id) || kinds.has(id);

  for (const k of g.kinds) {
    if (k.parent && !kinds.has(k.parent)) err(k.id, `parent 不存在 -> ${k.parent}`);
    for (const s of k.attributeSlots) if (!preds.has(s)) err(k.id, `attributeSlots 指向不存在的谓词 -> ${s}`);
  }

  for (const i of g.individuals) {
    if (!kinds.has(i.kind)) err(i.id, `kind 不存在 -> ${i.kind}`);
    for (const m of i.mergedFrom ?? []) if (!inds.has(m)) warn(i.id, `mergedFrom 指向不存在的个体 -> ${m}`);
    if (i.status === 'established' && i.aliases.length === 0) warn(i.id, 'established 个体没有任何别名');

    // since 不得晚于第一次被引用，否则切片时图上会出现指向不存在节点的边
    if (!i.since) {
      err(i.id, 'since 缺失。v2 起必填——没有它就切不出「读到第几段为止图上有什么」');
    } else {
      const refs: DiscoursePos[] = i.aliases.map(a => a.since);
      for (const f of g.facts) {
        if (f.subject === i.id || f.holder === i.id ||
            (f.object.t === 'ref' && f.object.id === i.id)) refs.push(f.assertedAt);
      }
      for (const e of g.episodes) {
        if (e.participants.some(p => p.entity === i.id) ||
            e.context.location === i.id || e.context.pov === i.id) refs.push(e.discoursePos);
      }
      for (const q of g.questions ?? []) if (q.anchors.includes(i.id)) refs.push(q.raisedAt);
      if (refs.length) {
        const first = refs.reduce((a, b) => compareDiscourse(a, b) <= 0 ? a : b);
        if (compareDiscourse(i.since, first) > 0)
          err(i.id, `since ${pos(i.since)} 晚于第一次被引用 ${pos(first)}`);
      }
    }
  }

  for (const p of g.predicates) {
    for (const d of p.domain) if (!kinds.has(d)) err(p.id, `domain 不存在 -> ${d}`);
    for (const r of p.range.kinds ?? []) if (!kinds.has(r)) err(p.id, `range 不存在 -> ${r}`);
    if (p.inverseOf && !preds.has(p.inverseOf)) err(p.id, `inverseOf 不存在 -> ${p.inverseOf}`);
    const q = p.inverseOf ? preds.get(p.inverseOf) : undefined;
    if (q) {
      if (q.inverseOf !== p.id) warn(p.id, `inverseOf 不对称：${p.id}->${q.id}，但 ${q.id}->${q.inverseOf ?? 'null'}`);
      // 真互逆的两个谓词，domain 与 range 应当互换。毫无交集说明它们只是「相关」，不是互逆
      const pr = p.range.kinds ?? [];
      if (pr.length && q.domain.length && !pr.some(x => q.domain.includes(x)))
        warn(p.id, `inverseOf 可疑：${p.id} 的 range [${pr}] 与 ${q.id} 的 domain [${q.domain}] 没有交集，互逆应当 domain/range 互换`);
    }
  }

  for (const f of g.facts) {
    if (!subjects(f.subject)) err(f.id, `subject 不存在 -> ${f.subject}`);
    const p = preds.get(f.predicate);
    if (!p) err(f.id, `predicate 未登记 -> ${f.predicate}`);
    if (!STATUSES.includes(f.status)) err(f.id, `status 不在枚举内 -> ${f.status}`);
    if (!RESERVED_HOLDERS.includes(f.holder) && !inds.has(f.holder)) err(f.id, `holder 不存在 -> ${f.holder}`);

    const o = f.object;
    if (o.t === 'ref' && !inds.has(o.id)) err(f.id, `object.ref 不存在 -> ${o.id}`);
    if (o.t === 'kindref' && !kinds.has(o.id)) err(f.id, `object.kindref 不存在 -> ${o.id}`);
    if (o.t === 'unresolved') warn(f.id, 'object 仍是 unresolved 暂存态，不得参与默认查询');

    // 规则 3：证据只能指向 Episode，派生内容永不能成为另一条派生内容的证据
    for (const e of f.evidence) if (!eps.has(e)) err(f.id, `evidence 不是 Episode -> ${e}`);
    for (const x of f.inferredFrom ?? []) if (!facts.has(x)) err(f.id, `inferredFrom 不是 Fact -> ${x}`);
    if (f.evidence.length && (f.inferredFrom ?? []).length) err(f.id, 'evidence 与 inferredFrom 同时非空，两者必须分开');
    if (f.status === 'inference' && !(f.inferredFrom ?? []).length) err(f.id, 'inference 没有 inferredFrom');
    if (f.status !== 'inference' && !f.evidence.length) err(f.id, `${f.status} 没有 evidence`);

    if (f.validFrom && !eps.has(f.validFrom)) err(f.id, `validFrom 不是 Episode -> ${f.validFrom}`);
    if (f.validUntil && !eps.has(f.validUntil)) err(f.id, `validUntil 不是 Episode -> ${f.validUntil}`);
    if (f.validFrom && f.validUntil) {
      const from = story.indexOf(f.validFrom);
      const until = story.indexOf(f.validUntil);
      if (from < 0 || until < 0 || from >= until) err(f.id, 'validFrom 不得晚于或等于 validUntil');
    }
    if (f.retractedAt && compareDiscourse(f.assertedAt, f.retractedAt) > 0) err(f.id, 'retractedAt 早于 assertedAt');

    // 断言位置不得早于自己的依据——早了就是「读者还没看到依据，却已经知道结论」
    const src: DiscoursePos[] = [
      ...f.evidence.map(e => eps.get(e)?.discoursePos),
      ...(f.inferredFrom ?? []).map(x => facts.get(x)?.assertedAt),
    ].filter((p): p is DiscoursePos => !!p);
    if (src.length) {
      const last = src.reduce((a, b) => compareDiscourse(a, b) >= 0 ? a : b);
      if (compareDiscourse(f.assertedAt, last) < 0)
        warn(f.id, `assertedAt ${pos(f.assertedAt)} 早于依据位置 ${pos(last)}`);
    }

    for (const [n, v] of [['confidence', f.confidence], ['strength', f.strength], ['centrality', f.centrality]] as const) {
      if (v < 0 || v > 1) err(f.id, `${n} 越界 -> ${v}`);
    }
    if (f.support < 0) err(f.id, `support 为负 -> ${f.support}`);
  }

  for (const e of g.episodes) {
    for (const pt of e.participants) {
      if (!inds.has(pt.entity)) err(e.id, `participant 不存在 -> ${pt.entity}`);
      if (!ROLES.includes(pt.role)) err(e.id, `role 不在枚举内 -> ${pt.role}`);
    }
    for (const n of e.precedes) if (!eps.has(n)) err(e.id, `precedes 指向不存在的 Episode -> ${n}`);
    if (e.context.location && !inds.has(e.context.location)) err(e.id, `context.location 不存在 -> ${e.context.location}`);
    if (e.context.pov && !inds.has(e.context.pov)) err(e.id, `context.pov 不存在 -> ${e.context.pov}`);
    if (e.valence < -1 || e.valence > 1) err(e.id, `valence 越界 -> ${e.valence}`);
    if (e.arousal < 0 || e.arousal > 1) err(e.id, `arousal 越界 -> ${e.arousal}`);
    if (e.surprise < 0 || e.surprise > 1) err(e.id, `surprise 越界 -> ${e.surprise}`);
    if (e.storyTime && e.storyTime.t === 'episode' && !eps.has(e.storyTime.ep)) err(e.id, 'storyTime.ep 不存在');
    if (e.storyTime && e.storyTime.t === 'relative' && !eps.has(e.storyTime.anchor)) err(e.id, 'storyTime.anchor 不存在');
  }
  if (g.episodes.length && storyOrder(g).length !== g.episodes.length) {
    err('episodes', 'precedes 存在环，无法拓扑排序');
  }

  for (const q of g.questions ?? []) {
    for (const a of q.anchors) if (!subjects(a) && !eps.has(a)) err(q.id, `anchor 无法解析 -> ${a}`);
    if (q.status === 'resolved' && !q.resolvedBy) err(q.id, 'resolved 但没有 resolvedBy');
    if (q.resolvedBy && !facts.has(q.resolvedBy) && !eps.has(q.resolvedBy)) err(q.id, `resolvedBy 不是 Fact 或 Episode -> ${q.resolvedBy}`);
  }

  for (const s of g.summaries ?? []) {
    for (const c of s.covers) if (!eps.has(c)) err(s.id, `covers 不是 Episode -> ${c}`);
  }

  for (const m of g.mentions ?? []) {
    if (!eps.has(m.episode)) err(m.id, `episode 不存在 -> ${m.episode}`);
    if (m.resolvedTo && !inds.has(m.resolvedTo)) err(m.id, `resolvedTo 不存在 -> ${m.resolvedTo}`);
  }

  return out;
}

/** D7 的度量口径：单节点活跃 Fact 数。spike S1 就是在数这个。 */
export function factLoad(g: MemoryGraph): { subject: ID; live: number; total: number }[] {
  const acc = new Map<ID, { live: number; total: number }>();
  for (const f of g.facts) {
    const cur = acc.get(f.subject) ?? { live: 0, total: 0 };
    cur.total += 1;
    if (!f.validUntil && !f.retractedAt) cur.live += 1;
    acc.set(f.subject, cur);
  }
  return [...acc.entries()]
    .map(([subject, v]) => ({ subject, ...v }))
    .sort((a, b) => b.live - a.live);
}
