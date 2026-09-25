import { Component, Suspense, type ReactNode } from 'react';
import { LoadingScreen } from '../LoadingScreen';
import { CrashNotice } from '../ScreenErrorBoundary';
import { ChunkLoadError } from './lazyChunk';

class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return <CrashNotice kind={this.state.error instanceof ChunkLoadError ? 'chunk' : 'crash'} fullScreen />;
  }
}

/**
 * A part of the app loaded on demand: the loading screen meanwhile, a way out if it cannot load
 * (or if it breaks before its own screens start — they have ScreenErrorBoundary inside the shell).
 */
export function ChunkBoundary({ children }: { children: ReactNode }) {
  return (
    <Boundary>
      <Suspense fallback={<LoadingScreen />}>{children}</Suspense>
    </Boundary>
  );
}
