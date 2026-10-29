PATH = 'tests/unit/oxequery-connection-url.test.ts'
R = [
("expect(parseConnectionUrl('')).toMatchObject({ ok: false })", "expect(parseConnectionUrl('')).toMatchObject({ ok: false, error: 'empty' })"),
("toMatchObject({ ok: false, error: expect.stringContaining('starts with') })", "toMatchObject({ ok: false, error: 'noScheme' })"),
("toMatchObject({ ok: false, error: expect.stringContaining('Unsupported') })", "toMatchObject({ ok: false, error: 'unsupported', scheme: 'mysql' })"),
("toMatchObject({ ok: false, error: expect.stringContaining('Several PostgreSQL hosts') })", "toMatchObject({ ok: false, error: 'severalPostgres' })"),
("toMatchObject({ ok: false, error: expect.stringContaining('one DNS name') })", "toMatchObject({ ok: false, error: 'srvOneHost' })"),
("expect(parseConnectionUrl('postgres://h:99999/db')).toMatchObject({ ok: false })", "expect(parseConnectionUrl('postgres://h:99999/db')).toMatchObject({ ok: false, error: 'badHost' })"),
]
