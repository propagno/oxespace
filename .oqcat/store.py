PATH = 'src/components/OxeQuery/oxequery.store.ts'
R = [
("  dialog: { open: boolean; editing: OxeQueryConnection | null }\n", "  dialog: { open: boolean; editing: OxeQueryConnection | null }\n  /** OxeQuery settings dialog; in the store so the palette opens it whether or not the sidebar is expanded. */\n  preferencesOpen: boolean\n"),
("  closeDialog(): void\n", "  closeDialog(): void\n  setPreferencesOpen(open: boolean): void\n"),
("selectedContainer: null, dialog: { open: false, editing: null },", "selectedContainer: null, dialog: { open: false, editing: null }, preferencesOpen: false,"),
("  closeDialog: () => set({ dialog: { open: false, editing: null } }),\n", "  closeDialog: () => set({ dialog: { open: false, editing: null } }),\n  setPreferencesOpen: open => set({ preferencesOpen: open }),\n"),
]
