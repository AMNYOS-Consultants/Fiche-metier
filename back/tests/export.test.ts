import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { agentAuthentifie } from './helpers/client';

describe('Export général', () => {
  let agent: request.Agent;

  beforeAll(async () => {
    agent = await agentAuthentifie();
  });

  it('exporte les six tables sources, non vides', async () => {
    const res = await agent.get('/api/export/general').expect(200);

    for (const cle of ['metiers', 'couples', 'connaissances', 'transversales', 'conditions', 'acces']) {
      expect(res.body).toHaveProperty(cle);
      expect(Array.isArray(res.body[cle])).toBe(true);
      expect(res.body[cle].length).toBeGreaterThan(0);
    }
  });

  it('ne fuit pas la table calculée metier_proximite (exclue par design)', async () => {
    const res = await agent.get('/api/export/general').expect(200);
    expect(res.body).not.toHaveProperty('proximites');
  });
});
