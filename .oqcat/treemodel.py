PATH = 'src/components/OxeQuery/tree-model.ts'
R = [
("import type { SqlExtensionInfo, SqlFunctionInfo, SqlObjects, SqlSearchHit, SqlSequenceInfo, SqlTable, SqlTriggerInfo, SqlTypeInfo, WorkspaceState } from '../../../shared/types/oxequery'\n",
 "import type { SqlExtensionInfo, SqlFunctionInfo, SqlObjects, SqlSearchHit, SqlSequenceInfo, SqlTable, SqlTriggerInfo, SqlTypeInfo, WorkspaceState } from '../../../shared/types/oxequery'\nimport { tq } from './catalog'\n"),
("export const CATEGORY_LABEL: Record<Category, string> = {\n  tables: 'Tables', views: 'Views', matviews: 'Materialized views', foreign: 'Foreign tables', functions: 'Functions', sequences: 'Sequences', types: 'Types', triggers: 'Triggers'\n}\n",
 "/** What a category is called in the tree, in the language on screen. */\nexport const categoryLabel = (category: Category): string => tq(`tree.category.${category}`)\n"),
("row(`${trigger.oid}`, `${trigger.name} on ${trigger.table}`,", "row(`${trigger.oid}`, tq('tree.triggerOn', { name: trigger.name, table: trigger.table }),"),
("label: 'Pinned', expanded: open, count: pinned.length", "label: tq('tree.pinned'), expanded: open, count: pinned.length"),
("label: loading?.has(schema) ? 'Loading…' : 'Nothing loaded.', schema", "label: loading?.has(schema) ? tq('common.loading') : tq('tree.nothingLoaded'), schema"),
("label: CATEGORY_LABEL[category],", "label: categoryLabel(category),"),
("label: `Showing ${loaded.tables.length} of ${loaded.total} relations. Search to reach the rest.`,", "label: tq('tree.partial', { shown: loaded.tables.length, count: loaded.total }),"),
("label: 'Extensions', expanded: open, count: extensions.length", "label: tq('tree.extensions'), expanded: open, count: extensions.length"),
]
