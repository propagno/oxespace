import type { Point, TreeCursor, Edit, Tree } from 'web-tree-sitter'

/**
 * Non-null view of web-tree-sitter's `Node`.
 *
 * web-tree-sitter 0.25.x types `children`/`namedChildren` (and the child
 * accessors) as nullable — `(Node | null)[]` — which breaks every extractor that
 * does `node.namedChildren.find((c: SyntaxNode) => …)` (196 "No overload" type
 * errors). We pin 0.25.x for a runtime reason (its dylink format is the one the
 * bundled tree-sitter-wasms grammars load with), so the fix is type-only: this
 * interface mirrors the runtime Node shape but keeps child arrays NON-NULL and
 * threads `SyntaxNode` through every node-returning member. The single raw→view
 * conversion happens at the parse boundary (`tree.rootNode`). TYPE-ONLY — no
 * runtime effect.
 */
export interface SyntaxNode {
  id: number
  startIndex: number
  startPosition: Point
  tree: Tree
  readonly typeId: number
  readonly grammarId: number
  readonly type: string
  readonly grammarType: string
  readonly isNamed: boolean
  readonly isExtra: boolean
  readonly isError: boolean
  readonly isMissing: boolean
  readonly hasChanges: boolean
  readonly hasError: boolean
  readonly endIndex: number
  readonly endPosition: Point
  readonly text: string
  readonly parseState: number
  readonly nextParseState: number
  equals(other: SyntaxNode): boolean
  child(index: number): SyntaxNode | null
  namedChild(index: number): SyntaxNode | null
  childForFieldId(fieldId: number): SyntaxNode | null
  childForFieldName(fieldName: string): SyntaxNode | null
  fieldNameForChild(index: number): string | null
  fieldNameForNamedChild(index: number): string | null
  childrenForFieldName(fieldName: string): SyntaxNode[]
  childrenForFieldId(fieldId: number): SyntaxNode[]
  firstChildForIndex(index: number): SyntaxNode | null
  firstNamedChildForIndex(index: number): SyntaxNode | null
  readonly childCount: number
  readonly namedChildCount: number
  readonly firstChild: SyntaxNode | null
  readonly firstNamedChild: SyntaxNode | null
  readonly lastChild: SyntaxNode | null
  readonly lastNamedChild: SyntaxNode | null
  readonly children: SyntaxNode[]
  readonly namedChildren: SyntaxNode[]
  descendantsOfType(types: string | string[], startPosition?: Point, endPosition?: Point): SyntaxNode[]
  readonly nextSibling: SyntaxNode | null
  readonly previousSibling: SyntaxNode | null
  readonly nextNamedSibling: SyntaxNode | null
  readonly previousNamedSibling: SyntaxNode | null
  readonly descendantCount: number
  readonly parent: SyntaxNode | null
  childWithDescendant(descendant: SyntaxNode): SyntaxNode | null
  descendantForIndex(start: number, end?: number): SyntaxNode | null
  namedDescendantForIndex(start: number, end?: number): SyntaxNode | null
  descendantForPosition(start: Point, end?: Point): SyntaxNode | null
  namedDescendantForPosition(start: Point, end?: Point): SyntaxNode | null
  walk(): TreeCursor
  edit(edit: Edit): void
  toString(): string
}
