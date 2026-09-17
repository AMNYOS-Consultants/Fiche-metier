import request from 'supertest';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';

/**
 * Une seule instance Express pour toute la suite : `createApp()` ne fait qu'assembler des
 * middlewares/routes, elle n'ouvre pas de connexion propre (le pool Sequelize est un
 * singleton importé par les modèles, voir tests/setup.ts).
 */
export const app = createApp();

/**
 * Agent authentifié : `request.agent` conserve le cookie de session entre les requêtes,
 * comme un navigateur. Les identifiants viennent de `back/.env` (ceux de l'environnement
 * qui exécute les tests), pas de ceux du conteneur Docker éventuellement en cours.
 */
export async function agentAuthentifie(): Promise<request.Agent> {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .send({ username: env.auth.username, password: env.auth.password })
    .expect(200);
  return agent;
}

/** Préfixe utilisé par toutes les données créées par les tests, pour les repérer et les nettoyer. */
export const PREFIXE_TEST = 'ZZTEST';
