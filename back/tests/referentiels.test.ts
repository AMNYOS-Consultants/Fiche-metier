import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { agentAuthentifie } from './helpers/client';

describe('Référentiels', () => {
  let agent: request.Agent;

  beforeAll(async () => {
    agent = await agentAuthentifie();
  });

  it('renvoie tous les référentiels attendus, non vides', async () => {
    const res = await agent.get('/api/referentiels').expect(200);

    for (const cle of [
      'famillesMetier',
      'famillesActivite',
      'conditions',
      'transversales',
      'acces',
      'dossiersSource',
      'nsf',
      'rome',
    ]) {
      expect(res.body).toHaveProperty(cle);
      expect(Array.isArray(res.body[cle])).toBe(true);
      expect(res.body[cle].length).toBeGreaterThan(0);
    }
  });

  it('chaque famille d’activité porte un domaine 1 (catégorisation peuplée)', async () => {
    const res = await agent.get('/api/referentiels').expect(200);
    for (const famille of res.body.famillesActivite) {
      expect(famille.codeFamilleActivite).toMatch(/^[A-Z]\.\d{2}$/);
    }
  });
});
