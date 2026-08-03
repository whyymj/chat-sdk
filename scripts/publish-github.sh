#!/usr/bin/env bash
# 发布到 master(总结 develop)并推双远程(Gitee + GitHub)
# 工作流:
#   - 日常新功能在 develop 分支维护(细粒度 commit,git push origin develop)
#   - 发布时:在 master 上 merge --squash develop 总结成一个发布 commit → push origin master + push github master
#     (master 只含发布 commit,两边历史一致 → fast-forward 零冲突)
#   - 发布后:重建 develop = master(丢弃已被 squash 的 develop commit,防下次重复 squash)
# 约定:
#   - 个人笔记 doc/待确认问题.md 在 .gitignore 未跟踪,不提交、不进 GitHub
# 用法:
#   ./scripts/publish-github.sh "release x.x.x: 一句话总结"   # 推荐:参数作发布 commit message
#   ./scripts/publish-github.sh                                # 默认 message "release: publish from develop"
set -euo pipefail

REMOTE_GITHUB=github
REMOTE_GITEE=origin
BRANCH_DEVELOP=develop
BRANCH_MASTER=master
NOTE_FILE="doc/待确认问题.md"

# 1. 工作区必须干净
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ 工作区有未提交改动,请先 commit 或 stash"; exit 1
fi

# 2. 确认当前在 master(发布在 master 上进行;日常开发在 develop)
if [ "$(git branch --show-current)" != "$BRANCH_MASTER" ]; then
  echo "❌ 请先切换到 $BRANCH_MASTER 分支发布(当前:$(git branch --show-current));日常开发请在 $BRANCH_DEVELOP"; exit 1
fi

# 3. 同步远程引用
git fetch "$REMOTE_GITHUB" --quiet
git fetch "$REMOTE_GITEE" --quiet

# 4. fast-forward 可行性:github/master 必须是 master 祖先(两边同历史 → 直接 push 不冲突)
if ! git merge-base --is-ancestor "$REMOTE_GITHUB/$BRANCH_MASTER" "$BRANCH_MASTER"; then
  echo "❌ github/$BRANCH_MASTER 与本地分叉(develop 工作流下不应发生)。请先核对两边历史"; exit 1
fi

# 5. develop 领先 master?若领先则 squash 总结成一个发布 commit
AHEAD_DEV=$(git rev-list --count "$BRANCH_MASTER..$BRANCH_DEVELOP" || true)
if [ "${AHEAD_DEV:-0}" -gt 0 ]; then
  echo "📦 develop 领先 master $AHEAD_DEV 个提交,合并总结:"
  git log --oneline "$BRANCH_MASTER..$BRANCH_DEVELOP"
  git merge --squash "$BRANCH_DEVELOP"
  if git diff --cached --quiet; then
    # develop 内容已在 master(上次发布后未重建 develop)→ 跳过空 commit,仅对齐
    echo "ℹ️  develop 内容已全部在 master,跳过空 commit(仅做对齐)"
  else
    git rm --cached "$NOTE_FILE" >/dev/null 2>&1 || true
    if [ $# -gt 0 ]; then
      git commit -m "$*"
    else
      git commit -m "release: publish from develop"
    fi
  fi
else
  echo "ℹ️  develop 无领先 master 的提交"
fi

# 6. 推双远程 master(均为 fast-forward,零冲突)
AHEAD=$(git rev-list --count "$REMOTE_GITHUB/$BRANCH_MASTER..$BRANCH_MASTER" || true)
if [ "${AHEAD:-0}" -gt 0 ]; then
  git push "$REMOTE_GITEE" "$BRANCH_MASTER"
  git push "$REMOTE_GITHUB" "$BRANCH_MASTER"
else
  echo "ℹ️  master 无领先远程的提交,无需推送"
fi

# 7. 重建 develop = master(squash 不建立父子关系,不重建则 develop 原始 commit 永远「领先」master,下次重复 squash)
git branch -f "$BRANCH_DEVELOP" "$BRANCH_MASTER"
git push --force "$REMOTE_GITEE" "$BRANCH_DEVELOP"
git checkout "$BRANCH_DEVELOP"
echo "✅ 已发布到 Gitee($REMOTE_GITEE)+ GitHub($REMOTE_GITHUB)。develop 已重建对齐 master,当前在 develop,继续开发"
