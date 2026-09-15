import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { loadCatalogue, type CatalogueSource } from './api';
import type { Catalogue } from './types';

interface CatalogueContextValue {
  catalogue: Catalogue | null;
  source: CatalogueSource | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const CatalogueContext = createContext<CatalogueContextValue | null>(null);

export function CatalogueProvider({ children }: { children: React.ReactNode }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [source, setSource] = useState<CatalogueSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await loadCatalogue();
    setCatalogue(result.catalogue);
    setSource(result.source);
    setError(result.error ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <CatalogueContext.Provider value={{ catalogue, source, error, loading, refresh }}>
      {children}
    </CatalogueContext.Provider>
  );
}

export function useCatalogue(): CatalogueContextValue {
  const context = useContext(CatalogueContext);
  if (!context) throw new Error('useCatalogue doit être utilisé dans un CatalogueProvider');
  return context;
}
