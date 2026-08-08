# Tasks: skill-external-scripts(自定义 skill 支持外部脚本执行)

> 关联 `proposal.md`。**独立 change**,无前置依赖。用户拍板:执行目标 = 页面内 JS + 远程 URL + 附带工具(全要);触发形态 = 加载时注入 + 工具形态(两者都要)。

## 1. 沙箱引擎泛化(基础)
- [ ] 新建 `src/core/tools/sandbox.ts`:`createSandboxRunner(script, timeoutMs?)` → `(input?) => Promise<SandboxResult>`
- [ ] **三层防护整体迁移到 sandbox.ts**(单一真相源):① `SANDBOX_FORBIDDEN_PATTERNS` 静态扫描 ② **`lockSandboxGlobal` 纯函数 + `WORKER_PREAMBLE`=(lockSandboxGlobal.toString())(self) 序列化引用**(防 `delete self.fetch` 逃逸,关键不得漏)③ 超时 terminate
- [ ] `dataSlotQuery.ts` 的 `runSandboxedScript` 改为调 `createSandboxRunner`(等价重构);`lockSandboxGlobal` re-export 或 sec-21 单测 import 路径同步改(防断)
- [ ] `dataOps.ts` 的 `eval_script` 改调 `createSandboxRunner(script)(data)`(workerCode 不变,无参传 undefined 等价)
- [ ] selftest:无参沙箱执行 / 有参(等价 eval_script)/ 禁用模式拒绝 / 超时 terminate / 静态扫描仍生效 / **`delete self.fetch` 仍抛(lockSandboxGlobal 加固层未破)**

## 2. SkillSpec 扩展 + 类型
- [ ] `SkillSpec` 加 `exec?: SkillExecSpec` + `tools?: SkillToolFactory[]`
- [ ] `SkillExecSpec`:`code?`/`url?`/`context?`(默认 sandbox)/`inject?`(默认 append);code 与 url 二选一校验
- [ ] `SkillToolFactory` 类型(factory → 单个/数组工具,可异步)
- [ ] `types/index.d.ts`(手动维护)同步 SkillSpec 扩展
- [ ] selftest:code+url 都空无 exec / 都填 warn / url+host 组合拒绝

## 3. load_skill 执行链(加载时注入)
- [ ] `loadSkillTool`:skill 配 exec → 执行(sandbox 路径 code/url + host 路径 runHostScript)→ 结果 append/prepend 拼进全文 → 返回
- [ ] 远程 URL:`fetch` 拉取(CORS/错误处理借鉴 fetch_document)→ `createSandboxRunner(fetched)(undefined)`
- [ ] exec 失败降级:不阻塞,文本可用 + 标注「(skill 脚本执行失败:err)」;**不写 contentCache**(动态 skill 下次 load 重试 exec);exec 成功或无 exec 才缓存
- [ ] exec 大结果走 createAgent 通用 offload(>6000 转 vfs,LLM 收预览 + vfs_read 句柄),**load_skill 不豁免 offload**;静态文本部分仍「一次读全」
- [ ] selftest:exec 成功注入位置 + 缓存命中 / **exec 失败标注 + 不缓存(下次 load 重试)** / url 拉取失败降级不缓存 / 空 exec 走原逻辑 / host 关闭跳过 exec 当无 exec

## 4. 宿主执行器 + 开关
- [ ] 新建 `src/core/tools/hostScript.ts`:`runHostScript(code, timeoutMs?)`(AsyncFunction 宿主执行 + Promise.race 超时);**不经 SANDBOX_FORBIDDEN_PATTERNS 静态扫描**(集成方可信内联 code,需正常 fetch/API)
- [ ] `capabilities.skillHostScript`(默认关)注册进 `capabilities.ts`
- [ ] createChatSdk:开且 skill `context:'host'` 且 `exec.code`(非 url)→ 允许;关 → warn + 跳过 exec(当无 exec 处理)
- [ ] 远程 + 宿主组合(`url`+`context:'host'`):构造时 warn + load 时跳过 exec(远程不可信不能全权跑)
- [ ] 文档点明安全前提:host 脚本必须是集成方内联 code(非 LLM 生成、非远程),LLM 改不了 skill 定义 → opt-in 成立
- [ ] selftest:host 开/关行为 / 组合拒绝 / runHostScript 成功与超时 / host 脚本能用 fetch(不被静态扫描拒)

## 5. 工具形态(附带工具注入)
- [ ] skills 中间件 `onToolsReady` 回调;load_skill 后 skill.tools 求值 → 回调
- [ ] createChatSdk `loadedSkillTools` 装配 + rebind(复用 rebuildExtraTools/setTools);**经 `dedupeTools` 统一去重**(与内置/用户/MCP/subagent 同池)
- [ ] **命名空间前缀**:skill 工具名建议 `<skill_name>__<tool>`(factory 返回时带前缀),防与内置/用户工具重名;重名走 dedupe(后注册覆盖 + warn)
- [ ] source 标注 `skill:<name>`;`invalidateSkillCache(name)` 按 source 过滤卸载该 skill 工具组 / `setSkills` 清全部
- [ ] selftest:load_skill 后工具可调 / invalidate 卸载 / source 标注 / **重名走 dedupe warn** / 卸载不残留

## 6. 文档
- [ ] CLAUDE.md skill 小节补 exec/tools + 安全边界(sandbox 默认含 lockSandboxGlobal 加固 / host opt-in 跳过静态扫描 / 远程禁 host / host 仅集成方内联 code)
- [ ] usage-guide skill 小节补「动态 skill(exec)+ 附带工具(tools)」示例 + **exec vs tools 语义对照表**(exec=一次性上下文初始化快照,tools=反复查询;勿同数据双轨)
- [ ] `doc/page-agent-architecture-comparison.md` §3 补「skill 执行能力」(如相关)
- [ ] README 中英(若 skill 特性表提到则补)

## 7. 全量回归
- [ ] `npm run build` + `npm test` + `npm run test:e2e` + `npm run test:exports` + `npm run test:types` + `npm run test:size`
- [ ] e2e:inspect().tools 反映 skill 工具注入(加载后)
- [ ] browser:mock LLM 跑「加载动态 skill → 执行脚本 → 注入 → 调附带工具」端到端
- [ ] 计数同步:CLAUDE.md / README 中英断言计数
- [ ] CHANGELOG [Unreleased] 段:skill-external-scripts 能力记录
- [ ] 归档:`specs/` 增量合入(若有)+ change 移入 `openspec/changes/archive/`(经用户确认发布后)
