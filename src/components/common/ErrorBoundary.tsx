import { Component, type ErrorInfo, type ReactNode } from 'react'
import { i18n } from '../../i18n'
import { Button, ErrorState } from '../../ui'
import type { RendererErrorBoundary } from '../../lib/rendererErrors'
import { reportBoundaryError } from '../../lib/rendererErrorsBoot'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Which boundary this is, for the incident journal; stable across languages, unlike `label`. */
  id: RendererErrorBoundary
  /** The component the journal names, when it is better known than the first one in React's stack (a view's name). */
  component?: string
  /** Short label for the fallback copy and logs (e.g. "the terminal"). */
  label?: string
  /** Custom fallback; defaults to an error state with Try again. */
  fallback?: ReactNode
  /** One line instead of a card, for small panels. */
  compact?: boolean
  /** The whole window: the app's root boundary, with a way to reload. */
  page?: boolean
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Contains a render/runtime crash to its subtree so one failing component (e.g.
 * the xterm WebGL renderer on a GPU-less corporate host) degrades to a small
 * message instead of unmounting the whole React tree and blanking the app.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[OXESpace] ErrorBoundary caught (${this.props.label ?? 'component'})`, error, info.componentStack)
    void reportBoundaryError(error, this.props.id, this.props.component, info.componentStack)
  }

  private readonly reset = (): void => this.setState({ error: null })

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    if (this.props.page) return <div className="error-boundary-fallback error-boundary-page">
      <ErrorState brand title={i18n.t('ui.crash.title')} message={i18n.t('ui.crash.message')} detail={this.state.error.message} onRetry={this.reset}
        actions={<Button onClick={() => window.location.reload()}>{i18n.t('ui.crash.reload')}</Button>} />
    </div>
    return <div className="error-boundary-fallback">
      <ErrorState brand compact={this.props.compact} title={this.props.label ? i18n.t('ui.boundary.title', { what: this.props.label }) : i18n.t('ui.boundary.titlePart')}
        message={i18n.t('ui.boundary.message')}
        detail={this.state.error.message} onRetry={this.reset} />
    </div>
  }
}
