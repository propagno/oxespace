/* Small primitives shared by every screen. Names follow src/ui in the app where one exists. */
import type { ReactNode, MouseEvent } from 'react'
import { PATHS, CACTUS } from './icons'
import { S, emit, openMenu, prov } from '../state/store'
import type { Access } from '../mock/types'

export function Icon ({ n, s }: { n: string; s?: 12 | 16 }) {
  return <svg className={'i' + (s ? ' s' + s : '')} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PATHS[n] || '' }} />
}
export const Logo = () => <span className="logo"><svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: CACTUS }} /></span>
export function Av ({ p, size }: { p: string; size?: 's16' | 'lg' }) {
  return <span className={`av c ${p} ${size || ''}`} title={prov(p).name}>{prov(p).initial}</span>
}
export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="k">{children}</kbd>
/** Mock strings carry a little markup (<b>, <code>, lists); they are ours, not user input. */
export const Html = ({ html, as = 'span', className }: { html: string; as?: 'span' | 'div'; className?: string }) =>
  as === 'div' ? <div className={className} dangerouslySetInnerHTML={{ __html: html }} /> : <span className={className} dangerouslySetInnerHTML={{ __html: html }} />

export function Gauge ({ level }: { level: string }) {
  const n = ({ Low: 1, Medium: 2, High: 3, Max: 4 } as Record<string, number>)[level] || 2; const c = 2 * Math.PI * 6
  return <svg className="gauge" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".28" strokeWidth="2.2" /><circle cx="8" cy="8" r="6" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeDasharray={`${c * n / 4} ${c}`} transform="rotate(-90 8 8)" /></svg>
}
export function Ring ({ pct }: { pct: number }) {
  const r = 8, c = 2 * Math.PI * r
  return <span className="ring" title={`Context ${pct}% used`}><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r={r} fill="none" stroke="var(--fill-pressed)" strokeWidth="2.5" /><circle cx="10" cy="10" r={r} fill="none" stroke={pct >= 80 ? 'var(--warning)' : 'var(--accent)'} strokeWidth="2.5" strokeDasharray={`${c * pct / 100} ${c}`} transform="rotate(-90 10 10)" strokeLinecap="round" /></svg></span>
}
export const ACCESS: Record<Access, [string, string, string]> = { read: ['eye', 'Read only', 'read'], edit: ['pencil', 'Can edit', 'edit'], full: ['shieldx', 'Full access', 'full'] }

/** Opens a menu or popover anchored to the clicked element. */
export const menuBtn = (id: string, pop = false) => (e: MouseEvent<HTMLElement>) => { e.stopPropagation(); openMenu(id, e.currentTarget, pop); emit() }

export function MI ({ icon, label, hint, sc, dz, dis, check, title, onClick }: { icon?: string; label: ReactNode; hint?: string; sc?: string; dz?: boolean; dis?: boolean; check?: boolean; title?: string; onClick?: () => void }) {
  return <button className={'mi' + (dz ? ' dz' : '')} role={check != null ? 'menuitemradio' : 'menuitem'} aria-checked={check != null ? check : undefined} aria-disabled={dis || undefined} title={title}
    onClick={e => { e.stopPropagation(); if (dis) return; S.menu = null; onClick && onClick(); emit() }}>
    {check != null ? <span className="ck">{check ? <Icon n="check" /> : null}</span> : icon ? <Icon n={icon} /> : <span />}
    <span>{label}{hint ? <small>{hint}</small> : null}</span><span className="sc">{sc || ''}</span>
  </button>
}

export function StateBlock ({ kind, icon, title, text, children }: { kind: 'loading' | 'error' | 'empty'; icon?: string; title?: string; text?: ReactNode; children?: ReactNode }) {
  if (kind === 'loading') return <div className="skl" aria-busy="true" aria-label="Loading"><div className="sk" style={{ height: 22, width: '40%' }} /><div className="sk" style={{ height: 14, width: '70%' }} />{[92, 64, 80, 56].map((w, i) => <div key={i} className="sk" style={{ height: i % 2 ? 28 : 52, width: w + '%' }} />)}</div>
  if (kind === 'error') return <div className="state err" role="alert"><span className="ico"><Icon n="warn" s={16} /></span><h3>{title || 'Couldn\'t load this task'}</h3><p>{text || 'The local database didn\'t answer in 5 s. Your work is safe; nothing was lost.'}</p>
    <div className="row"><button className="btn pri" onClick={() => { S.view = 'loading'; emit(); setTimeout(() => { S.view = 'live'; emit() }, 900) }}><Icon n="refresh" s={12} />Try again</button><button className="btn ghost" onClick={() => { S.overlay = { type: 'dlg', id: 'report' }; emit() }}>Report a problem</button></div></div>
  return <div className="state"><span className="ico"><Icon n={icon || 'list'} s={16} /></span><h3>{title}</h3><p>{text}</p>{children ? <div className="row">{children}</div> : null}</div>
}

export function Soon ({ msg, children, className = 'btn', ...rest }: { msg: string; children: ReactNode; className?: string; title?: string; 'aria-label'?: string; disabled?: boolean }) {
  return <button className={className} {...rest} onClick={() => { toastSoon(msg) }}>{children}</button>
}
import { toast } from '../state/store'
export const toastSoon = (msg: string) => { toast(msg); emit() }
