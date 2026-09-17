import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Les tests partagent une même base MariaDB (voir tests/README.md) : les faire
    // tourner en série évite les interférences entre un test qui crée une fiche
    // temporaire et un autre qui compte les métiers en base au même instant.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    setupFiles: ['tests/setup.ts'],
  },
});
