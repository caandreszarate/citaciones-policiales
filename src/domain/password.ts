/**
 * Politica de contrasenas.
 *
 * Debe coincidir con la del servidor (Supabase: password_min_length y
 * password_required_characters, fijados en supabase/config.toml). Aqui solo se
 * valida para dar un mensaje util ANTES de enviar: quien decide es el servidor.
 */

export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordCheck {
  readonly ok: boolean;
  /** Requisitos incumplidos, redactados para mostrarlos tal cual. */
  readonly problems: string[];
}

export function checkPassword(password: string): PasswordCheck {
  const problems: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }
  if (!/[a-z]/.test(password)) problems.push('Debe incluir alguna letra minúscula.');
  if (!/[A-Z]/.test(password)) problems.push('Debe incluir alguna letra mayúscula.');
  if (!/[0-9]/.test(password)) problems.push('Debe incluir algún número.');

  return { ok: problems.length === 0, problems };
}

/** Requisitos, para mostrarlos antes de que la persona escriba. */
export const PASSWORD_RULES = [
  `Al menos ${PASSWORD_MIN_LENGTH} caracteres`,
  'Una letra minúscula',
  'Una letra mayúscula',
  'Un número',
] as const;
