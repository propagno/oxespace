/**
 * The executable a test uses for a plain Node child. Under `npm run test:electron`, `process.execPath` is the Electron
 * binary: spawned without ELECTRON_RUN_AS_NODE (a test that hands the child a minimal environment), it starts as an
 * app and opens "Unable to find Electron app" on the person's screen. So under Electron a Node child is the system
 * `node`, never the Electron binary (and never through ELECTRON_RUN_AS_NODE, which the packaged app turns off, B13).
 */
export const NODE_EXECUTABLE: string = process.versions.electron ? 'node' : process.execPath

/**
 * Arguments for a child that reports which of `names` it sees in its environment, and nothing else: a probe never
 * prints the whole environment (it may hold a live app's variables, #337).
 */
export function envNamesProbeArgs(names: readonly string[]): string[] {
  return ['-e', 'const n=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify(n.filter(k=>Object.prototype.hasOwnProperty.call(process.env,k))))', JSON.stringify(names)]
}
