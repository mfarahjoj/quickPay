import { useEffect, useRef } from 'react';

interface ExitGuardOptions {
  /**
   * Leaving is paused: a money call is in flight and the screen must stay to
   * show how it ended. The swipe is switched off too, so it does not half-open
   * and snap back.
   */
  blocked?: boolean;
  /**
   * Called instead of leaving. Step back, ask for confirmation, cancel what is
   * pending — then call `leave()` if the screen should really close.
   */
  onExit?: (leave: () => void) => void;
}

/**
 * One exit rule for a screen, whatever the person used to leave.
 *
 * The header back button, the iOS swipe and Android's back key all remove the
 * screen through navigation, so a single `beforeRemove` listener sees every
 * one of them. Screens pass what leaving should mean for the step they are on;
 * with neither option set, leaving works normally.
 */
export function useExitGuard(
  navigation: any,
  { blocked = false, onExit }: ExitGuardOptions,
): void {
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  // Set while `leave()` dispatches, so the listener lets that removal through.
  const leaving = useRef(false);

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !blocked });
  }, [navigation, blocked]);

  const guarded = blocked || !!onExit;

  useEffect(() => {
    if (!guarded) return;
    return navigation.addListener('beforeRemove', (e: any) => {
      if (leaving.current) return;
      e.preventDefault();
      if (blocked) return;
      onExitRef.current?.(() => {
        leaving.current = true;
        navigation.dispatch(e.data.action);
      });
    });
  }, [navigation, guarded, blocked]);
}
