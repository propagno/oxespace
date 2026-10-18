/**
 * Passwords typed into SQL end up wherever the statement is kept: the run history stays for 90
 * days. This replaces the literal that follows a password keyword and leaves the rest of the
 * statement intact, so the history is still useful and still not a list of credentials.
 *
 *   ALTER ROLE app PASSWORD 'hunter2'            -> ALTER ROLE app PASSWORD '***'
 *   CREATE USER MAPPING … OPTIONS (password 'x') -> … OPTIONS (password '***')
 *   host=db user=app password=secret             -> host=db user=app password=***
 */
const MASK = '***'

export function redactSqlSecrets(sql: string): string {
  return sql
    // PASSWORD '...' / ENCRYPTED PASSWORD E'...' / password $$...$$ (SQL keyword form)
    .replace(/(\bpassword\s+)(?:E|U&)?('(?:[^']|'')*'|\$([A-Za-z_]*)\$[\s\S]*?\$\3\$)/gi, (_m, key: string) => `${key}'${MASK}'`)
    // password = '...' (option lists, SET, connection options)
    .replace(/(\b(?:password|passwd|pwd|secret|token|api_?key)\s*=\s*)('(?:[^']|'')*'|[^\s;,')]+)/gi, (_m, key: string, value: string) => `${key}${value.startsWith("'") ? `'${MASK}'` : MASK}`)
    // functions that take a key or secret as their second argument
    .replace(/(\b(?:pgp_sym_encrypt|pgp_sym_decrypt|crypt|encrypt|decrypt|hmac)\s*\([^,()]*,\s*)('(?:[^']|'')*')/gi, (_m, head: string) => `${head}'${MASK}'`)
}

export const containsSqlSecret = (sql: string): boolean => /\b(password|passwd|pwd|secret|token|api_?key|pgp_sym_|crypt\s*\(|hmac\s*\()/i.test(sql)
