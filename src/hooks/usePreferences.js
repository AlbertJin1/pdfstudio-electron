import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PREFERENCES, readPreferences } from '../constants/preferences.js';
import { resolveDarkTheme, useSystemDarkTheme } from './useSystemDarkTheme.js';

export function usePreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  const systemDark = useSystemDarkTheme();
  const dark = resolveDarkTheme(preferences.theme, systemDark);
  const [imageFormat, setImageFormat] = useState(() => preferences.defaultImageFormat);
  const [imageQuality, setImageQuality] = useState(() => String(preferences.defaultImageQuality));

  const setPreference = useCallback((key, value) => {
    if (key === 'theme' && !['system', 'light', 'dark'].includes(value)) return;
    setPreferences((current) => ({ ...current, [key]: value }));
  }, []);

  // Manual switching always becomes an explicit light/dark choice. Choosing "System" in Settings
  // returns theme resolution to the live Windows/browser preference.
  const setDark = useCallback((nextValue) => {
    setPreferences((current) => {
      const currentDark = resolveDarkTheme(current.theme, systemDark);
      const nextDark = typeof nextValue === 'function' ? nextValue(currentDark) : Boolean(nextValue);
      return { ...current, theme: nextDark ? 'dark' : 'light' };
    });
  }, [systemDark]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themeMode = preferences.theme;
    document.documentElement.classList.toggle('font-scale-large', preferences.fontScale === 'large');
    document.documentElement.classList.toggle('font-scale-xlarge', preferences.fontScale === 'xlarge');
    document.documentElement.classList.toggle('density-compact', preferences.density === 'compact');
    document.documentElement.classList.toggle('high-contrast', Boolean(preferences.highContrast));
    document.documentElement.classList.toggle('reduce-motion', Boolean(preferences.reduceMotion));
    document.documentElement.dataset.accent = preferences.accentTheme || 'violet';
    document.documentElement.dataset.platform = 'win32';
    try {
      const savedPreferences = {
        ...preferences,
        theme: preferences.theme,
        themeModeVersion: 1,
        defaultImageFormat: imageFormat,
        defaultImageQuality: Number(imageQuality),
      };
      // Preserve the selected mode in the main preference object. The legacy key stores the
      // resolved theme solely for older auxiliary windows and the first-paint splash.
      localStorage.setItem('pdfstudio-theme', dark ? 'dark' : 'light');
      localStorage.setItem('pdfstudio-settings', JSON.stringify(savedPreferences));
    } catch { /* Preferences remain usable for this session when storage is unavailable. */ }
  }, [dark, preferences, imageFormat, imageQuality]);

  const restoreDefaultPreferences = useCallback(() => {
    setPreferences({ ...DEFAULT_PREFERENCES });
    setImageFormat('png');
    setImageQuality('92');
  }, []);

  return {
    preferences,
    setPreference,
    dark,
    setDark,
    imageFormat,
    setImageFormat,
    imageQuality,
    setImageQuality,
    restoreDefaultPreferences,
  };
}
