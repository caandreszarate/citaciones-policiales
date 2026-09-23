import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.ts';

/**
 * Cliente de Supabase. Se crea solo si hay configuracion; asi la aplicacion puede
 * arrancar y explicar que falta configurar en lugar de romperse con un error
 * opaco en la consola.
 */
export const supabase: SupabaseClient | null = config.isConfigured
  ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // No hay enlaces magicos ni OAuth: no hay nada que leer de la URL, y
        // leerla romperia el enrutado por hash de GitHub Pages.
        detectSessionInUrl: false,
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'La aplicacion no esta configurada: faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.',
    );
  }
  return supabase;
}
