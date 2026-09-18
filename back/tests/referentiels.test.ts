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

  it('/rome liste chaque code du référentiel avec les métiers qui le portent', async () => {
    const [referentiels, rome] = await Promise.all([
      agent.get('/api/referentiels').expect(200),
      agent.get('/api/referentiels/rome').expect(200),
    ]);

    const codes = rome.body.data.map((r: { codeRome: string }) => r.codeRome);
    expect(codes).toEqual(referentiels.body.rome.map((r: { codeRome: string }) => r.codeRome));

    for (const r of rome.body.data) {
      expect(Array.isArray(r.metiers)).toBe(true);
      for (const m of r.metiers) {
        expect(m).toHaveProperty('codeMetier');
        expect(m).toHaveProperty('intitule');
      }
    }
    // Les fiches citent des codes ROME : au moins un code est porté par un métier.
    expect(rome.body.data.some((r: { metiers: unknown[] }) => r.metiers.length > 0)).toBe(true);
  });

  it('/rome est cohérent avec la fiche métier : le métier cité porte bien ce code', async () => {
    const rome = await agent.get('/api/referentiels/rome').expect(200);
    const porte = rome.body.data.find((r: { metiers: unknown[] }) => r.metiers.length > 0);
    const { codeRome, metiers } = porte;

    const fiche = await agent
      .get(`/api/metiers/${encodeURIComponent(metiers[0].codeMetier)}`)
      .expect(200);
    expect(fiche.body.codesRome.map((c: { codeRome: string }) => c.codeRome)).toContain(codeRome);
  });

  it('chaque famille d’activité porte un domaine 1 (catégorisation peuplée)', async () => {
    const res = await agent.get('/api/referentiels').expect(200);
    for (const famille of res.body.famillesActivite) {
      expect(famille.codeFamilleActivite).toMatch(/^[A-Z]\.\d{2}$/);
    }
  });
});
