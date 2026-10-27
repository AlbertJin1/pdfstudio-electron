export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'system',
  themeModeVersion: 1,
  accentTheme: 'violet',
  fontScale: 'standard',
  density: 'comfortable',
  highContrast: false,
  reduceMotion: false,
  hideGuide: false,
  confirmDelete: true,
  defaultImageFormat: 'png',
  defaultImageQuality: 92,
});

export function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem('pdfstudio-settings') || '{}');
    // Ignore any URL from older settings: the update endpoint is hardcoded in the Electron main process.
    delete saved.updateFeedUrl;
    delete saved.showInspector;
    // Older releases always wrote 'light' or 'dark', even when the user had never chosen a fixed mode.
    // Migrate those unversioned values to System once; fixed modes selected in this release are versioned.
    const hasVersionedThemeMode = saved.themeModeVersion === 1 && ['system', 'light', 'dark'].includes(saved.theme);
    return {
      ...DEFAULT_PREFERENCES,
      ...saved,
      theme: hasVersionedThemeMode ? saved.theme : DEFAULT_PREFERENCES.theme,
      themeModeVersion: 1,
      accentTheme: ['violet', 'blue', 'teal', 'green', 'rose', 'amber'].includes(saved.accentTheme) ? saved.accentTheme : DEFAULT_PREFERENCES.accentTheme,
      fontScale: ['standard', 'large', 'xlarge'].includes(saved.fontScale) ? saved.fontScale : DEFAULT_PREFERENCES.fontScale,
      density: ['comfortable', 'compact'].includes(saved.density) ? saved.density : DEFAULT_PREFERENCES.density,
      highContrast: Boolean(saved.highContrast),
      reduceMotion: Boolean(saved.reduceMotion),
      hideGuide: Boolean(saved.hideGuide),
      confirmDelete: saved.confirmDelete !== false,
      defaultImageFormat: saved.defaultImageFormat === 'jpeg' ? 'jpeg' : 'png',
      defaultImageQuality: Math.min(100, Math.max(40, Number(saved.defaultImageQuality) || 92)),
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
