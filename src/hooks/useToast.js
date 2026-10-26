import { useCallback, useEffect, useState } from 'react';

export function useToast() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return undefined;
    const id = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const notify = useCallback((message, kind = 'success') => setToast({ message, kind }), []);

  return {
    toast,
    setToast,
    notify,
  };
}
