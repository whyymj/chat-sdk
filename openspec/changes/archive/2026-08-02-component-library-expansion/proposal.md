# Change: component-library-expansion (P2 持续/验证层)

> 📦 **已归档(2026-08-03,范围调整)**:用户决策「不需要 80,加几个意思意思就可以」。实际完成批 A **3 个简单展示类**(badge/progress/skeleton:def + Vue + schema + 实例),`tsc` 通过 + complex-demo browser spec **9 passed** 回归。批 B-E(到 80)取消。
>
> **意外发现(澄清核心担忧)**:`extractSchemaHint(pageSchema)` 对 `components[discriminatedUnion]` 数组字段不展开每个 type(只简短描述 +「用 read 查看实际形状」)→ 原担忧「80 type 撑爆 systemPrompt」**不成立**(union 在数组字段内不全量注入,深入靠 `schema_data` 工具)。即 proposal 的核心验证目标(分层披露在 80 类可控)基于一个不适用前提 —— schema hint 本就不全量展开 union array。

> complex-demo 组件类型 34→~80,作为 SDK「复杂场景标尺」的真实度扩充 + 大 schema 分层披露的量级压测。
> **来源**:TaskList #66 pending(A2 组件类型 30→~80 脚本生成 + 泛型渲染)+ roadmap §6「持续」行(50+ 组件压测)+ §4 码良业务场景(50+ 组件深嵌套)。
> ~~状态:proposal(未实施)~~ → **2026-08-03:范围缩减到 3 个(用户决策),完成归档。**

## Why
- **标尺真实度缺口**:complex-demo 是 SDK「胜任复杂多组件场景」的演示标尺,当前 34 组件类型距离 roadmap §4「码良 50+ 组件深嵌套」运营级有缺口。标尺不够复杂 → 难以暴露真实瓶颈。
- **验证大 schema 分层披露**:80 类型 union schema 是 `add-schema-tiered-disclosure`(maxKeys/maxChars 阈值→顶层概览)的极限压测场景。#57 实测 34 类型 systemPrompt 仅 3548 chars,80 类型能否仍可控需验证。
- **验证泛型渲染**:CompRenderer 按 type 分发(#65 baseProps 扩 + 通用渲染已就绪),80 类型能否纯泛型分发扛住(部分需定制),定泛型/定制边界。
- **#66 是 TaskList 唯一 pending 功能任务**,长期挂着无 change 跟踪,易遗漏。

## What Changes

### 1. 脚本批量生成 ~50 新组件
- 复用 `examples/complex-demo/defs/` 模式(icon/tag/price 已示范)+ baseProps 通用 props
- 脚本生成(非手写 50 个):覆盖电商专题页高频组件(轮播/瀑布流/倒计时/优惠券/楼层/导航/弹窗/表单/步进器/筛选/排序/标签页/手风琴/抽屉/骨架屏/空状态/徽标/进度条/评分/面包屑/分页/搜索框/地址选择/规格选择/加购浮层/分享面板/客服入口/返回顶部/广告位/推荐位/榜单/秒杀队列/拼团/预售/赠品/满减/阶梯价/库存/限购/预约/核销/会员/积分/优惠券列表/红包/直播/视频/图文/富文本/分割线/占位 等)
- 每组件:def(id+schema,继承 baseProps)+ Vue 组件(CompRenderer 泛型分发,少数交互复杂者定制)

### 2. schema + 实例扩充
- `pageSchema.ts`:discriminated union 扩到 ~80 类型 + PageComponent 类型更新
- `initialPage`:真实专题页实例(80 类型混搭,贴近码良运营页),非随机堆砌

### 3. 文档 + 测试
- skill 文档同步:组件业务说明/参数配置(#68 B2 已做的模式扩展到 80 类型)
- browser spec 回归:complex-demo 大 schema 不撑爆 + 渲染正确(schema hint 分层披露实测)
- 真 LLM 实测:80 类型大 schema 下生成/批量改/深嵌套/问答四类闭环(复用 #57 maliang 实测脚本模式),审计 systemPrompt 体积/分层披露触发
- CLAUDE.md 计数同步 + CHANGELOG

## Impact
- **complex-demo 体积**:~50 Vue 组件进 demo(demo 不进 npm 包,不影响 SDK 体积);build 时间略增
- **schema hint 压测**:80 类型 union 是分层披露阈值(maxKeys=15/maxChars=4000)的触发场景,验证「顶层概览 + 深层 schema_data 查」在量级下仍可控
- **CompRenderer 泛型分发**:80 类型 switch/map 分发性能(单页渲染,无压力)
- **真 LLM 成本**:实测 4 任务闭环耗 token(参考 #57:8 轮 7 工具调用)

## 决策
1. **脚本生成优先**:50 个组件手写不现实,写生成脚本(模板化 def + Vue 骨架),少数交互复杂者手写定制
2. **复用已就绪基础设施**:#65 baseProps 扩 + CompRenderer 通用渲染 + #68 组件文档模式均已落地,本 change 是「在已验证模式上量级化」,非新机制
3. **优先级 P2 持续**:纯验证层扩充,不阻塞 SDK 核心改动(P1 checkpoint/quality 优先)。可分多次会话按批补(如每批 10-15 类型)
4. **分层披露是核心验证目标**:80 类型若 systemPrompt 仍可控(<10K chars)证明 schema-tiered-disclosure 机制成立;若失控则触发阈值调优或子路径拆分

## Non-goals
- 不做新 SDK 能力(纯 demo/schema 扩充,验证已有能力)
- 不改 CompRenderer 分发机制(#65 已定型,只在其上加类型)
- 不做 1M/几百 K JSON 压测(那是 draft-write-commit + #71 hugePage 的范畴)
- 不追求 80 类型全手写定制(泛型分发为主,定制为辅)
