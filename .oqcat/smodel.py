PATH = 'src/components/OxeQuery/structure-model.ts'
R = [
("import type { ColumnDef, ConstraintDef, CreateTableDef, IndexDef, TableChange } from '../../../shared/types/oxequery-structure'\n",
 "import type { ColumnDef, ConstraintDef, CreateTableDef, IndexDef, TableChange } from '../../../shared/types/oxequery-structure'\nimport { tq } from './catalog'\n"),
("problems.push('Give the table a name.')", "problems.push(tq('structure.problem.tableName'))"),
("problems.push('A table needs at least one column.')", "problems.push(tq('structure.problem.oneColumn'))"),
("problems.push('Every column needs a name.')", "problems.push(tq('structure.problem.columnName'))"),
("problems.push(`Two columns are called \"${name}\".`)", "problems.push(tq('structure.problem.duplicate', { name }))"),
("problems.push(`\"${name}\" needs a type.`)", "problems.push(tq('structure.problem.type', { name }))"),
("problems.push(`\"${name}\" cannot have both an identity and a default.`)", "problems.push(tq('structure.problem.identityDefault', { name }))"),
("problems.push('A check constraint needs an expression.')", "problems.push(tq('structure.problem.checkExpression'))"),
("problems.push(`A ${constraint.kind === 'primary' ? 'primary key' : constraint.kind === 'unique' ? 'unique constraint' : 'foreign key'} needs columns.`)", "problems.push(tq(`structure.problem.columns.${constraint.kind}`))"),
("problems.push('A foreign key needs the table and columns it points to.')", "problems.push(tq('structure.problem.foreignTarget'))"),
("problems.push('Every index needs a name.')", "problems.push(tq('structure.problem.indexName'))"),
("problems.push(`Index \"${index.name || '(unnamed)'}\" needs columns.`)", "problems.push(tq('structure.problem.indexColumns', { name: index.name || tq('structure.unnamed') }))"),
]
