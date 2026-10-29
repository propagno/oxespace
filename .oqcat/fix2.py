import runpy
FILES = {
 'src/components/OxeQuery/CollectionFacts.tsx': [
  ("{t('facts.rules')} (<code>$jsonSchema</code>)", "{t('facts.rules')} (<code>{EXAMPLE.jsonSchemaKeyword}</code>)"),
  ("placeholder={'{ \"$jsonSchema\": { \"bsonType\": \"object\", \"required\": [\"name\"] } }'}", "placeholder={EXAMPLE.jsonSchema}"),
  ("import { formatBytes } from './catalog'\n", "import { formatBytes } from './catalog'\nimport { EXAMPLE } from './examples'\n"),
 ],
 'src/components/OxeQuery/ConnectionDialog.tsx': [
  ('placeholder="admin" spellCheck={false}', 'placeholder={EXAMPLE.authSource} spellCheck={false}'),
  ('placeholder="ssn&#10;card_number"', 'placeholder={EXAMPLE.maskedNames}'),
  ("components={{ strong: <strong />, code: <code /> }} />}", "components={STRONG_AND_CODE} />}"),
  ("import { formatMs } from './catalog'\n", "import { formatMs } from './catalog'\nimport { EXAMPLE } from './examples'\n\nconst STRONG_AND_CODE = { strong: <strong />, code: <code /> }\n"),
 ],
 'src/components/OxeQuery/ContainersPanel.tsx': [
  ("{ title: `${project} · ${t(`compose.${action}`)}`, text:", "{ title: t('compose.outputTitle', { project, action: t(`compose.${action}`) }), text:"),
  ('placeholder="ls -la /var/lib"', 'placeholder={EXAMPLE.command}'),
  ("onChange={event => setShell(event.target.value as 'sh' | 'bash')}><option value=\"sh\">sh</option><option value=\"bash\">bash</option></Select>",
   "onChange={event => setShell(event.target.value as 'sh' | 'bash')}>{SHELLS.map(name => <option key={name} value={name}>{name}</option>)}</Select>"),
  ("import { formatDateTime, formatNumber } from '../../utils/formatTime'\n", "import { formatDateTime, formatNumber } from '../../utils/formatTime'\nimport { EXAMPLE, SHELLS } from './examples'\n"),
 ],
 'src/components/OxeQuery/ImportDialog.tsx': [
  ("<option value=\"utf-8\">UTF-8</option><option value=\"windows-1252\">{t('import.windows1252')}</option>\n            <option value=\"utf-16le\">UTF-16 LE</option><option value=\"utf-16be\">UTF-16 BE</option></Select></label>",
   "<option value=\"windows-1252\">{t('import.windows1252')}</option>\n            {PLAIN_ENCODINGS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</Select></label>"),
  ("import { formatBytes } from './catalog'\n", "import { formatBytes } from './catalog'\nimport { PLAIN_ENCODINGS } from './examples'\n"),
 ],
 'src/components/OxeQuery/StructureParts.tsx': [
  ('placeholder="price >= 0"', 'placeholder={EXAMPLE.checkExpression}'),
  ('placeholder="deleted_at IS NULL"', 'placeholder={EXAMPLE.partialIndex}'),
  ("import styles from './StructureEditor.module.css'\n", "import styles from './StructureEditor.module.css'\nimport { EXAMPLE } from './examples'\n"),
 ],
 'src/components/OxeQuery/sql-completion.ts': [
  ("detail: `${target.table}.${column.type}`,", "detail: [target.table, column.type].join('.'),"),
 ],
 'src/components/OxeQuery/tree-model.ts': [
  ("label: `${pin.schema}.${pin.name}`,", "label: [pin.schema, pin.name].join('.'),"),
  ("label: `${extension.name} ${extension.version}`,", "label: [extension.name, extension.version].join(' '),"),
 ],
}
for path, R in FILES.items():
    s = open(path, encoding='utf8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'
    s = s.replace('\r\n', '\n')
    for old, new in R:
        if old not in s: print('MISSING', path, old[:70]); continue
        s = s.replace(old, new)
    open(path, 'w', encoding='utf8', newline='').write(s.replace('\n', nl))
print('done')
