# Tasks: skill-external-scripts(自定义 skill 支持外部脚本执行)

> 关联 `proposal.md`。**独立 change**,无前置依赖。用户拍板:执行目标 = 页面内 JS + 远程 URL + 附带工具(全要);触发形态 = 加载时注入 + 工具形态(两者都要)。

## 1. 沙箱引擎泛化(基础)
- [ ] 新建 `src/core/tools/sandbox.ts`:`createSandboxRunner(script, timeoutMs?)` → `(input?) => Promise<SandboxResult>`
- [ ] 静态扫描 + WORKER_PREAMBLE + 超时 terminate 原样保留(单一真相源)
- [ ] `dataSlotQuery.ts` 的 `runSandboxedScript` 改为调 `createSandboxRunner`(等价重构)
- [ ] `dataOps.ts` 的 `eval_script` 改调 `createSandboxRunner(script)(data)`
- [ ] selftest:无参沙箱执行 / 有参(等价 eval_script)/ 禁用模式拒绝 / 超时 terminate / 静态扫描仍生效

## 2. SkillSpec 扩展 + 类型
- [ ] `SkillSpec` 加 `exec?: SkillExecSpec` + `tools?: SkillToolFactory[]`
- [ ] `SkillExecSpec`:`code?`/`url?`/`context?`(默认 sandbox)/`inject?`(默认 append);code 与 url 二选一校验
- [ ] `SkillToolFactory` 类型(factory → 单个/数组工具,可异步)
- [ ] `types/index.d.ts`(手动维护)同步 SkillSpec 扩展
- [ ] selftest:code+url 都空无 exec / 都填 warn / url+host 组合拒绝

## 3. load_skill 执行链(加载时注入)
- [ ] `loadSkillTool`:skill 配 exec → 执行(sandbox 路径 code/url + host 路径 runHostScript)→ 结果 append/prepend 拼进全文 → 缓存 → 返回
- [ ] 远程 URL:`fetch` 拉取(CORS/错误处理借鉴 fetch_document)→ `createSandboxRunner(fetched)()`
- [ ] exec 失败降级:不阻塞,文本可用 + 标注「(skill 脚本执行失败:err)」
- [ ] selftest:exec 成功注入位置 / 失败降级标注 / url 拉取失败降级 / 空 exec 走原逻辑

## 4. 宿主执行器 + 开关
- [ ] 新建 `src/core/tools/hostScript.ts`:`runHostScript(code, timeoutMs?)`(AsyncFunction 宿主执行 + Promise.race 超时)
- [ ] `capabilities.skillHostScript`(默认关)注册进 `capabilities.ts`
- [ ] createChatSdk:开且 skill `context:'host'` → 允许;关 → warn + 跳过 exec
- [ ] 远程 + 宿主组合:构造时 warn + load 时跳过
- [ ] selftest:host 开/关行为 / 组合拒绝 / runHostScript 成功与超时

## 5. 工具形态(附带工具注入)
- [ ] skills 中间件 `onToolsReady` 回调;load_skill 后 skill.tools 求值 → 回调
- [ ] createChatSdk `loadedSkillTools` 装配 + rebind(复用 rebuildExtraTools/setTools)
- [ ] source 标注 `skill:<name>`;`invalidateSkillCache`/`setSkills` 同步卸载
- [ ] selftest:load_skill 后工具可调 / invalidate 卸载 / source 标注

## 6. 文档
- [ ] CLAUDE.md skill 小节补 exec/tools + 安全边界(sandbox 默认 / host opt-in / 远程禁 host)
- [ ] usage-guide skill 小节补「动态 skill(exec)+ 附带工具(tools)」示例
- [ ] `doc/page-agent-architecture-comparison.md` §3 补「skill 执行能力」(如相关)
- [ ] README 中英(若 skill 特性表提到则补)

## 7. 全量回归
- [ ] `npm run build` + `npm test` + `npm run test:e2e` + `npm run test:exports` + `npm run test:types` + `npm run test:size`
- [ ] e2e:inspect().tools 反映 skill 工具注入(加载后)
- [ ] browser:mock LLM 跑「加载动态 skill → 执行脚本 → 注入 → 调附带工具」端到端
- [ ] 计数同步:CLAUDE.md / README 中英断言计数
- [ ] CHANGELOG [Unreleased] 段:skill-external-scripts 能力记录
- [ ] 归档:`specs/` 增量合入(若有)+ change 移入 `openspec/changes/archive/`(经用户确认发布后)
