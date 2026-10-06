import { Text } from '@react-three/drei';
import { Component, Suspense, type ComponentProps, type ReactNode } from 'react';

/** Drops in-world text (rather than the whole scene) if its font or worker can't load. */
class TextBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** drei `Text` isolated in its own Suspense + error boundary. */
export function SafeText(props: ComponentProps<typeof Text>) {
  return (
    <TextBoundary>
      <Suspense fallback={null}>
        <Text {...props} />
      </Suspense>
    </TextBoundary>
  );
}
