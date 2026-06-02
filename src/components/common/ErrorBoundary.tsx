import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Short label for the fallback copy + logs (e.g. "o terminal"). */
  label?: string
  /** Custom fallback; defaults to a compact retry card. */
  fallback?: ReactNode
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
  }

  private readonly reset = (): void => this.setState({ error: null })

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    return (
      <div className="error-boundary-fallback" role="alert">
        <p>Algo falhou ao renderizar {this.props.label ?? 'este componente'}.</p>
        <code>{this.state.error.message}</code>
        <button type="button" className="ghost-btn small" onClick={this.reset}>Tentar novamente</button>
      </div>
    )
  }
}
