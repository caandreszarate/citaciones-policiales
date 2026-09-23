import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase.ts';
import { config } from '../lib/config.ts';

/**
 * Sesion de la persona administrativa. No hay registro publico: las cuentas se
 * crean desde el panel de Supabase y se autorizan en la tabla `profiles`.
 */

interface AuthState {
  readonly session: Session | null;
  readonly isAdmin: boolean;
  readonly loading: boolean;
  // Declaradas como propiedades (no metodos) para que puedan desestructurarse
  // con seguridad: no dependen de `this`.
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  // `resuelta` pasa a true en cuanto sabemos si hay sesion. Si no hay Supabase
  // configurado la respuesta se conoce ya en el primer render, sin efecto.
  const [sesion, setSesion] = useState<{ resuelta: boolean; valor: Session | null }>(() => ({
    resuelta: supabase === null,
    valor: null,
  }));
  // Se guarda junto al id de usuario consultado para poder derivar, durante el
  // render, si el dato que tenemos corresponde a la sesion actual.
  const [permiso, setPermiso] = useState<{ userId: string; isAdmin: boolean } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSesion({ resuelta: true, valor: data.session });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSesion({ resuelta: true, valor: next });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const session = sesion.valor;
  const loading = !sesion.resuelta;
  const userId = session?.user.id ?? null;

  // La autorizacion real vive en el servidor (is_admin() + RLS). Esto solo sirve
  // para no ofrecer botones que van a fallar.
  useEffect(() => {
    if (!supabase || !userId) return;
    let active = true;
    void supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) {
          setPermiso({ userId, isAdmin: Boolean((data as { is_admin?: boolean } | null)?.is_admin) });
        }
      });
    return () => {
      active = false;
    };
  }, [userId]);

  // Derivado en el render: un permiso de otra sesion no cuenta.
  const isAdmin = userId !== null && permiso?.userId === userId && permiso.isAdmin;

  const value = useMemo<AuthState>(
    () => ({
      session,
      isAdmin,
      loading,
      signIn: async (email: string, password: string) => {
        if (!supabase) throw new Error('La aplicacion no esta configurada.');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          throw new Error(
            /invalid login/i.test(error.message)
              ? 'Correo o contraseña incorrectos.'
              : error.message,
          );
        }
      },
      signOut: async () => {
        await supabase?.auth.signOut();
      },
    }),
    [session, isAdmin, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return ctx;
}

export const isConfigured = config.isConfigured;
