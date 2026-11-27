import { createIcon } from './Icon'

/** Agents in parallel: one task branching cleanly into two parallel nodes. */
export const AgentsIcon = createIcon(
  'agents',
  <>
    <circle cx="8" cy="12.5" r="1.75" />
    <circle cx="4" cy="3.5" r="1.75" />
    <circle cx="12" cy="3.5" r="1.75" />
    <path d="M8 10.75V8.5M4 5.25V7a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 12 7V5.25" />
  </>
)
