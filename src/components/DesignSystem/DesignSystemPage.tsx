import { useState, type ReactElement, type ReactNode } from 'react'
import { Bell, Copy, GitBranch, MoreHorizontal, Plus, Search, Trash2, X } from 'lucide-react'
import { OxeLogo } from '../Brand/OxeLogo'
import { colorRoles } from '../../design/tokens/semantic'
import { palette, SCALE_SPECS, type ScaleName } from '../../design/tokens/palette'
import { MOTION, RADIUS, REDUCED_MOTION, SPACE, TEXT } from '../../design/tokens/scales'
import { Badge, BrandLoader, Button, ButtonGroup, Checkbox, Dialog, EmptyState, Notice, OfflineState, SuccessState, ErrorState, IconButton, Kbd, LoadingState, Menu, Meter, Panel, SegmentedControl, Select, Skeleton, Spinner, StatusDot, Switch, Tabs, TextArea, TextField, Toolbar, ToolbarSpacer, Tooltip, toast, useModalSurface } from '../../ui'
import styles from './DesignSystemPage.module.css'

type Section = 'brand' | 'color' | 'type' | 'shape' | 'motion' | 'components' | 'states'
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'brand', label: 'Brand' }, { id: 'color', label: 'Color' }, { id: 'type', label: 'Type' },
  { id: 'shape', label: 'Space, shape, depth' }, { id: 'motion', label: 'Motion' }, { id: 'components', label: 'Components' }, { id: 'states', label: 'States' }
]

/** Renders `children` twice, once per mode, using data-mode subtrees. */
function BothModes({ children }: { children: () => ReactNode }): ReactElement {
  return <div className={styles.modes}>
    {(['light', 'dark'] as const).map(mode => <div key={mode} className={styles.mode} data-mode={mode}><span className={styles.modeLabel}>{mode}</span>{children()}</div>)}
  </div>
}

function BrandSection(): ReactElement {
  return <>
    <h2 className={styles.sectionTitle}>Mark and wordmark</h2>
    <BothModes>{() => <div className={styles.brandTile}><OxeLogo size={64} variant="hero" /><div className={styles.row}><OxeLogo size={32} /><OxeLogo size={24} variant="compact" /><OxeLogo size={20} variant="wordmark" /></div></div>}</BothModes>
    <h2 className={styles.sectionTitle}>Brand scales</h2>
    <BothModes>{() => <ScaleList names={['caatinga', 'sun']} />}</BothModes>
  </>
}

function ScaleList({ names }: { names: ScaleName[] }): ReactElement {
  // A subtree's mode is only known in CSS, so both palettes are rendered and each column shows its own.
  return <div className={styles.stack}>{names.map(name => <div key={name} className={styles.scaleRow}><span>{name} · {SCALE_SPECS[name].hue}°</span>
    <div className={styles.scale}>{Array.from({ length: 12 }, (_, step) => <span key={step} style={{ background: `var(--ds-${name}-${step + 1})` }} title={`${name} ${step + 1}`} />)}</div></div>)}</div>
}

/** Exposes the raw scales as --ds-* variables for the viewer only, per mode. */
function ScaleVariables(): ReactElement {
  const css = (['light', 'dark'] as const).map(mode => {
    const vars = Object.entries(palette(mode)).flatMap(([name, scale]) => scale.map((value, index) => `--ds-${name}-${index + 1}: ${value};`)).join(' ')
    return `[data-mode='${mode}'] { ${vars} }`
  }).join('\n')
  return <style>{css}</style>
}

function ColorSection(): ReactElement {
  const roles = Object.keys(colorRoles('light')).filter(name => !name.startsWith('ansi-'))
  const groups: Array<[string, (name: string) => boolean]> = [
    ['Surfaces and fills', name => name.startsWith('surface-') || name.startsWith('fill-') || name === 'scrim'],
    ['Text', name => name.startsWith('text-')],
    ['Borders and focus', name => name.startsWith('border-') || name === 'focus-ring'],
    ['Accent and brand', name => name.startsWith('accent') || name.startsWith('brand-')],
    ['Intents', name => name.startsWith('intent-')],
    ['Code review', name => name.startsWith('diff-')]
  ]
  return <>
    {groups.map(([title, match]) => <div key={title}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <BothModes>{() => <div className={styles.swatches}>{roles.filter(match).map(name => <div key={name} className={styles.swatch}><span className={styles.chip} style={{ background: `var(--${name})` }} /><code>--{name}</code></div>)}</div>}</BothModes>
    </div>)}
    <h2 className={styles.sectionTitle}>Scales</h2>
    <BothModes>{() => <ScaleList names={Object.keys(SCALE_SPECS) as ScaleName[]} />}</BothModes>
  </>
}

function TypeSection(): ReactElement {
  const sizes = Object.entries(TEXT) as Array<[keyof typeof TEXT, number]>
  return <>
    <h2 className={styles.sectionTitle}>Families</h2>
    <div className={styles.stack}>
      <div className={styles.typeRow}><code>--font-display</code><span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-display)', fontWeight: 700 }}>Bricolage Grotesque</span></div>
      <div className={styles.typeRow}><code>--font-ui</code><span style={{ fontSize: 'var(--text-lg)' }}>IBM Plex Sans · The agent finished and changed 3 files.</span></div>
      <div className={styles.typeRow}><code>--font-mono</code><span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)' }}>IBM Plex Mono · git commit -m "fix: redirect"</span></div>
    </div>
    <h2 className={styles.sectionTitle}>Scale</h2>
    <div className={styles.stack}>{sizes.map(([name, px]) => <div key={name} className={styles.typeRow}><code>--text-{name} · {px}px</code><span style={{ fontSize: `var(--text-${name})`, fontFamily: name === 'display' ? 'var(--font-display)' : undefined, fontWeight: name === 'display' || name === 'xl' ? 600 : undefined }}>Review the changes before you commit</span></div>)}</div>
  </>
}

function ShapeSection(): ReactElement {
  return <>
    <h2 className={styles.sectionTitle}>Spacing</h2>
    <div className={styles.stack}>{Object.entries(SPACE).filter(([key]) => key !== '0').map(([key, value]) => <div key={key} className={styles.measure}><code>--space-{key} · {value}</code><span className={styles.bar} style={{ width: value }} /></div>)}</div>
    <h2 className={styles.sectionTitle}>Radius</h2>
    <div className={styles.row}>{Object.entries(RADIUS).map(([key, value]) => <div key={key} className={styles.stack}><span className={styles.box} style={{ borderRadius: value }} /><code>--radius-{key}</code></div>)}</div>
    <h2 className={styles.sectionTitle}>Elevation</h2>
    <BothModes>{() => <div className={styles.row}>{[1, 2, 3, 4].map(level => <div key={level} className={styles.stack}><span className={styles.box} style={{ boxShadow: `var(--elevation-${level})`, borderRadius: 'var(--radius-md)' }} /><code>--elevation-{level}</code></div>)}</div>}</BothModes>
  </>
}

/** The motion tokens with what reduced motion turns them into, the loops, and a live entrance (docs/design/motion.md). */
function MotionSection(): ReactElement {
  const [dialog, setDialog] = useState(false)
  // Under reduced motion a loop other than the spin runs once in 0ms, and an easing has nothing left to shape.
  const reduced = (name: string): string => (REDUCED_MOTION as Record<string, string>)[name] ?? (name.startsWith('ease-') ? '—' : 'stops')
  return <>
    <h2 className={styles.sectionTitle}>Tokens</h2>
    <table className={styles.tokenTable}>
      <thead><tr><th scope="col">Token</th><th scope="col">Full</th><th scope="col">Reduced</th></tr></thead>
      <tbody>{Object.entries(MOTION).map(([name, value]) => <tr key={name}><td><code>--{name}</code></td><td><code>{value}</code></td><td><code>{reduced(name)}</code></td></tr>)}</tbody>
    </table>
    <h2 className={styles.sectionTitle}>Loops</h2>
    <BothModes>{() => <div className={styles.row}><BrandLoader label="Loading the view" /><Spinner /><StatusDot status="running" label="Running" /><div className={styles.loopSkeleton}><Skeleton lines={2} /></div></div>}</BothModes>
    <h2 className={styles.sectionTitle}>Entrance and press</h2>
    <div className={styles.row}><Button variant="primary" onClick={() => setDialog(true)}>Open a dialog</Button><Button onClick={() => toast({ title: 'Copied the branch name', intent: 'success' })}>Show a toast</Button></div>
    {dialog && <Dialog title="A dialog enters" description="It rises by --motion-shift while it fades in; reduced motion shows it at once." onClose={() => setDialog(false)} footer={<Button variant="primary" onClick={() => setDialog(false)}>Done</Button>}><p>Exits are instant: what the person dismissed should not linger.</p></Dialog>}
  </>
}

/** The states every place in the app uses, so no screen invents its own: empty, loading, failed, succeeded, offline, notices and unavailable. */
function StatesGallery(): ReactElement {
  return <div className={styles.stack}>
    <h2 className={styles.sectionTitle}>Empty</h2>
    <Panel title="Recent conversations"><EmptyState icon={<Bell size={16} />} title="No conversations yet" actions={<Button variant="primary" size="sm">Start one</Button>}>Start a conversation to work on this project with an agent.</EmptyState></Panel>
    <Panel title="Branches"><EmptyState compact title="No branches match this filter." /></Panel>
    <h2 className={styles.sectionTitle}>Loading</h2>
    <Panel title="Pull requests"><Skeleton lines={3} label="Loading pull requests" /></Panel>
    <Panel title="Preview"><Skeleton variant="block" label="Loading the preview" /></Panel>
    <Panel title="Models"><LoadingState label="Loading models…" /></Panel>
    <div className={styles.row}><Spinner /><Spinner size="sm" /><Button loading>Saving</Button></div>
    <h2 className={styles.sectionTitle}>Failed</h2>
    <Panel title="Pull requests"><ErrorState title="Could not load pull requests" message="GitHub did not answer. Check your connection and try again." detail="HTTP 502 from api.github.com" onRetry={() => {}} /></Panel>
    <Panel title="Branches"><ErrorState compact title="Could not list branches." onRetry={() => {}} /></Panel>
    <Panel title="A whole view"><ErrorState brand title="Something went wrong while showing OxeQuery." message="The rest of OXESpace keeps working. Try again, and if it happens again, report it from the Help menu." detail="TypeError: rows is undefined" onRetry={() => {}} /></Panel>
    <h2 className={styles.sectionTitle}>Succeeded</h2>
    <Panel title="Worktree"><SuccessState title="Worktree created" message="feat/login-redirect is ready in its own folder." actions={<Button size="sm" variant="primary">Open it</Button>} /></Panel>
    <Panel title="Connection"><SuccessState compact title="Connected to production-db." /></Panel>
    <h2 className={styles.sectionTitle}>Offline</h2>
    <Panel title="Pull requests"><OfflineState onRetry={() => {}} /></Panel>
    <Panel title="Issues"><OfflineState compact /></Panel>
    <h2 className={styles.sectionTitle}>Notices</h2>
    <Notice intent="warning" title="2 worktrees have uncommitted changes">Removing them discards those changes.</Notice>
    <Notice intent="danger">The policy could not be applied: line 4 is not valid YAML.</Notice>
    <Notice intent="info">Agents in this workspace run with your shell profile.</Notice>
    <Notice intent="success">Saved. New conversations use this model.</Notice>
    <h2 className={styles.sectionTitle}>Unavailable and focus</h2>
    <div className={styles.row}><Button disabled>Disabled</Button><Checkbox label="Disabled option" disabled /><Switch checked={false} onChange={() => {}} label="Disabled switch" disabled /></div>
    <TextField label="With an error" defaultValue="wip" error="Describe what changed in a sentence." />
  </div>
}

function Gallery(): ReactElement {
  const [on, setOn] = useState(true)
  const [view, setView] = useState<'all' | 'mine' | 'done'>('all')
  const [tab, setTab] = useState<'changes' | 'files'>('changes')
  return <div className={styles.stack}>
    <div className={styles.row}>
      <Button variant="primary" icon={<Plus size={14} />}>New conversation</Button>
      <Button>Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger" icon={<Trash2 size={14} />}>Delete</Button>
      <Button loading>Saving</Button><Button variant="link">Open log</Button>
    </div>
    <div className={styles.row}>
      <Button size="sm">Small</Button><Button size="lg">Large</Button>
      <Tooltip content="Search (Ctrl+K)"><IconButton label="Search" icon={<Search size={16} />} /></Tooltip>
      <IconButton label="Copy" icon={<Copy size={16} />} variant="secondary" />
      <ButtonGroup label="Commit"><Button>Commit</Button><Menu label="Commit options" trigger={<IconButton label="More commit options" icon={<MoreHorizontal size={16} />} variant="secondary" />} items={[{ label: 'Commit and push', onSelect: () => {} }, { label: 'Amend last commit', onSelect: () => {} }, { type: 'separator' }, { label: 'Discard changes', danger: true, onSelect: () => {} }]} /></ButtonGroup>
    </div>
    <Toolbar label="Example toolbar"><SegmentedControl label="Filter" value={view} onChange={setView} options={[{ value: 'all', label: 'All' }, { value: 'mine', label: 'Mine' }, { value: 'done', label: 'Done' }]} /><ToolbarSpacer /><Kbd>Ctrl</Kbd><Kbd>K</Kbd></Toolbar>
    <TextField label="Branch name" placeholder="feat/login-redirect" hint="Created from main" mono />
    <TextField label="Commit message" defaultValue="wip" error="Describe what changed in a sentence." />
    <Select label="Model" options={[{ value: 'opus', label: 'Opus' }, { value: 'sonnet', label: 'Sonnet' }]} defaultValue="opus" />
    <TextArea label="Instructions" placeholder="What should the agent do?" rows={3} />
    <div className={styles.row}><Checkbox label="Run tests after edits" defaultChecked /></div>
    <Switch checked={on} onChange={setOn} label="Notify when an agent needs you" description="Only for conversations you are not watching." />
    <div className={styles.row}>
      <Badge>Draft</Badge><Badge intent="accent">Running</Badge><Badge intent="success">Merged</Badge><Badge intent="warning">Needs input</Badge><Badge intent="danger">Failed</Badge><Badge intent="info">3 files</Badge>
      <StatusDot status="running" label="Running" /><StatusDot status="success" label="Done" /><StatusDot status="attention" label="Needs input" /><StatusDot status="danger" label="Failed" /><Spinner />
    </div>
    <Meter label="Context" value={62} detail="124k of 200k" /><Meter label="Weekly limit" value={93} />
    <Tabs label="Example tabs" value={tab} onChange={setTab} tabs={[{ value: 'changes', label: <><GitBranch size={14} />Changes</>, content: <p>3 files changed</p> }, { value: 'files', label: 'Files', content: <p>src/auth/session.ts</p> }]} />
    <Panel title="Recent conversations" actions={<IconButton label="Close" icon={<X size={14} />} size="sm" />}><EmptyState icon={<Bell size={16} />} title="No conversations yet" actions={<Button variant="primary" size="sm">Start one</Button>}>Start a conversation to work on this project with an agent.</EmptyState></Panel>
    <div className={styles.row}><Button size="sm" onClick={() => toast({ title: 'Committed 3 files', intent: 'success', description: 'feat/login-redirect' })}>Show success toast</Button><Button size="sm" onClick={() => toast({ title: 'Push failed', intent: 'danger', description: 'The remote rejected the branch.', action: { label: 'Retry', run: () => {} } })}>Show failure toast</Button></div>
  </div>
}

/** The design system, rendered from its own source: tokens, scales and every primitive in both modes. */
export function DesignSystemPage({ onClose }: { onClose: () => void }): ReactElement {
  const [section, setSection] = useState<Section>('components')
  const current = SECTIONS.find(item => item.id === section)!
  const surface = useModalSurface<HTMLDivElement>(onClose)
  return <div className={styles.page} role="dialog" aria-modal="true" aria-label="Design system" {...surface}>
    <ScaleVariables />
    <nav className={styles.nav} aria-label="Design system sections">
      <h1 className={styles.navTitle}><OxeLogo size={20} variant="compact" />Design system</h1>
      {SECTIONS.map(item => <button key={item.id} type="button" className={styles.navItem} aria-current={item.id === section ? 'page' : undefined} onClick={() => setSection(item.id)}>{item.label}</button>)}
      <p className={styles.navFoot}>Tokens: src/design/tokens · Primitives: src/ui</p>
    </nav>
    <main className={styles.main}>
      <header className={styles.header}>
        <div><h2 className={styles.title}>{current.label}</h2><p className={styles.lead}>Mandacaru, the OXESpace design system. Everything here is rendered from the tokens and primitives the app uses, in light and dark mode.</p></div>
        <IconButton label="Close design system" icon={<X size={16} />} onClick={onClose} />
      </header>
      {section === 'brand' ? <BrandSection /> : section === 'color' ? <ColorSection /> : section === 'type' ? <TypeSection /> : section === 'shape' ? <ShapeSection /> : section === 'motion' ? <MotionSection /> : section === 'states' ? <BothModes>{() => <StatesGallery />}</BothModes> : <BothModes>{() => <Gallery />}</BothModes>}
    </main>
  </div>
}
