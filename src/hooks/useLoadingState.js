import { useState } from 'react';

export function useLoadingState() {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('Preparing your workspace');

  return {
    isLoading,
    setIsLoading,
    loadingLabel,
    setLoadingLabel,
  };
}
