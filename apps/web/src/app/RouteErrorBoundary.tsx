import type { ReactNode } from 'react';
import { Component } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card } from '../components/ui';

interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return {
      hasError: true,
    };
  }

  componentDidCatch(error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(
      JSON.stringify({
        event: 'web.route_render.failed',
        message,
      }),
    );
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div style={{ padding: '24px 0' }}>
        <Card style={{ maxWidth: '720px' }}>
          <h2 style={{ marginBottom: '10px' }}>Page failed to render</h2>
          <p style={{ color: 'var(--text-tertiary)', marginBottom: '18px' }}>
            A client-side render error was caught before it could turn into a blank screen.
            You can retry this page or jump back to the market entry.
          </p>
          <div className="filter-bar">
            <Button type="button" variant="primary" onClick={this.handleRetry}>
              Retry page
            </Button>
            <Link to="/markets" className="markets-secondary-link">
              Back to markets
            </Link>
          </div>
        </Card>
      </div>
    );
  }
}
