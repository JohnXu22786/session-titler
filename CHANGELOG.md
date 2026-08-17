# Changelog

All notable changes are tracked here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Fixed

- Cross-session title numbering no longer stops at the 99th same-titled
  session: the byte budget of the dedup suffix is the only bound, so
  numbering keeps working past 99 duplicates.
- Keyword captions deduplicate tokens case-insensitively: "Setup JWT and jwt
  auth" no longer repeats the token as both "JWT" and "Jwt".

### Chore

- The packed tarball now ships the Chinese README (`README.zh.md`).
- `.gitignore` covers coverage output and `tsc --incremental` build info.

## [0.1.0] - 2026-08-17

Initial release of dsh-session-caption, a two-phase session captioning
plugin for the DeepSeek Harness.

### Added

- Instant keyword captions from the latest human message while the session is
  busy (zero model calls), with script-aware pipelines for Latin and CJK.
- Budget-model refinement when the session goes idle, with an optional
  one-line summary harvested from the same reply.
- Cost control: refinement defaults to the cheapest registered model matching
  the cheap patterns, cached per `modelCacheMs`, invalidated on model
  topology changes, with explicit provider/model override.
- Title deduplication across concurrent sessions with `({n})` suffixes, and
  full respect for user-pinned titles (never overwrites, even mid-flight).
- Stories as a dsh bundle: `package.json` declares `dsh.bundle`;
  `cordis.patch.yml` installs the plugin into a dsh profile; the entry
  registers the sole `ctx.sessionTitle` provider.
- Comprehensive unit tests over config validation, keyword captioning,
  normalization, pacemaker timing, budget routing, refinement, and the full
  two-stage flow (87+ cases).

[0.1.0]: https://github.com/JohnXu22786/session-titler/commits/