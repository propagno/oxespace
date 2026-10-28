import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from '../../ui'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Short label for the fallback copy and logs (e.g. "the terminal"). */
  label?: string
  /** Custom fallback; defaults to an error state with Try again. */
  fallback?: ReactNode
  /** One line instead of a card, for small panels. */
  compact?: boolean
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
    return <div className="error-boundary-fallback">
      <ErrorState compact={this.props.compact} title={`Something went wrong while showing ${this.props.label ?? 'this part of the app'}.`}
        message="The rest of OXESpace keeps working. Try again, and if it happens again, report it from the Help menu."
        detail={this.state.error.message} onRetry={this.reset} />
    </div>
  }
}
