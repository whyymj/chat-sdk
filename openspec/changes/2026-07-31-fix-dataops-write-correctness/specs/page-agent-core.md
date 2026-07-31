# Specification Delta: page-agent-core

> 本文件为 change `fix-dataops-write-correctness` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: 主数据写入严格遵循 schema 白名单(未声明字段不落盘)

当 `data.schema` 为 `ZodObject` 时,顶层声明的 key 构成可读写白名单。`set_data` 与 `write`(set 意图)在白名单模式下,**仅将 schema 声明字段写入 bind**(经 `schema.safeParse` strip + `safeMerge`);LLM 传入 value 中**不在 schema 声明内的字段一律丢弃,不写入 bind**。`interceptors.write` 仍可在 write 入口对已声明字段做拦截/转换/拒绝,但不能作为绕过白名单向 bind 注入未声明字段的通道(集成方需要的可写字段须在 schema 中声明)。该收紧消除此前"未声明字段经原始 parsed 无校验写回 bind"的安全口子,使写路径与 `read` 投影 / `isPathAllowed` 的白名单语义一致。

## Requirement: 数组子项删除使用 splice 语义(不产生稀疏数组)

`delete_data` / `write`(del 意图)/ `edit_data`(op:remove)/ `eval_script` transform(patches remove)四条删除路径,删除数组元素时执行 `Array.prototype.splice(index, 1)`(元素移除、length 减 1、后续元素前移),而非 `delete arr[index]`(产生 empty 槽、length 不变的稀疏数组)。对象属性删除仍保持 `delete` 语义不变。该修正通过在汇聚点 `deleteByPath` 判定"父为 Array 且路径末段为数字索引"分支实现,一处修正四入口受益。结果:删除后数组结构干净(JSON 序列化不再出现 null 占位、`hashValue` 反映真实结构、Vue 响应式渲染无空位);schema `z.array(...).min(n)` 约束在 splice 后能正确拦截"删过头"。
