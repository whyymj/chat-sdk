---
name: page-agent-sdk-release
description: Release a new version of the page-agent-sdk npm package and push to its two git remotes (Gitee + GitHub). Use when the user wants to publish/ship a new version, bump the version, build + test before release, push to gitee/github, or follow the project's release checklist. Covers the full flow: code changes → sync zh/en docs → bump semver → build + self-test → commit → push Gitee → push GitHub → npm publish → verify.
---

# Release page-agent-sdk

Execute the project's release checklist end-to-end. The authoritative, detailed checklist lives in `CLAUDE.md` → "发布流程 checklist"; read that section first, then follow the steps below.

> ⚠️ **Do NOT auto-release**: after fixing a bug or adding a feature, do NOT automatically bump / push / publish. Stop and ask the user "是否发布?" first. Only run this checklist when the user explicitly says 发布 / publish / 推上去 / ship, etc.

## Two remotes + branch workflow (develop → master)

| remote | URL | role |
|---|---|---|
| `origin` | gitee.com/whyymj/**chat-agent**.git | daily storage (develop granular commits + master release commits) |
| `github` | github.com/whyymj/**page-agent-sdk**.git | official open-source (master release commits only) |

**Branch workflow**: daily dev happens on `develop` (granular commits, `git push origin develop`). At release, on `master` run `./scripts/publish-github.sh "release x.x.x: summary"` — it `merge --squash develop` into one release commit, then fast-forwards both remotes' `master` (same history on both sides → zero conflicts). `master` is only touched at release; GitHub gets a clean history of release commits only.

Personal notes (`doc/待确认问题.md`) are gitignored (untracked) — Gitee only, never GitHub.

## Release checklist (in order)

0. **Work on `develop`** (never `master`): `git checkout develop` first if on master. Commit code changes here, `git push origin develop` anytime.
1. **Code**: edit `src/`, sync `types/index.d.ts` (hand-maintained), update exports in `src/core/index.ts`. **新增功能必须同步补对应测试用例**(selftest 和/或 e2e,见 `CLAUDE.md` → "测试流程 → 新增功能测试同步约定"),与功能代码同 commit,无测试不予发布。
2. **Docs (sync zh + en, never single-side)**:
   - `README.md` (en) / `README.zh-CN.md` (zh) — features, usage, scenarios
   - `doc/README.md` (zh) / `doc/README.en.md` (en) — doc index
   - `doc/usage-guide.md` (zh) / `doc/usage-guide.en.md` (en) — usage guide
   - `CLAUDE.md` — internal dev guide/architecture
   - Keep language toggle links bidirectional.
3. **Bump version**: `npm version patch|minor|major --no-git-tag-version` (semver: minor for new API, major for breaking, patch for fix). Never republish the same version.
4. **Build + self-test**: `npm run build` (= `build:lib` + `build:iife`) then `npm test` then `npm run test:e2e` (uses built `dist`). **Assertion counts must match the current `CLAUDE.md` → "测试流程" (1097 / 286)**. Run `npm pack --dry-run` to confirm the tarball excludes `.env` / `src` / `examples` / notes.
5. **Commit** (on `develop`): `git add -A && git commit -m "feat/fix/docs: ..."` (conventional style). Daily pushes go to `git push origin develop`.
6. **Release to `master` + push both remotes**: `git checkout master` → `./scripts/publish-github.sh "release x.x.x: one-line summary"` — squashes `develop` into one release commit, fast-forward pushes Gitee + GitHub (both `master` share history → zero conflicts). Then back to `git checkout develop`.
7. **Publish to npm**: `npm publish` (`publishConfig.registry` is locked to the official npm registry, unaffected by the machine's default private registry).
8. **Verify**: `npm view page-agent-sdk version` (confirm latest) + a temp dir `npm i page-agent-sdk` to confirm it installs + imports.

## npm credentials gotchas

- Account `whyymj` has 2FA enabled. Use an **Automation Access Token** (npmjs.com → Access Tokens → Classic → Automation, bypasses OTP); write to user-level `~/.npmrc` via `npm config set //registry.npmjs.org/:_authToken <token> --location=user`. Revoke after use. Never commit tokens or store them in the project dir.
- `npm login` / `npm whoami` require `--registry=https://registry.npmjs.org/` (machine default may be a private registry).

## References

- `CLAUDE.md` → "发布流程 checklist" / "双远程仓库与发布约定" / "npm 发布约定" — authoritative details.
- `package.json` → `publishConfig`, `exports`, `files`, `peerDependencies`.
