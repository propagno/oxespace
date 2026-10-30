import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Badge, Button, Dialog, EmptyState, IconButton, Menu, Meter, SegmentedControl, Select, StatusDot, Switch, Tabs, TextField, Toaster, dismissToast, toast } from '../src/ui'

beforeAll(async () => { await import('../src/ui/ToastStack') })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Button', () => {
  it('is a plain button by default and blocks clicks while loading', () => {
    const click = vi.fn()
    const { rerender } = render(<Button onClick={click}>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('type', 'button')
    fireEvent.click(button); expect(click).toHaveBeenCalledTimes(1)
    rerender(<Button onClick={click} loading>Save</Button>)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('names icon-only buttons for screen readers and as a title', () => {
    render(<IconButton label="Close panel" icon={<svg />} />)
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeInTheDocument()
  })
})

describe('Field controls', () => {
  it('wires the label, hint and error to the input', () => {
    const { rerender } = render(<TextField label="Branch" hint="Created from main" />)
    const input = screen.getByLabelText('Branch')
    expect(input).toHaveAccessibleDescription('Created from main')
    rerender(<TextField label="Branch" hint="Created from main" error="That branch already exists" />)
    expect(screen.getByLabelText('Branch')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Branch')).toHaveAccessibleDescription('That branch already exists')
    expect(screen.getByRole('alert')).toHaveTextContent('That branch already exists')
  })

  it('renders select options', () => {
    render(<Select label="Model" options={[{ value: 'a', label: 'Opus' }, { value: 'b', label: 'Sonnet' }]} defaultValue="b" />)
    expect(screen.getByLabelText('Model')).toHaveValue('b')
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('toggles a switch and keeps its label and description', () => {
    function Harness() { const [on, setOn] = useState(false); return <Switch checked={on} onChange={setOn} label="Notify me" description="When an agent needs you" /> }
    render(<Harness />)
    const toggle = screen.getByRole('switch', { name: 'Notify me' })
    expect(toggle).toHaveAccessibleDescription('When an agent needs you')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('moves a segmented control with the arrow keys and keeps one tab stop', () => {
    function Harness() { const [value, setValue] = useState<'a' | 'b' | 'c'>('a'); return <SegmentedControl label="View" value={value} onChange={setValue} options={[{ value: 'a', label: 'All' }, { value: 'b', label: 'Mine' }, { value: 'c', label: 'Done' }]} /> }
    render(<Harness />)
    const all = screen.getByRole('radio', { name: 'All' })
    expect(all).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Mine' })).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(all, { key: 'ArrowLeft' })
    expect(screen.getByRole('radio', { name: 'Done' })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('Dialog', () => {
  it('shows the title and description, and closes on Escape and the close button', () => {
    const close = vi.fn()
    render(<Dialog title="Delete conversation" description="This cannot be undone." onClose={close} footer={<Button variant="danger">Delete</Button>}>Body</Dialog>)
    const dialog = screen.getByRole('dialog', { name: 'Delete conversation' })
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(close).toHaveBeenCalledTimes(2)
  })
})

describe('Display', () => {
  it('labels status dots and badges in text', () => {
    render(<><StatusDot status="running" label="Running" /><Badge intent="danger">Failed</Badge></>)
    expect(screen.getByRole('img', { name: 'Running' })).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('reports a meter value and switches tabs', () => {
    function Harness() { const [tab, setTab] = useState<'a' | 'b'>('a'); return <Tabs label="Panels" value={tab} onChange={setTab} tabs={[{ value: 'a', label: 'Changes', content: 'Changes body' }, { value: 'b', label: 'Files', content: 'Files body' }]} /> }
    render(<><Meter label="Context" value={80} /><Harness /></>)
    expect(screen.getByRole('meter', { name: 'Context' })).toHaveAttribute('aria-valuenow', '80')
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Changes' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Files' }), { button: 0 })
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true')
  })

  it('describes an empty place with its next step', () => {
    render(<EmptyState title="No conversations yet" actions={<Button variant="primary">New conversation</Button>}>Start one to work with an agent.</EmptyState>)
    expect(screen.getByText('No conversations yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeInTheDocument()
  })
})

describe('Toast', () => {
  it('shows, auto-dismisses, and keeps failures until dismissed', async () => {
    vi.useFakeTimers()
    await act(async () => { render(<Toaster />) })
    act(() => { toast({ title: 'Committed', intent: 'success' }) })
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveTextContent('Committed')
    act(() => { vi.advanceTimersByTime(5100) })
    expect(screen.queryByText('Committed')).toBeNull()
    let id = 0
    act(() => { id = toast({ title: 'Push failed', description: 'The remote rejected the branch.', intent: 'danger' }) })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByRole('alert')).toHaveTextContent('Push failed')
    act(() => dismissToast(id))
    expect(screen.queryByText('Push failed')).toBeNull()
  })
})

describe('Menu', () => {
  it('keeps a stepper item open and checks the chosen radio option', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    const larger = vi.fn(), choose = vi.fn()
    render(<Menu label="More actions" trigger={<button type="button">More</button>} items={[
      { label: 'Larger text', keepOpen: true, onSelect: larger },
      { type: 'radio', value: 'normal', onValueChange: choose, options: [{ value: 'normal', label: 'Normal', ariaLabel: 'Normal view' }, { value: 'summary', label: 'Summary', hint: 'Answers only' }] }
    ]} />)
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Larger text' }))
    expect(larger).toHaveBeenCalledOnce()
    expect(screen.getByRole('menuitemradio', { name: 'Normal view' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('menuitemradio', { name: /Summary/ }))
    expect(choose).toHaveBeenCalledWith('summary')
  })
})
