---
description: 全量自测(selftest + e2e + browser + types + exports + size),发布前必跑。
---

# 全量自测

发布前一键跑全部测试门禁。按 CLAUDE.md「发布前必跑顺序」执行。

## 执行

```bash
! npm test && npm run build && npm run test:e2e && npm run test:browser && npm run test:exports && npm run test:types && npm run test:size
```

## 预期结果

| 测试 | 预期 |
|---|---|
| `npm test` | 631 passed |
| `npm run build` | dist 构建成功 |
| `npm run test:e2e` | 210 passed |
| `npm run test:browser` | 7 passed |
| `npm run test:exports` | 6 passed |
| `npm run test:types` | tsc 无错误 |
| `npm run test:size` | 4 passed |

## 失败排查

- **selftest 失败**:看 `src/core/__tests__/modules/sec-NN.ts` 哪个模块的断言挂了
- **e2e 失败**:看 `tests/e2e/<module>.mjs` 哪个模块;通常是 createChatSdk 顶层 API 变动未同步
- **browser 失败**:看 `tests/browser/<demo>.spec.ts`;通常是 mock LLM 脚本不匹配 ReAct 轮次,或 DOM 选择器失效
- **types 失败**:`types/index.d.ts` 与 `src/core/index.ts` 导出不一致
- **size 失败**:dist 体积超阈值,检查是否引入了大依赖

## 全绿后

继续发布流程:`npm pack --dry-run` → 版本号递增 → `npm publish`。
