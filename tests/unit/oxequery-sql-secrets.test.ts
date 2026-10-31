import { describe, expect, it } from 'vitest'
import { containsSqlSecret, redactSqlSecrets } from '../../electron/main/services/oxequery/sql-secrets'

describe('redactSqlSecrets', () => {
  it('masks the literal after a password keyword and keeps the statement', () => {
    expect(redactSqlSecrets("ALTER ROLE app WITH LOGIN PASSWORD 'hunter2' VALID UNTIL 'infinity'")).toBe("ALTER ROLE app WITH LOGIN PASSWORD '***' VALID UNTIL 'infinity'")
    expect(redactSqlSecrets("CREATE USER x ENCRYPTED PASSWORD E'a''b'")).toBe("CREATE USER x ENCRYPTED PASSWORD '***'")
    expect(redactSqlSecrets('ALTER USER x PASSWORD $$s3cr3t$$')).toBe("ALTER USER x PASSWORD '***'")
  })

  it('masks option lists and connection strings', () => {
    expect(redactSqlSecrets("CREATE USER MAPPING FOR me SERVER s OPTIONS (user 'u', password = 'p4ss')")).toBe("CREATE USER MAPPING FOR me SERVER s OPTIONS (user 'u', password = '***')")
    expect(redactSqlSecrets("SELECT * FROM dblink('host=db user=app password=secret dbname=x', 'select 1')")).toBe("SELECT * FROM dblink('host=db user=app password=*** dbname=x', 'select 1')")
  })

  it('masks keys given to crypto functions and leaves ordinary SQL untouched', () => {
    expect(redactSqlSecrets("SELECT pgp_sym_encrypt(note, 'my key') FROM t")).toBe("SELECT pgp_sym_encrypt(note, '***') FROM t")
    const plain = "SELECT id, name FROM users WHERE email = 'a@b.c' AND status = 'active'"
    expect(redactSqlSecrets(plain)).toBe(plain)
    expect(containsSqlSecret(plain)).toBe(false)
    expect(containsSqlSecret("alter role a password 'x'")).toBe(true)
  })
})
