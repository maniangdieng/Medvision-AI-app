'use client';
import { useRouter } from 'next/navigation';
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import type { Utilisateur } from './types';

interface Ctx { user: Utilisateur | null; chargement: boolean; recharger: () => Promise<void>; deconnecter: () => Promise<void> }
const AuthCtx = createContext<Ctx>({ user: null, chargement: true, recharger: async () => {}, deconnecter: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Utilisateur | null>(null);
  const [chargement, setChargement] = useState(true);
  const router = useRouter();

  const recharger = useCallback(async () => {
    try { setUser(await api<Utilisateur>('/auth/me')); } catch { setUser(null); }
    finally { setChargement(false); }
  }, []);

  useEffect(() => { recharger(); }, [recharger]);

  const deconnecter = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* déjà déconnecté */ }
    setUser(null);
    router.replace('/connexion');
  }, [router]);

  return <AuthCtx.Provider value={{ user, chargement, recharger, deconnecter }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
