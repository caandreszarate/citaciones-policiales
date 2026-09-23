import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// La base es configurable para permitir el despliegue en la subruta de GitHub
// Pages (p. ej. /citaciones-policiales/) sin tocar el codigo.
const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
