// js-yaml ships no types and @types/js-yaml is not a dependency. Only the
// safe-by-default `load` of js-yaml 4.x is used, so that is all declared.
declare module 'js-yaml' {
  export function load(input: string, options?: { json?: boolean }): unknown
}
