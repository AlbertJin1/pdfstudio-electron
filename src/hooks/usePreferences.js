import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PREFERENCES, readPreferences } from '../constants/preferences.js';

export function usePreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [dark, setDark] = useState(() => preferences.theme === 'dark');
  const [imageFormat, setImageFormat] = useState(() => preferences.defaultImageFormat);
  const [imageQuality, setImageQuality] = useState(() => String(preferences.defaultImageQuality));
  const [showInspector, setShowInspector] = useState(() => preferences.showInspector);

  const setPreference = useCallback((key, value) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
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
        theme: dark ? 'dark' : 'light',
        showInspector,
        defaultImageFormat: imageFormat,
        defaultImageQuality: Number(imageQuality),
      };
      localStorage.setItem('pdfstudio-theme', savedPreferences.theme);
      localStorage.setItem('pdfstudio-settings', JSON.stringify(savedPreferences));
    } catch { /* Preferences remain usable for this session when storage is unavailable. */ }
  }, [dark, preferences, showInspector, imageFormat, imageQuality]);

  const restoreDefaultPreferences = () => {
    setPreferences({ ...DEFAULT_PREFERENCES });
    setDark(false);
    setShowInspector(true);
    setImageFormat('png');
    setImageQuality('92');
  };

  return {
    preferences,
    setPreference,
    dark,
    setDark,
    imageFormat,
    setImageFormat,
    imageQuality,
    setImageQuality,
    showInspector,
    setShowInspector,
    restoreDefaultPreferences,
  };
}
