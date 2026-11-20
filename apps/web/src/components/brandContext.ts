import { createContext, useContext } from 'react';
import { SIFTLINE_LOGOS } from '../assets/logos';

export interface LogoContextValue {
  activeIdx: number;
  setActiveIdx: (idx: number) => void;
  activeLogo: (typeof SIFTLINE_LOGOS)[number];
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
}

export const LogoContext = createContext<LogoContextValue>({
  activeIdx: 0,
  setActiveIdx: () => {},
  activeLogo: SIFTLINE_LOGOS[0],
  switcherOpen: false,
  setSwitcherOpen: () => {},
});

export function useLogo() {
  return useContext(LogoContext);
}
