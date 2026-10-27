import { useEffect, useState } from 'react';

function readMediaPreference() {
  try {
    return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  } catch {
    return false;
  }
}

/** Tracks the OS colour preference, using Electron's nativeTheme bridge when available. */
export function useSystemDarkTheme() {
  const [systemDark, setSystemDark] = useState(readMediaPreference);

  useEffect(() => {
    let active = true;
    const applyTheme = (theme) => {
      if (!active) return;
      if (theme === 'dark' || theme === 'light') {
        setSystemDark(theme === 'dark');
      } else if (typeof theme?.shouldUseDarkColors === 'boolean') {
        setSystemDark(theme.shouldUseDarkColors);
      }
    };

    const media = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    const onMediaChange = (event) => setSystemDark(Boolean(event.matches));
    media?.addEventListener?.('change', onMediaChange);
    // Chromium's media query is the browser fallback; Electron's nativeTheme is authoritative on Windows.
    if (window.pdfStudio?.getSystemTheme) {
      window.pdfStudio.getSystemTheme().then(applyTheme).catch(() => {});
    }
    const unsubscribe = window.pdfStudio?.onSystemThemeChanged?.(applyTheme);

    return () => {
      active = false;
      media?.removeEventListener?.('change', onMediaChange);
      if (typeof media?.removeListener === 'function') media.removeListener(onMediaChange);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  return systemDark;
}

export function resolveDarkTheme(themeMode, systemDark) {
  if (themeMode === 'dark') return true;
  if (themeMode === 'light') return false;
  return Boolean(systemDark);
}
