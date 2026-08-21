import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { type Lang, t as translate, type TranslationKey } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { apiLogout } from '@/lib/api';
import { hasPermission, canView, canAction, canViewFinancial } from '@/lib/permissions';
import type { Settings } from '@/types';

export interface CurrentUser {
  id: string;
  username: string;
  full_name: string | null;
  role: string;
  permissions: string[];
}

interface AppContextValue {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  setLang: (l: Lang) => void;
  t: (key: TranslationKey) => string;
  theme: 'light' | 'dark';
  setTheme: (th: 'light' | 'dark') => void;
  zoom: number;
  setZoom: (z: number) => void;
  settings: Settings | null;
  refreshSettings: () => Promise<void>;
  currentUser: CurrentUser | null;
  login: (user: CurrentUser) => void;
  logout: () => void;
  can: (perm: string) => boolean;
  canModule: (moduleKey: string, action?: 'view' | 'create' | 'edit' | 'delete') => boolean;
  canFinance: () => boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  // Restore the saved language synchronously so the first render is already
  // in the right language â€” an effect-based restore would be clobbered back
  // to 'en' by the persistence effect on mount (and by StrictMode's double
  // effect run), which is why refreshing reset the language to English.
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('pos_lang') as Lang | null;
    return saved === 'ar' || saved === 'fr' || saved === 'en' ? saved : 'en';
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('pos_theme') as 'light' | 'dark' | null;
    if (saved) return saved;
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  });
  const [zoom, setZoom] = useState<number>(() => {
    const saved = localStorage.getItem('pos_zoom') as number | null;
    return saved !== null ? Math.max(0.5, Math.min(2, Number(saved))) : 1;
  });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    const savedUser = localStorage.getItem('pos_user');
    if (savedUser) {
      try { setCurrentUser(JSON.parse(savedUser)); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    // NOTE: pos_lang is intentionally NOT written here. The language only
    // gets persisted when the user explicitly changes it (see setLang), so
    // the stored value always reflects the user's own choice and can never
    // be overwritten by the default 'en' during mount.
  }, [lang, dir]);

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem('pos_theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.zoom = zoom;
    localStorage.setItem('pos_zoom', zoom.toString());
  }, [zoom]);

  const refreshSettings = useCallback(async () => {
    const { data } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
    if (data) {
      setSettings(data as Settings);
      const savedLang = localStorage.getItem('pos_lang') as Lang | null;
      if (data.language && !savedLang && data.language !== lang) setLangState(data.language);
      const savedTheme = localStorage.getItem('pos_theme') as 'light' | 'dark' | null;
      if (!savedTheme && data.theme && data.theme !== theme) setTheme(data.theme);
    }
  }, [lang, theme]);

  useEffect(() => {
    refreshSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    // Persist the choice locally so it survives a refresh, until the user
    // changes it again.
    localStorage.setItem('pos_lang', l);
    supabase.from('settings').update({ language: l }).eq('id', 1).then(() => {}, () => {});
  }, []);
  const setTheme = useCallback((th: 'light' | 'dark') => setTheme(th), []);

  const login = useCallback((user: CurrentUser) => {
    setCurrentUser(user);
    localStorage.setItem('pos_user', JSON.stringify(user));
    // /api/data now requires auth, so store settings once the token exists.
    void refreshSettings();
  }, [refreshSettings]);
  const logout = useCallback(() => {
    setCurrentUser(null);
    localStorage.removeItem('pos_user');
    // Best-effort server logout + token cleanup (refreshes nothing on failure)
    void apiLogout();
  }, []);

  const can = useCallback((perm: string) => hasPermission(currentUser, perm), [currentUser]);
  const canModule = useCallback((moduleKey: string, action?: 'view' | 'create' | 'edit' | 'delete') =>
    action === undefined || action === 'view' ? canView(currentUser, moduleKey) : canAction(currentUser, moduleKey, action),
    [currentUser]);
  const canFinance = useCallback(() => canViewFinancial(currentUser), [currentUser]);

  useEffect(() => {
    const onAuthExpired = () => logout();
    window.addEventListener('pos:auth-expired', onAuthExpired);
    return () => window.removeEventListener('pos:auth-expired', onAuthExpired);
  }, [logout]);

  const t = useCallback((key: TranslationKey) => translate(lang, key), [lang]);

  const value = useMemo<AppContextValue>(
    () => ({ lang, dir, setLang, t, theme, setTheme, zoom, setZoom, settings, refreshSettings, currentUser, login, logout, can, canModule, canFinance }),
    [lang, dir, setLang, t, theme, setTheme, zoom, setZoom, settings, refreshSettings, currentUser, login, logout, can, canModule, canFinance],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
