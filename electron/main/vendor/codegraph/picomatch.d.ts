/**
 * Minimal ambient declaration for `picomatch`, which ships no types.
 *
 * The vendored CodeGraph resolution code uses it only for glob matching
 * (default import → matcher factory). A precise upstream type isn't needed
 * here, so this keeps the build self-contained without pulling @types/picomatch.
 */
declare module 'picomatch' {
  type Matcher = (test: string) => boolean
  interface PicomatchOptions {
    dot?: boolean
    nocase?: boolean
    [key: string]: unknown
  }
  const picomatch: (glob: string | string[], options?: PicomatchOptions) => Matcher
  export default picomatch
}
