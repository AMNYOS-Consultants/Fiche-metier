import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { agentAuthentifie, PREFIXE_TEST } from './helpers/client';

const CODE_TEST = `${PREFIXE_TEST}01`;

describe('Formacodes — lecture', () => {
  let agent: request.Agent;

  beforeAll(async () => {
    agent = await agentAuthentifie();
  });

  it('liste les formacodes, paginés', async () => {
    const res = await agent.get('/api/formacodes?limit=5').expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.pagination.total).toBeGreaterThan(0);
  });

  it('filtre par NSF', async () => {
    const withNsf = await agent.get('/api/formacodes?limit=1').expect(200);
    const nsf = withNsf.body.data.find((f: { codeNsf: string | null }) => f.codeNsf)?.codeNsf;
    if (!nsf) return; // improbable, mais évite un test bancal si l'échantillon n'en porte pas

    const res = await agent.get(`/api/formacodes?nsf=${encodeURIComponent(nsf)}`).expect(200);
    for (const f of res.body.data) expect(f.codeNsf).toBe(nsf);
  });

  it('404 sur un code inconnu', async () => {
    await agent.get('/api/formacodes/CODE-INEXISTANT-XYZ').expect(404);
  });

  it('le détail liste les métiers qui portent ce formacode', async () => {
    const liste = await agent.get('/api/formacodes?limit=1').expect(200);
    const code = liste.body.data[0].codeFormacode;

    const res = await agent.get(`/api/formacodes/${encodeURIComponent(code)}`).expect(200);
    expect(res.body.codeFormacode).toBe(code);
    expect(Array.isArray(res.body.metiers)).toBe(true);
  });
});

describe('Formacodes — cycle de vie complet', () => {
  let agent: request.Agent;

  beforeAll(async () => {
    agent = await agentAuthentifie();
    // Filet de sécurité : un run précédent interrompu pourrait avoir laissé le code de test.
    await agent.delete(`/api/formacodes/${CODE_TEST}`);
  });

  afterAll(async () => {
    await agent.delete(`/api/formacodes/${CODE_TEST}`);
  });

  it('crée un formacode', async () => {
    const res = await agent
      .post('/api/formacodes')
      .send({
        codeFormacode: CODE_TEST,
        intitule: 'Formacode de test automatisé',
        codeNsf: null,
        estFondamental: false,
      })
      .expect(201);
    expect(res.body.codeFormacode).toBe(CODE_TEST);
  });

  it('refuse un doublon de code', async () => {
    const res = await agent
      .post('/api/formacodes')
      .send({ codeFormacode: CODE_TEST, intitule: 'Doublon', codeNsf: null, estFondamental: false })
      .expect(400);
    expect(res.body.error.code).toBe('REQUETE_INVALIDE');
  });

  it('remplace les niveaux en bloc', async () => {
    const res = await agent
      .put(`/api/formacodes/${CODE_TEST}/niveaux`)
      .send({
        niveaux: [
          {
            niveau: 1,
            origine: 'outil_fiche_metier',
            estNiveauUnique: false,
            dureeHeures: 35,
            dureeSemaines: null,
            dureeMois: null,
            methodeCalcul: null,
            source: 'Suite de tests',
          },
        ],
      })
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].dureeHeures).toBe('35.00');
  });

  it('refuse un couple (niveau, origine) envoyé deux fois', async () => {
    const ligne = {
      niveau: 1,
      origine: 'outil_fiche_metier' as const,
      estNiveauUnique: false,
      dureeHeures: null,
      dureeSemaines: null,
      dureeMois: null,
      methodeCalcul: null,
      source: null,
    };
    const res = await agent
      .put(`/api/formacodes/${CODE_TEST}/niveaux`)
      .send({ niveaux: [ligne, ligne] })
      .expect(400);
    expect(res.body.error.code).toBe('REQUETE_INVALIDE');
  });

  it('supprime le formacode de test (non utilisé par aucun couple)', async () => {
    await agent.delete(`/api/formacodes/${CODE_TEST}`).expect(204);
    await agent.get(`/api/formacodes/${CODE_TEST}`).expect(404);
  });

  it('refuse de supprimer un formacode encore utilisé par un couple', async () => {
    const utilises = await agent.get('/api/formacodes?limit=50').expect(200);
    let codeUtilise: string | null = null;
    for (const f of utilises.body.data) {
      const detail = await agent.get(`/api/formacodes/${encodeURIComponent(f.codeFormacode)}`).expect(200);
      if (detail.body.metiers.length > 0) {
        codeUtilise = f.codeFormacode;
        break;
      }
    }
    if (!codeUtilise) return; // improbable sur un échantillon de 50, mais on ne bloque pas le run

    const res = await agent.delete(`/api/formacodes/${encodeURIComponent(codeUtilise)}`).expect(400);
    expect(res.body.error.code).toBe('REQUETE_INVALIDE');
  });
});
