// Punycode (RFC 3492) decoding for host names, so a link's host can be shown in both forms: the `xn--` one the
// browser resolves and the Unicode one a person reads. Lookalike hosts (`раураl.com`) show up when the two differ.
const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, INITIAL_BIAS = 72, INITIAL_N = 128

function adapt(delta: number, points: number, first: boolean): number {
  let k = 0
  delta = first ? Math.floor(delta / DAMP) : delta >> 1
  delta += Math.floor(delta / points)
  for (; delta > ((BASE - TMIN) * TMAX) >> 1; k += BASE) delta = Math.floor(delta / (BASE - TMIN))
  return Math.floor(k + ((BASE - TMIN + 1) * delta) / (delta + SKEW))
}

function digit(code: number): number {
  if (code >= 48 && code <= 57) return code - 22
  if (code >= 65 && code <= 90) return code - 65
  if (code >= 97 && code <= 122) return code - 97
  return BASE
}

/** Decodes one label's Punycode body (without `xn--`); null when it is not valid Punycode. */
export function decodePunycodeLabel(input: string): string | null {
  const output: number[] = []
  const basic = input.lastIndexOf('-')
  for (let j = 0; j < Math.max(basic, 0); j++) {
    if (input.charCodeAt(j) >= 0x80) return null
    output.push(input.charCodeAt(j))
  }
  let n = INITIAL_N, bias = INITIAL_BIAS, i = 0
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length;) {
    const oldi = i
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) return null
      const d = digit(input.charCodeAt(index++))
      if (d >= BASE) return null
      i += d * w
      if (i > 0x7fffffff) return null
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias
      if (d < t) break
      w *= BASE - t
    }
    const length = output.length + 1
    bias = adapt(i - oldi, length, oldi === 0)
    n += Math.floor(i / length)
    i %= length
    if (n > 0x10ffff) return null
    output.splice(i++, 0, n)
  }
  return String.fromCodePoint(...output)
}

/** The Unicode form of an ASCII host (`xn--` labels decoded); labels that do not decode stay as they are. */
export function toUnicodeHost(host: string): string {
  return host.split('.').map(label => {
    if (!/^xn--/i.test(label)) return label
    return decodePunycodeLabel(label.slice(4)) ?? label
  }).join('.')
}
