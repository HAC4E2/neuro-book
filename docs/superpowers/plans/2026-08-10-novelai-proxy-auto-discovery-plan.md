# NovelAI Proxy Auto Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make only NovelAI HTTP requests automatically discover and use a working local/system HTTP proxy, while leaving LLM and generic Provider requests unchanged.

**Architecture:** Add a NovelAI-specific proxy resolver that selects a proxy URL from environment variables, Windows proxy configuration, or a bounded loopback port list. `requestNovelAiImages()` obtains one dispatcher per request batch and passes it explicitly into the existing safe Provider fetch; generic fetch no longer injects environment proxies on its own.

**Tech Stack:** Bun, Node `net`/`tls`/`child_process`, `undici.ProxyAgent`, Nitro server routes, Vitest, TypeScript.

## Global Constraints

- Proxy scope is limited to HTTP requests issued by the NovelAI image-generation adapter, including `/ai/generate-image` and `/ai/encode-vibe`.
- LLM `/chat/completions`, `/models`, queue persistence, Project files, and asset I/O must not use the NovelAI proxy resolver.
- Automatic discovery may use only valid HTTP/HTTPS proxy URLs and loopback candidates; it must not scan all ports or auto-select SOCKS proxies.
- Discovery probes must not send NovelAI Authorization headers, prompts, images, or user data.
- NovelAI scheduling, the 15-second minimum interval, 429 terminal failure, prompt deduplication, and asset write-back contracts remain unchanged.
- Do not stage the unrelated untracked planning scratch files `findings.md`, `progress.md`, or `task_plan.md`.

---

### Task 1: Add the NovelAI proxy resolver

**Files:**
- Create: `server/text-to-image/novelai-proxy.ts`
- Test: `server/text-to-image/novelai-proxy.test.ts`

**Interfaces:**

```typescript
export type NovelAiProxyResolver = {
    resolveDispatcher(): Promise<Dispatcher | undefined>;
    invalidate(): Promise<void>;
};

export type NovelAiProxyResolverOptions = {
    environment?: Readonly<Record<string, string | undefined>>;
    platform?: NodeJS.Platform;
    systemProxyUrls?: readonly string[];
    candidatePorts?: readonly number[];
    probe?: (proxyUrl: URL, targetHost: string, targetPort: number) => Promise<boolean>;
};

export function createNovelAiProxyResolver(options?: NovelAiProxyResolverOptions): NovelAiProxyResolver;
export function getNovelAiProxyResolver(): NovelAiProxyResolver;
export async function discoverNovelAiProxyUrl(options?: NovelAiProxyResolverOptions): Promise<string | null>;
export function parseWindowsProxyUrls(output: string): string[];
```

- [ ] **Step 1: Write the failing tests.** Verify environment proxy priority, `NEURO_BOOK_NOVELAI_PROXY_PORTS=10809,invalid,70000,1080` filtering, Windows `http=/https=/socks=` parsing with SOCKS excluded, and rejection of non-loopback environment URLs.
- [ ] **Step 2: Run the RED test.**

```powershell
bunx vitest run server/text-to-image/novelai-proxy.test.ts
```

Expected: FAIL because the resolver module and exports do not exist.

- [ ] **Step 3: Implement the resolver.** Check environment variables in order `HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY`, `http_proxy`, `ALL_PROXY`, `all_proxy`; then Windows user/WinHTTP proxy values; then `127.0.0.1` ports `7897,7890,10809,1080,8080,20170,2080`, replaced by the validated `NEURO_BOOK_NOVELAI_PROXY_PORTS` list when present. Probe candidates with a credential-free HTTP `CONNECT image.novelai.net:443`; construct and cache one `ProxyAgent` only after a successful probe. Use hidden `reg.exe`/ `netsh.exe` child processes only on Windows; inject system URLs in tests. `invalidate()` closes and clears the cached dispatcher.
- [ ] **Step 4: Run the GREEN test.**

```powershell
bunx vitest run server/text-to-image/novelai-proxy.test.ts
```

Expected: all resolver tests PASS.

- [ ] **Step 5: Commit the resolver.**

```powershell
git add -- server/text-to-image/novelai-proxy.ts server/text-to-image/novelai-proxy.test.ts
git -c user.name=Codex -c user.email=codex@localhost commit -m "feat: add NovelAI proxy discovery"
```

### Task 2: Keep generic Provider fetch direct and preserve connection causes

**Files:**
- Modify: `server/text-to-image/provider-fetch.ts:87-122`
- Test: `server/text-to-image/provider-fetch.test.ts`

- [ ] **Step 1: Write the failing tests.** A generic fetch with an injected `fetchImpl` must receive no dispatcher when the caller did not explicitly supply one, even when proxy environment variables exist. A rejected fetch with `code: "UND_ERR_CONNECT_TIMEOUT"` must produce `TextToImageProviderConnectionError`, include `image.novelai.net:443`, and expose the code without credentials.
- [ ] **Step 2: Run the RED test.**

```powershell
bunx vitest run server/text-to-image/provider-fetch.test.ts
```

Expected: the new scope and error assertions FAIL against the current global environment-proxy behavior and generic error.

- [ ] **Step 3: Implement the generic boundary change.** Use an explicitly supplied `dependencies.dispatcher` when present; otherwise use the existing safe direct dispatcher only for the real default fetch and never resolve environment proxies in this module. Add `TextToImageProviderConnectionError` with a safe target host/port, nested error code, and `cause`; keep policy errors and HTTP responses unchanged.
- [ ] **Step 4: Run the GREEN test.**

```powershell
bunx vitest run server/text-to-image/provider-fetch.test.ts
```

Expected: all existing URL/DNS/redirect tests plus the new tests PASS.

- [ ] **Step 5: Commit the boundary change.**

```powershell
git add -- server/text-to-image/provider-fetch.ts server/text-to-image/provider-fetch.test.ts
git -c user.name=Codex -c user.email=codex@localhost commit -m "fix: isolate NovelAI proxy from generic provider fetch"
```

### Task 3: Pass the dispatcher only through NovelAI requests

**Files:**
- Modify: `server/text-to-image/novelai-image-generation.ts:45-240`
- Test: `server/text-to-image/novelai-image-generation.test.ts`

- [ ] **Step 1: Write the failing tests.** Extend `NovelAiImageInput` test input with a fake `proxyResolver`; assert that `/ai/generate-image` receives the resolver dispatcher, that Vibe-enabled `/ai/encode-vibe` receives the same dispatcher, and that a connection error calls `invalidate()` while HTTP 401/429 does not.
- [ ] **Step 2: Run the RED test.**

```powershell
bunx vitest run server/text-to-image/novelai-image-generation.test.ts
```

Expected: the new assertions FAIL because NovelAI currently does not resolve a dedicated dispatcher.

- [ ] **Step 3: Implement the integration.** Add optional `proxyResolver?: NovelAiProxyResolver` to `NovelAiImageInput`; production defaults to `getNovelAiProxyResolver()`. Inside the scheduled request callback resolve one dispatcher before Vibe encoding, pass it in the existing Provider fetch dependencies for both NovelAI endpoints, and invalidate only after `TextToImageProviderConnectionError`. Do not change queue timing or HTTP status handling.
- [ ] **Step 4: Run the GREEN test.**

```powershell
bunx vitest run server/text-to-image/novelai-image-generation.test.ts
```

Expected: all existing payload/response/scheduler tests and the new scope tests PASS.

- [ ] **Step 5: Commit the integration.**

```powershell
git add -- server/text-to-image/novelai-image-generation.ts server/text-to-image/novelai-image-generation.test.ts
git -c user.name=Codex -c user.email=codex@localhost commit -m "feat: use proxy for NovelAI requests only"
```

### Task 4: Regression verification and status record

**Files:**
- Modify: `PROJECT-STATUS.md`
- Modify: `docs/tasks/142-text-to-image-chatu8-port/README.md`

- [ ] **Step 1: Run the focused server suites.**

```powershell
bunx vitest run server/text-to-image server/api/text-to-image
```

Expected: all tests PASS without real credentials or real generation requests.

- [ ] **Step 2: Run typecheck and whitespace validation.**

```powershell
bun run typecheck
git diff --check
```

Expected: typecheck exits `0` and diff check reports no errors.

- [ ] **Step 3: Record the implementation.** Document that automatic discovery is NovelAI-only, generic Provider fetch no longer consumes host proxy variables, and connection errors retain safe codes; keep real-provider/browser acceptance separate.
- [ ] **Step 4: Run the final focused gate.**

```powershell
bunx vitest run server/text-to-image/provider-fetch.test.ts server/text-to-image/novelai-proxy.test.ts server/text-to-image/novelai-image-generation.test.ts
bun run typecheck
```

Expected: all listed tests PASS and typecheck exits `0`.

- [ ] **Step 5: Commit the verified status record.**

```powershell
git add -- PROJECT-STATUS.md docs/tasks/142-text-to-image-chatu8-port/README.md
git -c user.name=Codex -c user.email=codex@localhost commit -m "docs: record NovelAI proxy routing"
```
