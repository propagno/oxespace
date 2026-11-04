/* Workspace helpers with no component imports, so the chrome (title bar, status bar) can use them without an import cycle. */
import { S } from './store'
import { WORKSPACES, type Workspace } from '../mock/workspaces'

export const wsList = () => (S.wsOrder || WORKSPACES.map(w => w.id)).map(id => WORKSPACES.find(w => w.id === id)!).filter(w => w && !S.wsGone?.includes(w.id))
export const wsName = (w: Workspace) => S.wsNames?.[w.id] || w.name
export const wsColor = (w: Workspace) => S.wsColors?.[w.id] ?? w.color
export function curWs (): Workspace { return WORKSPACES.find(w => w.id === S.ws) || WORKSPACES[1] }
