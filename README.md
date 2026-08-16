# dsh-session-caption

[简体中文](README.zh.md)

**Two-phase session captioning** (automatic naming) for DeepSeek Harness (dsh): while a session is active, a title is generated instantly from keywords; once idle, the cheapest capable model is called to refine it. Everything runs in the background without interrupting the main flow — no wasted spend on titles.

```
user sends message ──► [Phase 1] instant keyword captioning (zero cost, millisecond)
                           │
                           └─► session idle for 5s ──► [Phase 2] budget-model refinement + one-line summary
                                                          │
                                                          └─► written to session/title (traceable)
```

## Problem It Solves

New harness sessions are timestamp-numbered by default, making long session lists hard to scan. Existing approaches either only "wait for idle then generate" (no title while the user waits) or call the model every turn (expensive). This plugin splits the two ideas into complementary phases:

- **Phase 1 · Instant captioning**: the moment a user message lands, keywords are extracted from the latest message and a title appears with near-zero latency, **without calling any model**;
- **Phase 2 · Idle refinement**: once the session goes quiet, a single auxiliary call upgrades the title from a "keyword string" to a natural phrase and also produces a **one-line session summary** (within the same request, no extra billing);
- **Cost guardrail**: refinement defaults to the cheapest tier among registered models (`flash`/`haiku`/`mini` etc.), with explicit model override and full phase-2 disabling both available.

## Features

- **Two-phase pipeline**: instant keyword captioning → idle budget-model refinement, title evolves with the session;
- **Cost control**: budget routing picks and caches the cheapest model from the registered model directory by name pattern, invalidated automatically on model topology changes;
- **Original keyword algorithm**: noise stripping (code blocks/URLs/Markdown) → script detection (Latin/CJK) → stopword and function-word filtering → order-preserving/character-budget truncation, works for Chinese, English, Japanese, and Korean;
- **Multilingual**: title language follows the message language; Latin titles are length-capped by word count, CJK titles by character count;
- **Title deduplication**: identical titles are not written twice; cross-session duplicates get a numbered suffix automatically (`Fix Login Bug (2)`);
- **Summary integration**: refinement also produces a one-line session summary, written to the session log via the `session/caption-note` event for list UIs, export tools, etc.;
- **Respects manual titles**: automatic generation stops completely after a manual rename — never overrides (even a rename during an in-flight refinement call is not written back);
- **Zero-config to start**: defaults work out of the box; every behavior is tunable.

## Installing in DSH

Install the latest version into a profile from GitHub:

```sh
dsh plugin --profile demo add github:JohnXu22786/session-titler
```

Remove it:

```sh
dsh plugin --profile demo remove dsh-session-caption
```

This plugin is a standard dsh **bundle** (configuration layer + plugin code), installed into a profile via `dsh plugin`:

```sh
# install from a local directory (development / self-use)
dsh plugin --profile demo add /path/to/dsh-session-caption

# or install a packed tarball (same for tarball / git references)
npm pack
dsh plugin --profile demo add ./dsh-session-caption-0.1.0.tgz
```

On install, pnpm links the package into the profile's `node_modules`; `dsh` recognizes the `dsh.bundle` declaration in `package.json` and adds the `cordis.patch.yml` layer to `dsh.profile.bundles`. Takes effect after restart:

```sh
dsh --profile demo --dump-config   # should show the "session-caption" line
dsh
```

### How Loading Works (for harness developers)

1. **Bundle manifest**: `dsh.bundle.patch` in `package.json` points to `cordis.patch.yml` — the only required bundle metadata;
2. **Configuration layer**: `cordis.patch.yml` first disables the built-in single-phase title provider by line id (the session title service accepts only one provider at a time), then inserts this plugin's configuration line;
3. **Entry file**: `lib/src/index.js` exports the standard Cordis plugin contract — `name` (`session-caption`), `inject` (`['sessionTitle', 'sessions', 'llm']`), `Config` (schemastery validation schema), `apply(ctx, config)`;
4. **Capability registration**: `apply` registers the two-phase flow as the **sole provider** of `ctx.sessionTitle` (`automatic: 'all-user-messages'`), and also listens to `session/event` and `llm/adapters-updated`; all listeners, timers, and registrations are reclaimed automatically on plugin unload.

> Note: the `session-title` service is single-provider by design. If another plugin also registers a title provider, the two replace each other; this plugin's bundle layer disables the built-in `session-title-llm` line by default.

## Configuration

All fields are optional; defaults are listed below. Global config goes into `$DSH_HOME/cordis.patch.yml`, overridden by line id:

```yaml
# $DSH_HOME/cordis.patch.yml (home-level, applies to all profiles)
- id: session-caption
  config:
    instant:
      enabled: true        # phase 1 switch
      prefix: ''           # instant caption prefix, e.g. '⚡ '
      maxWords: 6          # max words for Latin titles
      maxCjkChars: 14      # max characters for CJK titles
    refine:
      enabled: true        # phase 2 switch
      maxWords: 5          # target words for refined titles (Latin)
      maxCjkChars: 10      # target characters for refined titles (CJK)
      maxInputBytes: 4096  # byte cap for refine input messages (after JSON framing)
      maxOutputTokens: 64  # token cap for refine output
      timeoutMs: 60000     # per-call timeout for refinement
    budget:
      preferCheap: true    # only pick from the low-cost model directory
      # patterns: [...]    # low-cost model name patterns (ordered by value)
    summary:
      enabled: true        # summary switch
      maxChars: 120        # max characters for the summary
    timing:
      idleDelayMs: 5000    # idle-detection delay (refine trigger point)
      activityWindowMs: 1500  # activity window after an event
      modelCacheMs: 120000    # budget routing cache duration
    model:
      provider: ''         # explicit refine routing (paired with model)
      model: ''            # e.g. deepseek-official / deepseek-v4-flash
    dedup:
      enabled: true        # title dedup (skip identical + cross-session numbering)
      suffix: '({n})'      # numbering suffix template, must contain {n} placeholder (from 2)
    debug: false           # debug logging
```

> With `instant.enabled` off, phase 1 no longer produces keyword titles, but phase 2 still only runs in the **idle window** (auto-generation requests during busy periods are skipped; the title is generated by the timer once the session quiets down) — it never becomes "call the model on every message".

### Model Selection Precedence (phase 2)

1. Explicit `model.provider` + `model.model` configuration;
2. With `budget.preferCheap` on, scan the model directories of all configurable providers, match by the pattern names in `budget.patterns`, and take the best (default order: `flash` → `haiku` → `lite` → `mini` → `nano` → `fast` → …; for the same tier, the shortest name wins), result cached for `timing.modelCacheMs`;
3. The session's own model route (`request.route`);
4. If none is available, skip refinement and keep the instant caption.

## Interface

### Provider

Registered on `ctx.sessionTitle`, `id` `session-caption`, automatic mode `all-user-messages`:

| Field | Value | Description |
| --- | --- | --- |
| `id` | `session-caption` | source identifier written to `session/title` events |
| `automatic` | `all-user-messages` | one generation per new user message |
| `generate(request)` | — | active → instant caption; idle → refinement |

`generate` receives `{ session, messages, route?, signal }` and returns `{ title, messageSeqs, model? }`. `CaptionSkippedError` is thrown in these cases (the service keeps the existing title, not treated as a failure):

- the user manually renamed (`source.kind === 'user'`);
- no extractable keywords in the instant phase;
- the refined result equals the current title (dedup; also marks the session as stable to avoid repeated generation);
- no usable model route.

### Events

| Event | Type | Description |
| --- | --- | --- |
| `session/title` | log-only (built into the harness) | snapshot of every accepted title, with source and message seq |
| `session/caption-note` | log-only (contributed by this plugin) | one-line summary on refinement: `{ title, note, messageSeqs }` |

Like `title`, `caption-note` never enters the model context; replay tools that don't recognize the event can safely skip it (informational record).

### Directory Structure

```
src/
├── index.ts       # plugin entry: name / inject / Config / apply
├── config.ts      # config schema and runtime validation
├── context.ts     # structured Harness context types
├── flow.ts        # two-phase orchestration (generate / event feeding / dedup / summary)
├── keywords.ts    # phase 1: keyword caption engine
├── refine.ts      # phase 2: budget-model refinement + summary
├── budget.ts      # cost routing: cheapest model selection and caching
├── pacemaker.ts   # idle pacemaker: activity awareness + refine timing
├── normalizer.ts  # title cleaning, length capping, comparison
├── language.ts    # Latin/CJK script detection
├── events.ts      # custom event declarations
└── errors.ts      # CaptionSkippedError: skipped refinements
```

## Development

```sh
npm install     # dev dependencies (incl. three forwarding packages under dev/pkgs, file: refs, reinstallable)
npm run typecheck   # tsc type checking
npm test            # vitest unit and flow tests (86 cases)
npm run build       # compile to lib/src/
```

> **Runtime dependency note**: at runtime the plugin uses `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-session-title`, which are provided by the dsh installation itself and are **not declared as dependencies/peerDependencies** in the manifest — the npm transitive dependency chain of these three packages is currently incomplete (one transitive package is unpublished), and declaring them would break installation; if loaded into a custom profile lacking these packages, loading fails with `ERR_MODULE_NOT_FOUND` — just install the package into the profile's `node_modules`.
>
> **Local dev mirror**: the `stubs/` directory is a minimal API mirror of these three packages (checked member-by-member against the released rc.1); `dev/pkgs/` holds three thin forwarding packages (`file:` deps) for tsc resolution and local tests; they are not shipped with the plugin (`files` only includes `lib/src`, the configuration layer, and docs).

## License

MIT — see [LICENSE](LICENSE).
