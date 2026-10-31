// Opt-in Linux ANGLE/Vulkan: hardware or Mesa software, as observed by probes.
// Keep the ordinary Playwright backend unchanged unless explicitly requested.
export const chromiumLaunchOptions =
  process.env.E2E_CHROMIUM_VULKAN === '1'
    ? { args: ['--enable-gpu', '--use-angle=vulkan'] }
    : {}
