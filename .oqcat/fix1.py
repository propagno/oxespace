PATH = 'src/components/OxeQuery/oxequery.store.ts'
R = [
("  | { id: 'containers'; kind: 'containers'; title: string }\n  | { id: 'activity'; kind: 'activity'; title: string }", "  | { id: 'containers'; kind: 'containers' }\n  | { id: 'activity'; kind: 'activity' }"),
("const CONTAINERS: OxeQueryTab = { id: 'containers', kind: 'containers', title: 'Containers' }\nconst ACTIVITY: OxeQueryTab = { id: 'activity', kind: 'activity', title: 'Activity' }",
 "// The fixed tabs are named by the view, in the language on screen; a connection tab is named after it.\nconst CONTAINERS: OxeQueryTab = { id: 'containers', kind: 'containers' }\nconst ACTIVITY: OxeQueryTab = { id: 'activity', kind: 'activity' }"),
]
