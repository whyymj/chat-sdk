#!/usr/bin/env bash
# 发布到 GitHub 正式开源仓库(整理 commit)
# 约定:
#   - Gitee(origin) 保留全部细粒度日常提交
#   - GitHub(github) 每次发布只接收整理过的 squash 提交,公开历史保持干净
#   - 个人笔记 doc/待确认问题.md 不进 GitHub
# 用法:
#   ./scripts/publish-github.sh "feat: xxx 整理后的总结"   # 直接用参数作 commit message
#   ./scripts/publish-github.sh                            # 打开编辑器编辑 commit message
set -euo pipefail

REMOTE_GITHUB=github
BRANCH_PUBLIC=public
BRANCH_MASTER=master
NOTE_FILE="doc/待确认问题.md"

# 1. 工作区必须干净
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ 工作区有未提交改动,请先 commit 或 stash"; exit 1
fi

# 2. 同步远程引用并计算待整理提交
git fetch "$REMOTE_GITHUB" --quiet
AHEAD=$(git rev-list --count "$REMOTE_GITHUB/master..$BRANCH_MASTER" || true)
if [ "${AHEAD:-0}" -eq 0 ]; then
  echo "ℹ️  本地 master 无领先 github/master 的新提交,无需发布"; exit 0
fi
echo "📦 待整理提交($AHEAD 个):"
git log --oneline "$REMOTE_GITHUB/master..$BRANCH_MASTER"
echo

# 3. 切到 public 并基于 github/master 重置(丢弃上次的整理提交,重新整理)
git checkout "$BRANCH_PUBLIC"
# 安全保护:确认切到了 public 分支(避免 public 不存在时 checkout 静默失败、后续 reset --hard 误伤当前分支 master)
if [ "$(git branch --show-current)" != "$BRANCH_PUBLIC" ]; then
  echo "❌ 切换到 $BRANCH_PUBLIC 失败(分支不存在?用 git branch public \$REMOTE_GITHUB/master 创建),中止以免 reset 误伤当前分支"; exit 1
fi
git reset --hard "$REMOTE_GITHUB/master"

# 4. squash merge master:把所有新改动作为未提交暂存(不产生 merge commit)
git merge --squash "$BRANCH_MASTER"

# 5. 剔除个人笔记(.gitignore 已忽略,剔除后不会再进索引)
git rm --cached "$NOTE_FILE" >/dev/null 2>&1 || true

# 6. 整理 commit message 并提交
if [ $# -gt 0 ]; then
  git commit -m "$*"
else
  echo "✏️  请编辑整理后的 commit message(保存退出即提交,清空则中止)"
  git commit
fi

# 7. 推送到 GitHub 的 master
git push "$REMOTE_GITHUB" "$BRANCH_PUBLIC:master"

# 8. 回到日常分支
git checkout "$BRANCH_MASTER"
echo "✅ 已发布到 GitHub($REMOTE_GITHUB),Gitee 日常库不受影响"
