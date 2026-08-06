# Tasks: focus-context(上下文聚焦 · 指定组件精修)

> 关联 `proposal.md`。独立 change,与 `chatdialog-component-split` 互补。用户拍板:strict 强制收紧 + 三种触发方式全要。

## 1. Focus 状态 + SDK API
- [ ] `createChatSdk` 加 `setFocus(focus)` / `getFocus()` / `clearFocus()` + `capabilities.focus`(默认开)
- [ ] `setFocus` 校验 path 合法性:非 `''` 且 `getSchemaAtPath(schema, path)` 命中才可聚焦,非法返回错误
- [ ] `inspect().focus` 反映当前焦点(`{ path, label? }` 或 undefined)
- [ ] `capabilities.focus:false` → `setFocus`/`getFocus` no-op
- [ ] e2e:`setFocus`/`getFocus`/`clearFocus` + `inspect().focus` 反映 + 非法 path 拒绝

## 2. Focus 中间件(三层收敛)
- [ ] 新建 `harness/focus.ts`:`createFocusMiddleware`(augmentPrompt + wrapToolCall 拦截 + setFocus/getFocus/clearFocus 控制器)
- [ ] **目标提示**:augmentPrompt 注入「## 当前精修目标:`path`(`label`)。仅操作该子树,不要改动其他组件」;清除后不注入
- [ ] **视野收敛**:聚焦时注入 `getSchemaAtPath(schema, path)` 子树 schema 描述(用 `extractSchemaHint` 渲染),LLM 每轮只看到该组件结构
- [ ] **范围收紧(strict)**:wrapToolCall 对写工具(`write`/`set_data`/`edit_data`/`delete_data`/`eval_script` write 意图)——`jsonPath` 不以 `focus.path` 为前缀 → 返回 `PATH_DENIED`(聚焦越界);读工具不限制
- [ ] 装载序:`MIDDLEWARE_PRIORITY` 注册 + `createChatSdk` 装配(mission 之后)
- [ ] selftest:注入(聚焦/清除)/ 收紧(子树内放行、越界 PATH_DENIED)/ capabilities 关后 no-op

## 3. agent 工具 `set_focus`/`clear_focus`(对话驱动)
- [ ] `set_focus({ path, label? })`:校验 path 合法 → 设置焦点,返回 `{ focus }`;非法返回结构化错误回灌 LLM 自纠
- [ ] `clear_focus`:清空焦点,返回确认
- [ ] toolMode:advanced 暴露(simple 隐藏,聚焦经 UI/宿主 API 触发);source=builtin
- [ ] selftest:工具参数校验(非法 path 拒绝)/ 正常 set+clear 循环 / clear 后注入消失

## 4. ChatDialog 焦点条(内置 prop 版)
- [ ] ChatDialog 加 `focus` + `onSetFocus`/`onClearFocus` props
- [ ] 头部下方「🎯 正在精修:`label` `path`」chip(✕ 退出 · ▾ 切换 · 编辑路径输入)
- [ ] `capabilities.focus:false` 时 chip 不显示
- [ ] browser:聚焦精修组件端到端(点组件 → 聚焦 → 改 title → chip 显示 → ✕ 退出)
- [ ] **注:拆分完成(`chatdialog-component-split`)后,此区块挪 `#focus` slot;当前先内置**

## 5. 宿主契约文档(点击拾取)
- [ ] `doc/usage-guide.md` 补「上下文聚焦」小节:组件渲染绑 `data-path` → 点击调 `sdk.setFocus(path, { label })` 的接入示例
- [ ] README 中英补 Focus 能力 + 用法片段
- [ ] CLAUDE.md 架构要点补 Focus 中间件

## 6. 示例 demo
- [ ] 扩展现有 complex-demo(或 page-demo):组件渲染绑 `data-path` + 点击拾取 → 聚焦 → 精修
- [ ] 验证 `npm run dev` 手测:点组件 → chip 出现 → 对话精修只改该组件 → 越界被拒 → ✕ 退出

## 7. 全量回归 + 收尾
- [ ] `npm run build` + `npm test` + `npm run test:e2e` + `npm run test:exports` + `npm run test:types` + `npm run test:size`
- [ ] 计数同步:CLAUDE.md / README 中英断言计数
- [ ] CHANGELOG [Unreleased] 段:Focus 能力记录
- [ ] 归档:`specs/` 增量合入(若有)+ change 移入 `openspec/changes/archive/`(经用户确认发布后)
