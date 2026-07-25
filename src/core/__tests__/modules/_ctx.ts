export interface TestCtx {
  assert: (cond: any, msg: string) => void
  invoke: (tool: any, args: any) => Promise<string>
  byName: (tools: any[]) => Record<string, any>
}
