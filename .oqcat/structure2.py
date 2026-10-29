PATH = 'src/components/OxeQuery/StructureEditor.tsx'
R = [
("onClick={() => void maintain('vacuum')}>VACUUM</Button>", "onClick={() => void maintain('vacuum')}>{MAINTENANCE_SQL.vacuum}</Button>"),
("onClick={() => void maintain('analyze')}>ANALYZE</Button>", "onClick={() => void maintain('analyze')}>{MAINTENANCE_SQL.analyze}</Button>"),
("onClick={() => void maintain('vacuum-analyze')}>VACUUM ANALYZE</Button>", "onClick={() => void maintain('vacuum-analyze')}>{MAINTENANCE_SQL['vacuum-analyze']}</Button>"),
("title={t('structure.reindexTitle')}>REINDEX</Button>", "title={t('structure.reindexTitle')}>{MAINTENANCE_SQL.reindex}</Button>"),
("type TabId = 'columns' | 'constraints' | 'indexes' | 'table'\n", "type TabId = 'columns' | 'constraints' | 'indexes' | 'table'\n/** Maintenance buttons carry the PostgreSQL command they run, the same in every language. */\nconst MAINTENANCE_SQL: Record<MaintenanceAction, string> = { vacuum: 'VACUUM', analyze: 'ANALYZE', 'vacuum-analyze': 'VACUUM ANALYZE', reindex: 'REINDEX' }\n"),
]
