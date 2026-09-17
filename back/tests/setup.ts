import { afterAll } from 'vitest';
import { sequelize } from '../src/models';

/**
 * Un seul pool de connexions pour toute la suite (partagé par `tests/helpers/client.ts`
 * via l'import de `../src/models`) : on le ferme une fois à la fin, sinon Vitest reste
 * accroché en attendant que le process se termine de lui-même.
 */
afterAll(async () => {
  await sequelize.close();
});
