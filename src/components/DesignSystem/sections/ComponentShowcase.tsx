import type { ReactElement } from 'react'

const STATUS_DOTS = [
  { label: 'running',  cls: 'green' },
  { label: 'starting', cls: 'yellow' },
  { label: 'error',    cls: 'red' },
  { label: 'pending',  cls: 'blue' },
  { label: 'agent',    cls: 'purple' },
  { label: 'exited',   cls: 'orange' },
  { label: 'idle',     cls: '' },
]

export function ComponentShowcase(): ReactElement {
  return (
    <div className="ds-showcase">

      {/* Buttons */}
      <section className="ds-showcase-section">
        <h3 className="ds-section-subtitle">Buttons</h3>
        <div className="ds-showcase-row">
          <button type="button" className="primary-action">Primary Action</button>
          <button type="button" className="secondary-action">Secondary</button>
          <button type="button" className="primary-action" disabled>Disabled</button>
          <button type="button" className="danger-action">Danger</button>
        </div>
        <div className="ds-showcase-row">
          <button type="button" className="wizard-btn-primary">Wizard Primary</button>
          <button type="button" className="wizard-chip active">Chip Active</button>
          <button type="button" className="wizard-chip">Chip</button>
          <button type="button" className="statusbar-action">Statusbar</button>
        </div>
      </section>

      {/* Status Indicators */}
      <section className="ds-showcase-section">
        <h3 className="ds-section-subtitle">Status Indicators</h3>
        <div className="ds-showcase-row ds-showcase-row--wrap">
          {STATUS_DOTS.map(({ label, cls }) => (
            <div key={label} className="ds-status-item">
              <span className={`statusbar-dot ${cls}`} aria-hidden="true" />
              <span className="ds-status-label">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Form — standalone fields */}
      <section className="ds-showcase-section">
        <h3 className="ds-section-subtitle">Form Fields</h3>
        <div className="ds-showcase-col">
          <label className="field">
            <span>Text input</span>
            <input type="text" defaultValue="Sample value" />
          </label>
          <label className="field">
            <span>Select</span>
            <select defaultValue="opt1">
              <option value="opt1">Option 1</option>
              <option value="opt2">Option 2</option>
              <option value="opt3">Option 3</option>
            </select>
          </label>
          <label className="field">
            <span>Textarea</span>
            <textarea defaultValue={"Multi-line content\nSecond line…"} rows={3} />
          </label>
          <div className="field">
            <span>Path picker</span>
            <div className="path-input">
              <input type="text" defaultValue="/Users/project/workspace" />
              <button type="button" className="path-picker-button">Browse</button>
            </div>
          </div>
        </div>
      </section>

      {/* Form — iOS grouped style */}
      <section className="ds-showcase-section">
        <h3 className="ds-section-subtitle">Grouped Form (iOS style)</h3>
        <div className="form-group">
          <div className="form-group-row">
            <span className="form-group-label">Theme</span>
            <div className="form-group-control">
              <select defaultValue="default">
                <option value="default">Default</option>
                <option value="nord">Nord</option>
                <option value="dracula">Dracula</option>
              </select>
            </div>
          </div>
          <div className="form-group-row">
            <span className="form-group-label">Layout preset</span>
            <div className="form-group-control">
              <select defaultValue="2">
                <option value="1">1 pane</option>
                <option value="2">2 panes</option>
                <option value="4">4 panes</option>
              </select>
            </div>
          </div>
          <div className="form-group-row">
            <span className="form-group-label">Working directory</span>
            <div className="form-group-control">
              <input type="text" defaultValue="~/projects" />
            </div>
          </div>
        </div>
      </section>

      {/* Sizing Tokens */}
      <section className="ds-showcase-section">
        <h3 className="ds-section-subtitle">Sizing Tokens</h3>
        <div className="ds-sizing-rows">
          {[
            { label: '--sidebar-w',          value: 'var(--sidebar-w)',           ref: '282px' },
            { label: '--sidebar-w-collapsed', value: 'var(--sidebar-w-collapsed)', ref: '48px' },
            { label: '--tile-header-h',       value: 'var(--tile-header-h)',       ref: '40px' },
            { label: '--tile-statusbar-h',    value: 'var(--tile-statusbar-h)',    ref: '28px' },
            { label: '--ws-item-h',           value: 'var(--ws-item-h)',           ref: '40px' },
          ].map(({ label, value, ref }) => (
            <div key={label} className="ds-sizing-row">
              <span className="ds-sizing-label"><code>{label}</code></span>
              <div className="ds-sizing-bar-wrap">
                <div className="ds-sizing-bar" style={{ width: value, maxWidth: '100%' }} />
              </div>
              <span className="ds-sizing-ref">{ref}</span>
            </div>
          ))}
        </div>
      </section>

    </div>
  )
}
