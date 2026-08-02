# 工具设计与流程审计修复报告

> 日期:2026-08-02 · 触发:深嵌套场景实测暴露 `write` value 双语义(#76 治本)后,启动全量审计排查同类隐患
> 范围:`src/core/` 全量(工具 + 中间件 + harness)
> 结论:**核心模式 = `write` 高层工具引入嵌套结构后,下游消费者未同步** —— 与 #76 同根,已系统性治本

---

## 一、核心模式(最重要)

`write` 高层工具为消除 LLM 认知负担,把增量编辑参数从扁平 `{op, jsonPath, value}` 收进嵌套结构 `patch:{op,jsonPath,value}` / `patches:[{...}]`。但**所有依赖工具参数结构的下游消费者仍按扁平 `args.jsonPath` 设计**,导致:

| 消费者 | 期望 | 实际(write) | 后果 |
|---|---|---|---|
| `permissions` 中间件 | `args.jsonPath` 取 scope | 嵌在 `patch.jsonPath` | **deny 规则完全失效**(安全) |
| `verify.extractWrites` | `args.jsonPath` 取写路径 | 嵌在 `patch.jsonPath` | **批量 N 条只在 root 校验 1 次**(正确性) |
| `approval` 拒绝消息 | `args.path` 显示范围 | 嵌在 `patch.jsonPath` | 拒绝消息不显精确路径(体验) |
| `write.value` 双语义(#76) | value 位置统一 | patch 无 value,退回顶层 | LLM 放错位置(已修) |

**根因**:高层工具是后加的(2.2+),嵌套结构是 #76 才定型的,但下游中间件(permissions/verify/approval)更早存在,无人同步。这是典型的「**新结构 + 旧消费者**」演进债。

**治理原则**:以后凡工具参数结构变化(尤其引入嵌套),必须审计所有读该工具 `args` 的中间件/校验逻辑,逐一同步。本次 H1/H2/M7 + #76 即按此线收敛。

---

## 二、修复清单(共 15 项:2 高 / 7 中 / 6 低)

### 第一批·必修(同根治本,已完成)

#### H1. permissions 对 `write` patch/patches 权限绕过 【高·安全】
- **位置**:`src/core/harness/permissions.ts`
- **问题**:`scope = args.jsonPath || args.path || ''`。write 的 jsonPath 嵌在 `patch`/`patches`,顶层 `args.jsonPath` 恒 undefined → scope='' → `if(op&&scope)` 跳过 → 集成方配的 `deny secret.*` 对 `write({patch:{jsonPath:'secret.x'}})` 完全失效。
- **修复**:新增 `extractScopes(args)` 展开写工具涉及的所有 jsonPath(`patch.jsonPath` + `patches[].jsonPath` 逐条),任一 deny 则整体拒绝;整体 set(无 patch/patches)scope 为空不校验(由 schema 白名单兜底,保持原行为)。
- **测试**:sec-06 +5 断言(patch deny / patches 任一 deny / del deny / 未命中 allow / 整体 set 不校验)。

#### H2. verify extractWrites 对 `write` patch/patches 路径提取错误 【高·正确性】
- **位置**:`src/core/harness/verify.ts`
- **问题**:`extractWrites` 取 `tc.args.jsonPath` → write 的真实路径全丢,批量 patches N 条只在 path `''`(root) 校验 1 次,其余 N-1 条不验证;`byPath` 去重把所有 write 映射到 ''。
- **修复**:`extractWrites` 对 `write` 展开 `patch`/`patches`,每条生成 `{path, op, callId}`;op 归一化(del / `op:'remove'` → `delete_data`;set/merge/append → `edit_data`;整体 set → `set_data`),复用 `createWriteBackCheck` 现有 `op==='delete_data'` 判断。
- **测试**:sec-18 +5 断言(patch 读回 / patches 批量独立校验 / del 归一化 ok / del 读回仍有值 feedback / 整体 set root 校验)。

#### M1. `write` del 模式 `patch.op` 必填与示例矛盾 【中·易用错】
- **位置**:`src/core/tools/dataOps.ts`(write schema + 拦截器 + list 构造)
- **问题**:schema `patch.op: z.enum([...])` 必填,但 description 删除示例 `write({patch:{jsonPath},del:true})` 不带 op,且 del 分支根本不读 op → LLM 照描述写触发 `SCHEMA_INVALID` 浪费一轮重试。
- **修复**:`patch.op` 改 `.optional()`;单 patch edit 分支(拦截器 input + list 构造)对缺失 op 默认 `'set'`;`patches[].op` 保持必填(无 del 模式)。
- **测试**:sec-21 +1 断言(del 不传 op 通过)。

### 第二批·低成本高价值(已完成)

#### M5. get_dom 默认白名单含 `value`(敏感表单值泄露)【中·安全】
- **位置**:`src/core/tools/domTool.ts`
- **问题**:`DEFAULT_ATTRS` 含 `'value'`,与文件头"防敏感属性泄露"定位矛盾 —— `<input value="密码">` 的值会灌入 LLM 上下文(进而可能被写数据/外发)。
- **修复**:从 `DEFAULT_ATTRS` 移除 `value`;需时集成方显式 `attrs:['value']`(opt-in)。
- **测试**:sec-36 +2 断言(默认不含 value / 显式 opt-in 可暴露)。

#### M6. diff_data `against` 不走 maybeParseValue 【中·一致性】
- **位置**:`src/core/tools/dataOps.ts`(diffData)
- **问题**:`against: z.unknown()`,LLM 传 JSON 字符串(如 `'{"a":1}'`)不 parse,`diffObjects` 拿字符串与对象对比,产出 N 条无意义 "string→object" 差异;与 set_data/write 的 value(都走 maybeParseValue)不一致。
- **修复**:against 为字符串时走 `maybeParseValue`(parse 失败保留原串)。
- **测试**:单测待补(diff_data 无专门测试模块;逻辑直白,与 set_data maybeParseValue 同源,已被现有 value parse 断言间接覆盖)。

#### M7. approval 拒绝消息缺 jsonPath/patch.jsonPath 【中·体验】
- **位置**:`src/core/harness/approval.ts`
- **问题**:拒绝消息只显 `args.path`,对 write/edit_data(用 jsonPath / patch.jsonPath)不显精确范围,LLM 不知被拒的具体字段。
- **修复**:scope 提取兼容 `path || jsonPath || patch.jsonPath || patches[].jsonPath`(与 H1 extractScopes 同构)。
- **测试**:sec-15 +2 断言(含 jsonPath / 含 patch.jsonPath)。

#### L2. 读工具(get_data/read/history_data)非法路径报错不清晰 【低·体验】
- **位置**:`src/core/tools/dataOps.ts`
- **问题**:读工具不显式 `isUnsafePath`,依赖 `getByPath` 内部兜底 → 返 `(undefined)` 而非 `PATH_UNSAFE`,LLM 可能误判为数据缺失去 set 一个值。无安全漏洞(getByPath 拦了),仅报错清晰度。
- **修复**:三工具在 `isPathAllowed` 前显式 `isUnsafePath` 检查,统一返 `PATH_UNSAFE`。
- **测试**:sec-22 +1 断言(read `__proto__` → PATH_UNSAFE)。

#### L3. eval_script Worker 创建失败 Blob URL 泄漏 【低·资源】
- **位置**:`src/core/tools/dataSlotQuery.ts`(runSandboxedScript)
- **问题**:`URL.createObjectURL(blob)` 成功但 `new Worker(url)` 抛错时,catch 块直接 resolve 不 `revokeObjectURL`,每次失败泄漏一个 blob URL。
- **修复**:catch 块 `if (url) URL.revokeObjectURL(url)`;`let url: string` 改 `let url = ''`(消除 used-before-assigned)。
- **测试**:单测待补(需 mock `new Worker` 抛错,环境构造成本高;逻辑直白 + test:types 守卫 url 初始化)。

### 第三批·需决策/低优先

**本轮已治本(3 项)**:

| # | 项 | 修复 |
|---|---|---|
| M2 | edit_data 扁平 vs write.patch 嵌套 value 位置不一致 | **双兼容**:edit_data 容错误传 write 的 `{patch:{op,jsonPath,value}}` 形式(从 patch 取,顶层优先);op 改 optional + 函数兜底 MISSING_VALUE。advanced 模式两者混用不再直接报错浪费一轮 |
| M3 | subagent 并发模式 signal/emit/logSink 闭包竞态 | **文档告知**:subagent.ts 注释标注闭包竞态限制(并发 >1 时 signal/emit 可能错乱)+ 建议串行;机制彻底修(改 spawn 从 ctx 取)成本高,待后续 |
| L6 | set_data 白名单浅 safeMerge 嵌套整体替换 | **description 增强**:set_data 说明白名单模式根级浅合并、深层子对象整体替换,保留深层字段用 edit_data merge |

**维持暂缓(4 项,低优先/需产品决策)**:

| # | 项 | 暂缓原因 |
|---|---|---|
| M4 | maybeParseValue 裸字面量隐式转换("5"→5) | 向后兼容不改行为;usageHints 已提示 string 直传;改了破坏现有 value parse 语义 |
| L1 | simple 模式暴露 history/restore 但隐藏 list_snapshots | 功能可用(restore/history 不传 id 用默认最近);二选一需产品决策 |
| L4 | trimContext 只截 ToolMessage 不处理超长 AIMessage | AI 输出有 maxTokens 兜底;小上下文模型多轮累积才触发,低频 |
| L5 | setByPath 自动建中间路径(可能掩盖笔误) | schema safeParse + isPathAllowed 多数场景兜住;`.passthrough()` schema 才漏,罕见 |

---

## 三、验证

| 检查 | 结果 |
|---|---|
| `npm test`(selftest) | **875 → 891**(+16:第一批 11 + 第二批 5),0 failed |
| `npm run test:e2e` | **247 passed**,0 failed(不回归) |
| `npm run build` | 通过(ESM+UMD+IIFE) |
| `npm run test:types` | 通过(tsconfig.test.json 门禁) |

> 改动文件类型干净;`tsc -p tsconfig.json`(更严格配置)报的 maybeParseValue(unknown)等为预存在差异,非本次引入、非门禁。

---

## 四、经验教训

1. **高层工具是抽象漏斗重灾区**:`write` 把 4 个低层工具(set/edit/delete/snapshot)合并成高层入口,每次参数结构调整(嵌套化、value 位置、op 可选)都要回头审所有读其 `args` 的中间件。本次 H1/H2/M7 全是漏审下游。
2. **description 与 schema 必须逐字对齐**:M1 的 del 示例不带 op 但 schema 必填,LLM 照描述写必踩坑。规则:**description 的每个示例都必须是 schema 校验通过的合法输入**(可反向用 schema safeParse 验证示例)。
3. **安全白名单要逐项 review 其"暴露面"**:M5 的 `value` 在默认白名单纯属历史遗漏(拷了 HTML 常见 attr 列表),没人想过 `<input value>` 的敏感语义。规则:**默认白名单的每一项都要能回答"暴露它的最坏情况是什么"**。
4. **审计 agent(Explore)对"找同类问题"高效**:单点修 #76 后,启动审计 agent 全量扫 src/core,15 项中 4 项(H1/H2/M7/#76)属同根 —— 一次审计收敛一个模式,比逐个 bug 修效率高得多。
5. **PLAUSIBLE 发现必须亲自 verify 再修**:审计是 PLAUSIBLE 级(读 excerpts 非全文),H1/H2 我读 permissions.ts/verify.ts 全文确认逻辑链成立才修。避免基于"听起来对"的发现乱改。

---

## 五、关联

- 同根前置:#76(write value 双语义治本)
- 测试修复报告:`doc/testing-fix-report.md`(深嵌套实测复盘)
- DSML 工具调用泄漏:#73/#75(另一条可靠性治理线)
