import { useCallback, useEffect } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';

/** One page-level blocker covers links, programmatic navigation and browser back/forward. */
export function useUnsavedChanges(dirty: boolean, message: string) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && (
    currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search || currentLocation.hash !== nextLocation.hash
  ));
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    if (dirty) { event.preventDefault(); event.returnValue = ''; }
  }, [dirty]));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);
}
