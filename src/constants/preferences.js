export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'light',
  accentTheme: 'violet',
  fontScale: 'standard',
  density: 'comfortable',
  highContrast: false,
  reduceMotion: false,
  hideGuide: false,
  confirmDelete: true,
  showInspector: true,
  defaultImageFormat: 'png',
  defaultImageQuality: 92,
});

export function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem('pdfstudio-settings') || '{}');
    // Ignore any URL from older settings: the update endpoint is hardcoded in the Electron main process.
    delete saved.updateFeedUrl;
    const legacyTheme = localStorage.getItem('pdfstudio-theme');
    return {
      ...DEFAULT_PREFERENCES,
      ...saved,
      theme: saved.theme || legacyTheme || DEFAULT_PREFERENCES.theme,
      accentTheme: ['violet', 'blue', 'teal', 'green', 'rose', 'amber'].includes(saved.accentTheme) ? saved.accentTheme : DEFAULT_PREFERENCES.accentTheme,
      fontScale: ['standard', 'large', 'xlarge'].includes(saved.fontScale) ? saved.fontScale : DEFAULT_PREFERENCES.fontScale,
      density: ['comfortable', 'compact'].includes(saved.density) ? saved.density : DEFAULT_PREFERENCES.density,
      highContrast: Boolean(saved.highContrast),
      reduceMotion: Boolean(saved.reduceMotion),
      hideGuide: Boolean(saved.hideGuide),
      confirmDelete: saved.confirmDelete !== false,
      showInspector: saved.showInspector !== false,
      defaultImageFormat: saved.defaultImageFormat === 'jpeg' ? 'jpeg' : 'png',
      defaultImageQuality: Math.min(100, Math.max(40, Number(saved.defaultImageQuality) || 92)),
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
