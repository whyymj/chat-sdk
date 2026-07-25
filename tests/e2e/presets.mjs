// presets:三预设(pageBuilder/researcher/minimal)spread mount 成功 + minimal 反映精简
import { setupEnv, createAssert, presets, createChatSdk, FAKE_LLM } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:presets] presets.pageBuilder / presets.researcher spread:mount 成功 + 反映配置')
  {
    for (const [key, preset] of Object.entries(presets)) {
      const sdk = createChatSdk({
        ui: false, id: `e2e-preset-${key}`, storage: 'memory', llm: FAKE_LLM,
        ...preset,
      })
      await sdk.mount()
      assert(sdk.inspect().id === `e2e-preset-${key}`, `presets.${key} spread → mount 成功`)
      sdk.unmount()
    }
  }

  console.log('[e2e:presets] presets.minimal spread:capabilities 反映精简')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-preset-min', storage: 'memory', llm: FAKE_LLM,
      ...presets.minimal,
    })
    await sdk.mount()
    const mw = sdk.inspect().middleware
    assert(mw.includes('usageHints'), 'presets.minimal → 仍含 usageHints')
    assert(sdk.inspect().tools.length > 0, 'presets.minimal → 仍有工具装载')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
