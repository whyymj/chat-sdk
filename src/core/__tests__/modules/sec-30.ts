import type { TestCtx } from './_ctx'
import {
  isUnsafePath, safeMerge, getByPath, setByPath, deleteByPath,
  deepClone, maybeParseValue, projectFields, limitDepth, safeStringify, hashValue, cyrb53,
  applyPatchToClone, applyPatchToLive, restoreLive, restoreInPlace,
} from '../../tools/jsonUtils'

/**
 * sec-30 —— jsonUtils 纯函数白盒单测(refactor-module-extraction 从 dataOps 抽离)。
 * 此前这些函数只能经工具调用间接黑盒测;抽出后直接白盒覆盖路径/克隆/序列化/投影/patch/还原 + 原型污染防护。
 */
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-30] jsonUtils 纯函数白盒单测')

  // deepClone:深拷贝独立
  const orig = { a: [1, 2], b: { c: 3 } }
  const cl = deepClone(orig)
  assert(cl !== orig && cl.a !== orig.a && cl.b !== orig.b, 'deepClone → 对象/数组/嵌套均深拷贝独立')
  assert(deepClone(undefined) === undefined, 'deepClone → undefined 原样返回')

  // getByPath
  assert(getByPath({ a: { b: 1 } }, 'a.b') === 1, 'getByPath → 嵌套取值')
  assert((getByPath({ a: 1 }, '') as any).a === 1, 'getByPath → 空路径返原对象')
  assert(getByPath({ a: 1 }, 'a.b') === undefined, 'getByPath → 中途 null/不存在返 undefined')
  assert(getByPath({}, '__proto__.x') === undefined, 'getByPath → 原型污染路径返 undefined')

  // setByPath
  const o: any = {}
  setByPath(o, 'a.b.c', 1)
  assert(o.a.b.c === 1, 'setByPath → 自动创建嵌套结构')
  setByPath({}, '__proto__.polluted', 123)
  assert(({} as any).polluted === undefined, 'setByPath → 原型污染路径不写入(防护生效)')

  // deleteByPath(对象属性 → delete;数组元素 → splice 避免稀疏数组,fix-dataops-write-correctness)
  const d: any = { a: { b: 1 } }
  assert(deleteByPath(d, 'a.b') === true, 'deleteByPath → 删除存在路径返 true')
  assert(d.a.b === undefined, 'deleteByPath → 已删除')
  assert(deleteByPath(d, 'a.b') === false, 'deleteByPath → 删除不存在路径返 false')
  assert(deleteByPath({}, '__proto__.x') === false, 'deleteByPath → 原型污染路径返 false')
  // 数组元素 → splice(length 递减、元素前移、无 empty 槽);原 delete 会留稀疏空位
  const arr: any[] = [{ id: 1 }, { id: 2 }, { id: 3 }]
  assert(deleteByPath(arr, '0') === true, 'deleteByPath → 数组元素删除返 true')
  assert(arr.length === 2 && arr[0].id === 2 && arr[1].id === 3, 'deleteByPath → 数组 splice:删 [0] 后 length 3→2、元素前移([1,2,3]→[2,3])')
  assert(0 in arr && 1 in arr && !(2 in arr), 'deleteByPath → 数组删除无稀疏空位(索引连续,无 empty 槽)')
  // applyPatchToClone/Live remove 数组分支(edit/eval patches remove 两入口汇聚于此)
  const cArr: any = { items: [1, 2, 3] }
  assert(applyPatchToClone(cArr, 'remove', 'items.1') === null, 'applyPatchToClone(remove 数组) → 成功返 null')
  assert(cArr.items.length === 2 && cArr.items[0] === 1 && cArr.items[1] === 3, 'applyPatchToClone(remove 数组) → splice 删中间项、前移')
  const liveArrDel: any = { items: [1, 2, 3] }
  applyPatchToLive(liveArrDel, 'remove', 'items.0', undefined)
  assert(liveArrDel.items.length === 2 && liveArrDel.items[0] === 2, 'applyPatchToLive(remove 数组) → splice 删首项、前移')
  // 对象属性删除仍走 delete(语义不变)
  const obj: any = { x: 1, y: 2 }
  deleteByPath(obj, 'x')
  assert(!('x' in obj) && obj.y === 2, 'deleteByPath → 对象属性 delete 语义不变(x 删除,y 保留)')

  // maybeParseValue
  assert((maybeParseValue('{"a":1}').parsed as any)?.a === 1, 'maybeParseValue → JSON 对象字符串解析')
  assert(maybeParseValue('5').parsed === 5, 'maybeParseValue → 裸数字字面量解析')
  assert(maybeParseValue('abc').parsed === 'abc', 'maybeParseValue → 非法裸字面量当原字符串')
  assert(maybeParseValue('{"a"').parseError !== undefined, 'maybeParseValue → 非法 JSON(以 { 开头)报 parseError')
  assert(maybeParseValue(5).parsed === 5, 'maybeParseValue → 非字符串原样返回')

  // projectFields
  assert(Object.keys(projectFields({ a: 1, b: 2, c: 3 }, ['a', 'c']) as any).sort().join(',') === 'a,c', 'projectFields → 只保留指定字段')
  const arrProj = projectFields([{ a: 1, b: 2 }, { a: 3, b: 4 }], ['a']) as any[]
  assert(arrProj.length === 2 && arrProj[0].a === 1 && arrProj[0].b === undefined, 'projectFields → 数组元素递归投影')

  // limitDepth
  const ld = limitDepth({ a: { b: { c: 1 } } }, 1) as any
  assert(ld.a === '{...}', 'limitDepth → depth=1 截断深层为 {...} 占位')
  assert(limitDepth([1, 2], 0) === '[...2]', 'limitDepth → depth=0 数组占位 [...n]')

  // safeStringify
  assert(safeStringify({ a: 1 }) === '{"a":1}', 'safeStringify → 基本序列化(indent 0)')
  assert(safeStringify('x'.repeat(20), 10).includes('已截断'), 'safeStringify → maxLen 截断')
  assert(safeStringify({ fn: () => 1 }).includes('Function'), 'safeStringify → 函数占位 [Function]')
  const cyc: any = {}
  cyc.self = cyc
  assert(safeStringify(cyc).includes('Circular'), 'safeStringify → 循环引用占位 [Circular]')

  // hashValue(底层 cyrb53,harden-optimistic-lock 升级 53-bit 降碰撞)
  assert(hashValue({ a: 1 }) === hashValue({ a: 1 }), 'hashValue → 相同值同 hash')
  assert(hashValue({ a: 1 }) !== hashValue({ a: 2 }), 'hashValue → 不同值不同 hash')
  assert(typeof hashValue({ a: 1 }) === 'string', 'hashValue → 返回 base36 字符串')
  // cyrb53:53-bit 非加密 hash(确定性 + 雪崩)
  assert(cyrb53('x') === cyrb53('x'), 'cyrb53 → 确定性(相同输入同输出)')
  assert(cyrb53('a') !== cyrb53('b'), 'cyrb53 → 不同输入不同输出(雪崩)')
  assert(cyrb53('') !== cyrb53('a'), 'cyrb53 → 空串 vs 非空串不同')
  assert(hashValue({ a: 1 }) !== hashValue({ a: 2, b: 1 }), 'hashValue → 碰撞抽样({a:1} vs {a:2,b:1} 不同)')

  // isUnsafePath / safeMerge
  assert(isUnsafePath('__proto__.x') === true, 'isUnsafePath → 检测 __proto__')
  assert(isUnsafePath('constructor.prototype') === true, 'isUnsafePath → 检测 constructor/prototype')
  assert(isUnsafePath('a.b.c') === false, 'isUnsafePath → 正常路径 false')
  const tgt: any = { a: 1 }
  safeMerge(tgt, JSON.parse('{"b":2,"__proto__":{"x":1}}'))
  assert(tgt.b === 2, 'safeMerge → 合法字段合并')
  assert(({} as any).x === undefined, 'safeMerge → __proto__ 原型污染键跳过(未污染原型)')

  // applyPatchToClone(四 op + 错误分支)
  const c1: any = { a: { b: 1 } }
  assert(applyPatchToClone(c1, 'set', 'a.b', 2) === null, 'applyPatchToClone(set) → 成功返 null')
  assert(c1.a.b === 2, 'applyPatchToClone(set) → 值已设')
  assert(applyPatchToClone({}, 'set', '', 1) === 'set 操作需要 jsonPath(整体替换请用 set_data)', 'applyPatchToClone(set 无 path) → 错误提示')
  const c2: any = { a: 1 }
  assert(applyPatchToClone(c2, 'remove', 'a') === null, 'applyPatchToClone(remove) → 成功')
  assert(c2.a === undefined, 'applyPatchToClone(remove) → 已删除')
  const c3: any = { a: { b: 1 } }
  applyPatchToClone(c3, 'merge', 'a', { c: 2 })
  assert(c3.a.c === 2 && c3.a.b === 1, 'applyPatchToClone(merge) → 合并而非替换')
  assert(applyPatchToClone({ a: 1 }, 'merge', 'a', {}) === 'merge 目标(a)不是对象', 'applyPatchToClone(merge 非对象) → 错误')
  const c4: any = { arr: [1] }
  applyPatchToClone(c4, 'append', 'arr', 2)
  assert(c4.arr.length === 2 && c4.arr[1] === 2, 'applyPatchToClone(append) → 追加单值')
  const c5: any = { arr: [1] }
  applyPatchToClone(c5, 'append', 'arr', [2, 3])
  assert(c5.arr.length === 3, 'applyPatchToClone(append 数组) → 展开追加')

  // applyPatchToLive(就地写 bind)
  const live: any = { a: { b: 1 } }
  applyPatchToLive(live, 'set', 'a.b', 9)
  assert(live.a.b === 9, 'applyPatchToLive(set) → 就地写子属性')

  // restoreInPlace / restoreLive(就地还原,保留容器引用)
  const r: any = { a: 1, b: 2 }
  restoreInPlace(r, { a: 10, c: 3 })
  assert(r.a === 10 && r.c === 3 && r.b === undefined, 'restoreInPlace → 对象就地还原(删旧加新)')
  const rArr: any[] = [1, 2, 3]
  restoreInPlace(rArr, [9, 8])
  assert(rArr.length === 2 && rArr[0] === 9 && rArr[1] === 8, 'restoreInPlace → 数组就地还原(保留容器)')
  const live2: any = { a: 1 }
  restoreLive(live2, { b: 2 })
  assert(live2.b === 2 && live2.a === undefined, 'restoreLive → 对象 bind 就地还原')
  const liveArr: any[] = [1, 2]
  restoreLive(liveArr, [7])
  assert(liveArr.length === 1 && liveArr[0] === 7, 'restoreLive → 数组 bind 就地还原')
}
