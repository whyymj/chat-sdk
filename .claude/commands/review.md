---
description: 对当前改动跑 Bugbot 风格代码审查(质量/安全/可维护性)。改完核心模块后主动用。
---

# 代码审查

对当前分支的改动跑代码审查。委派 `review-bugbot` subagent 或直接用 `review-security` skill。

## 执行

```bash
! git diff --stat HEAD~1
```

根据改动范围选择审查方式:
- **小改动**(单文件/单函数):直接读 diff,按 `.claude/skills/review-bugbot/SKILL.md` 的审查清单逐项检查
- **大改动**(多文件/跨模块):委派 subagent,把 diff 传给它隔离上下文
- **安全敏感**(认证/输入处理/API 端点):额外按 `.claude/skills/review-security/SKILL.md` 跑安全审查

## 审查清单(快速版)

- [ ] 无未处理 Promise / async 错误吞掉
- [ ] 无 `any` 类型逃逸(非不得已加注释)
- [ ] 无 console.log 残留(除 debug 中间件)
- [ ] schema 校验覆盖写入路径
- [ ] 无硬编码密钥/token
- [ ] 新增导出已同步 `types/index.d.ts`
- [ ] 新增功能已补测试(selftest/e2e/browser 至少一项)
