/**
 * No test run ever shows a system dialog on the runner's screen. A native dialog opened by the app under test lands on
 * the desktop of whoever runs the suite (a person's own machine, not only CI), blocks until someone clicks it, and can
 * look like the real app asking for something. So every E2E launch replaces Electron's dialogs with recorders that
 * answer "cancel", before the app's main process loads:
 *   - e2e/electron-main.cjs installs them for every launch of the built app;
 *   - e2e/helpers/electron-close.ts installs them right after launch for a packaged executable.
 * Every call is kept in `globalThis.__oxeNativeDialogs` ({ method, title, message, answer }), so a spec can assert that
 * nothing reached the native fallback. A spec that needs the real dialogs opts in with OXESPACE_E2E_NATIVE_DIALOGS=1.
 * OXESPACE_E2E_NATIVE_DIALOGS=hold keeps the async message boxes unanswered (recorded, never resolved), as a person who
 * has not clicked yet: what a spec needs to see requests pile up behind the native fallback.
 * A spec may still replace a method with its own answer after launch (app.evaluate); that replaces this one.
 *
 * The answer is the safe one: `cancelId` when given, else the button that reads as cancel/deny/no, else the last button
 * for a question with several (Electron puts the affirmative first by convention), else 0; open and save dialogs are
 * canceled. Self-contained (no requires), so electron-close.ts can send its source to a packaged app.
 */
function installNativeDialogStubs(dialog, env, store) {
  if (!dialog || (env && env.OXESPACE_E2E_NATIVE_DIALOGS === '1')) return false
  const target = store || globalThis
  const calls = target.__oxeNativeDialogs || (target.__oxeNativeDialogs = [])
  const optionsOf = args => args.find(a => a && typeof a === 'object' && !('webContents' in a)) || (typeof args[0] === 'string' ? { title: args[0], message: args[1] } : {})
  const SAFE = /^(cancel|cancelar|deny|negar|no|não|nao|don't|não permitir|close|fechar|keep|manter)/i
  const safeButton = options => {
    if (Number.isInteger(options.cancelId)) return options.cancelId
    const buttons = Array.isArray(options.buttons) ? options.buttons : []
    const index = buttons.findIndex(label => SAFE.test(String(label).trim()))
    if (index >= 0) return index
    return buttons.length > 1 ? buttons.length - 1 : 0
  }
  const record = (method, args, answer) => {
    const options = optionsOf(args)
    calls.push({ method, title: String(options.title || '').slice(0, 200), message: String(options.message || '').slice(0, 200), answer })
    return answer
  }
  const hold = !!env && env.OXESPACE_E2E_NATIVE_DIALOGS === 'hold'
  dialog.showMessageBox = (...args) => hold
    ? (record('showMessageBox', args, 'held'), new Promise(() => undefined))
    : Promise.resolve({ response: record('showMessageBox', args, safeButton(optionsOf(args))), checkboxChecked: false })
  dialog.showMessageBoxSync = (...args) => record('showMessageBoxSync', args, safeButton(optionsOf(args)))
  dialog.showOpenDialog = async (...args) => { record('showOpenDialog', args, 'canceled'); return { canceled: true, filePaths: [] } }
  dialog.showOpenDialogSync = (...args) => { record('showOpenDialogSync', args, 'canceled'); return undefined }
  dialog.showSaveDialog = async (...args) => { record('showSaveDialog', args, 'canceled'); return { canceled: true, filePath: '' } }
  dialog.showSaveDialogSync = (...args) => { record('showSaveDialogSync', args, 'canceled'); return undefined }
  dialog.showErrorBox = (...args) => { record('showErrorBox', args, 'shown'); }
  dialog.showCertificateTrustDialog = async (...args) => { record('showCertificateTrustDialog', args, 'canceled') }
  return true
}

module.exports = { installNativeDialogStubs }
