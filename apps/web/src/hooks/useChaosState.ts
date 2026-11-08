'use client';

import { NO_CHAOS, type ChaosState, type RoomProvider } from '@wb/shared/client';
import { useSyncExternalStore } from 'react';

/** The Chaos Lab's current conditions on a provider. Without a provider there are none. */
export function useChaosState(provider: RoomProvider | null): ChaosState {
  return useSyncExternalStore(
    (listener) => (provider ? provider.on('chaos', listener) : () => undefined),
    // The provider replaces this object whenever it changes, so identity is a valid change signal.
    () => provider?.chaos ?? NO_CHAOS,
    () => NO_CHAOS,
  );
}
