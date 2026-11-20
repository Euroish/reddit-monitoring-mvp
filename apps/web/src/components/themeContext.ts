import { createContext, useContext } from 'react';
import { PRESET_THEMES, type ThemePaletteInput } from '../styles/themes';

export interface ThemeContextValue {
  activeThemeId: string;
  palette: ThemePaletteInput;
  syncWorkbench: boolean;
  setSyncWorkbench: (v: boolean) => void;
  selectPreset: (id: string) => void;
  updateCustomColor: (field: keyof ThemePaletteInput, value: string | boolean) => void;
  resetCustomToPreset: (baseId?: string) => void;
  studioOpen: boolean;
  setStudioOpen: (open: boolean) => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  activeThemeId: PRESET_THEMES[0].id,
  palette: PRESET_THEMES[0],
  syncWorkbench: true,
  setSyncWorkbench: () => {},
  selectPreset: () => {},
  updateCustomColor: () => {},
  resetCustomToPreset: () => {},
  studioOpen: false,
  setStudioOpen: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}
