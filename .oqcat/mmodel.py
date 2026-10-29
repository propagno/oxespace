PATH = 'src/components/OxeQuery/mongo-model.ts'
R = [
("export const PAGE_SIZES = [25, 50, 100, 250, 500]\n", "import { tq } from './catalog'\n\nexport const PAGE_SIZES = [25, 50, 100, 250, 500]\n"),
("return optional ? null : 'This field is empty.'", "return optional ? null : tq('json.empty')"),
("return `Not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`", "return tq('json.invalid', { reason: error instanceof Error ? error.message : tq('json.parseError') })"),
("Array.isArray(value) ? null : 'Expected a JSON array.'", "Array.isArray(value) ? null : tq('json.array')"),
("!Array.isArray(value) ? null : 'Expected a JSON object.'", "!Array.isArray(value) ? null : tq('json.object')"),
]
