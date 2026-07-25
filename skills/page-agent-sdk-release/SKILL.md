---
name: page-agent-sdk-release
description: Release a new version of the page-agent-sdk npm package and push to its two git remotes (Gitee + GitHub). Use when the user wants to publish/ship a new version, bump the version, build + test before release, push to gitee/github, or follow the project's release checklist. Covers the full flow: code changes → sync zh/en docs → bump semver → build + self-test → commit → push Gitee → push GitHub → npm publish → verify.
---

# Release page-agent-sdk

Execute the project's release checklist end-to-end. The authoritative, detailed checklist lives in `CLAUDE.md` → "发布流程 checklist"; read that section first, then follow the steps below.

## Two remotes (do NOT mix them up)

| remote | URL | role |
|---|---|---|
| `origin` | gitee.com/whyymj/**chat-agent**.git | daily storage, keeps all granular commits |
| `github` | github.com/whyymj/**chat-sdk**.git | official open-source, receives curated commits |

Personal notes (`doc/待确认问题.md`) are gitignored — Gitee only, never GitHub.

## Release checklist (in order)

1. **Code**: edit `src/`, sync `types/index.d.ts` (hand-maintained), update exports in `src/core/index.ts`.
2. **Docs (sync zh + en, never single-side)**:
   - `README.md` (en) / `README.zh-CN.md` (zh) — features, usage, scenarios
   - `doc/README.md` (zh) / `doc/README.en.md` (en) — doc index
   - `doc/usage-guide.md` (zh) / `doc/usage-guide.en.md` (en) — usage guide
   - `CLAUDE.md` — internal dev guide/architecture
   - Keep language toggle links bidirectional.
3. **Bump version**: `npm version patch|minor|major --no-git-tag-version` (semver: minor for new API, major for breaking, patch for fix). Never republish the same version.
4. **Build + self-test**: `npm run build` (= `build:lib` + `build:iife`) then `npm test` (341 assertions must pass). Run `npm pack --dry-run` to confirm the tarball excludes `.env` / `src` / `examples` / notes.
5. **Commit**: `git add -A && git commit -m "feat/fix/docs: ..."` (conventional style).
6. **Push Gitee** (daily storage): `git push origin master`. If you just rebased and rewrote history → `git push --force-with-lease origin master` (personal repo, safe).
7. **Push GitHub** (official): `git push github master`. If rejected as `non-fast-forward` → `git fetch github master && git pull --rebase github master` then push again.
8. **Publish to npm**: `npm publish` (`publishConfig.registry` is locked to the official npm registry, unaffected by the machine's default private registry).
9. **Verify**: `npm view page-agent-sdk version` (confirm latest) + a temp dir `npm i page-agent-sdk` to confirm it installs + imports.

## npm credentials gotchas

- Account `whyymj` has 2FA enabled. Use an **Automation Access Token** (npmjs.com → Access Tokens → Classic → Automation, bypasses OTP); write to user-level `~/.npmrc` via `npm config set //registry.npmjs.org/:_authToken <token> --location=user`. Revoke after use. Never commit tokens or store them in the project dir.
- `npm login` / `npm whoami` require `--registry=https://registry.npmjs.org/` (machine default may be a private registry).

## References

- `CLAUDE.md` → "发布流程 checklist" / "双远程仓库与发布约定" / "npm 发布约定" — authoritative details.
- `package.json` → `publishConfig`, `exports`, `files`, `peerDependencies`.
