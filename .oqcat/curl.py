PATH = 'src/components/OxeQuery/connection-url.ts'
R = [
("const DEFAULT_PORT: Record<DatabaseEngine, number> = { postgres: 5432, mongodb: 27017 }\n",
 "const DEFAULT_PORT: Record<DatabaseEngine, number> = { postgres: 5432, mongodb: 27017 }\n\n/** Why a connection string could not be read; the dialog words it in the language on screen (oxequery `url.*`). */\nexport type ConnectionUrlError = 'empty' | 'noScheme' | 'unsupported' | 'noHost' | 'severalPostgres' | 'srvOneHost' | 'badHost'\n"),
(" * so a pasted URL fills the whole form. Returns an error message rather than\n * throwing.", " * so a pasted URL fills the whole form. Returns an error code rather than\n * throwing."),
("export function parseConnectionUrl(input: string): { ok: true; value: ParsedConnectionUrl } | { ok: false; error: string } {",
 "export function parseConnectionUrl(input: string): { ok: true; value: ParsedConnectionUrl } | { ok: false; error: ConnectionUrlError; scheme?: string } {"),
("return { ok: false, error: 'Paste a connection string such as postgres://user:password@localhost:5432/app' }", "return { ok: false, error: 'empty' }"),
("return { ok: false, error: 'A connection string starts with postgres:// or mongodb://' }", "return { ok: false, error: 'noScheme' }"),
("return { ok: false, error: `Unsupported scheme \"${scheme}\". Use postgres:// or mongodb://` }", "return { ok: false, error: 'unsupported', scheme }"),
("return { ok: false, error: 'The connection string has no host.' }", "return { ok: false, error: 'noHost' }"),
("return { ok: false, error: 'Several PostgreSQL hosts are not supported. Enter a single host.' }", "return { ok: false, error: 'severalPostgres' }"),
("return { ok: false, error: 'A mongodb+srv address is one DNS name, without a port.' }", "return { ok: false, error: 'srvOneHost' }"),
("return { ok: false, error: 'That connection string could not be read: a host or port is invalid.' }", "return { ok: false, error: 'badHost' }"),
]
