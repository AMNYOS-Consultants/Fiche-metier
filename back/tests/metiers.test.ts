import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { agentAuthentifie } from './helpers/client';

describe('Métiers — lecture', () => {
  let agent: request.Agent;

  beforeAll(async () => {
    agent = await agentAuthentifie();
  });

  it('liste les métiers, paginés', async () => {
    const res = await agent.get('/api/metiers?limit=5').expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    expect(res.body.pagination.total).toBeGreaterThan(0);
  });

  it('filtre par recherche texte', async () => {
    const toutes = await agent.get('/api/metiers?limit=1').expect(200);
    const cible = toutes.body.data[0];
    const motif = cible.intitule.slice(0, 4);

    const res = await agent.get(`/api/metiers?search=${encodeURIComponent(motif)}`).expect(200);
    expect(res.body.data.some((m: { codeMetier: string }) => m.codeMetier === cible.codeMetier)).toBe(
      true,
    );
  });

  it('/options renvoie la liste complète sans pagination', async () => {
    const paginee = await agent.get('/api/metiers?limit=1').expect(200);
    const options = await agent.get('/api/metiers/options').expect(200);

    expect(options.body.data.length).toBe(paginee.body.pagination.total);
    expect(options.body.data[0]).toHaveProperty('codeMetier');
    expect(options.body.data[0]).toHaveProperty('intitule');
  });

  it('404 sur un code métier inconnu', async () => {
    const res = await agent.get('/api/metiers/CODE-INEXISTANT-XYZ').expect(404);
    expect(res.body.error.code).toBe('NON_TROUVE');
  });

  it('renvoie la fiche complète avec ses relations', async () => {
    const liste = await agent.get('/api/metiers?limit=1').expect(200);
    const code = liste.body.data[0].codeMetier;

    const res = await agent.get(`/api/metiers/${encodeURIComponent(code)}`).expect(200);
    expect(res.body.codeMetier).toBe(code);
    expect(res.body).toHaveProperty('appellations');
    expect(res.body).toHaveProperty('codesRome');
    expect(res.body).toHaveProperty('conditions');
    expect(res.body).toHaveProperty('transversales');
    expect(res.body).toHaveProperty('acces');
  });
});

describe('Métiers — cycle de vie complet (création -> édition -> suppression)', () => {
  let agent: request.Agent;
  /** Code réellement attribué par le serveur (dépend du numéro déjà utilisé dans la famille). */
  let codeCree: string | null = null;

  beforeAll(async () => {
    agent = await agentAuthentifie();
  });

  afterAll(async () => {
    // Filet de sécurité : si une assertion a échoué en cours de route, on ne laisse pas
    // la fiche de test traîner en base.
    if (codeCree) {
      await agent.delete(`/api/metiers/${encodeURIComponent(codeCree)}`);
    }
  });

  it('refuse une famille inconnue', async () => {
    const total = (await agent.get('/api/metiers/options').expect(200)).body.data.length;
    const res = await agent
      .post('/api/metiers')
      .send({
        codeFamille: 'ZZ',
        totalAttendu: total,
        intitule: 'Fiche de test',
        definition: null,
        dossierSourceId: null,
        dossierAutre: null,
        redacteur: null,
        responsTransverse: null,
        interfaceAmontAval: null,
      })
      .expect(400);
    expect(res.body.error.code).toBe('REQUETE_INVALIDE');
  });

  it('refuse un totalAttendu périmé (détection de conflit concurrent)', async () => {
    const referentiels = await agent.get('/api/referentiels').expect(200);
    const famille = referentiels.body.famillesMetier[0].codeFamille;

    const res = await agent
      .post('/api/metiers')
      .send({
        codeFamille: famille,
        totalAttendu: 999_999,
        intitule: 'Fiche de test (conflit)',
        definition: null,
        dossierSourceId: null,
        dossierAutre: null,
        redacteur: null,
        responsTransverse: null,
        interfaceAmontAval: null,
      })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLIT');
  });

  it('crée une fiche métier vierge avec un code auto-généré', async () => {
    const referentiels = await agent.get('/api/referentiels').expect(200);
    const famille = referentiels.body.famillesMetier[0].codeFamille;
    const total = (await agent.get('/api/metiers/options').expect(200)).body.data.length;

    const res = await agent
      .post('/api/metiers')
      .send({
        codeFamille: famille,
        totalAttendu: total,
        intitule: 'ZZTEST Fiche métier de test automatisé',
        definition: 'Définition de test',
        dossierSourceId: null,
        dossierAutre: null,
        redacteur: 'Suite de tests',
        responsTransverse: 'non',
        interfaceAmontAval: 'Non',
      })
      .expect(201);

    expect(res.body.codeMetier.startsWith(famille)).toBe(true);
    expect(res.body.intitule).toBe('ZZTEST Fiche métier de test automatisé');
    codeCree = res.body.codeMetier;

    // Un deuxième GET la retrouve bien en base.
    const relue = await agent.get(`/api/metiers/${encodeURIComponent(codeCree!)}`).expect(200);
    expect(relue.body.intitule).toBe('ZZTEST Fiche métier de test automatisé');
  });

  it('modifie les champs simples (PATCH)', async () => {
    expect(codeCree).not.toBeNull();
    const res = await agent
      .patch(`/api/metiers/${encodeURIComponent(codeCree!)}`)
      .send({ definition: 'Nouvelle définition de test', responsTransverse: 'oui' })
      .expect(200);

    expect(res.body.definition).toBe('Nouvelle définition de test');
    expect(res.body.responsTransverse).toBe('oui');
  });

  it('remplace les appellations en bloc', async () => {
    const res = await agent
      .put(`/api/metiers/${encodeURIComponent(codeCree!)}/appellations`)
      .send({ appellations: ['Appellation test A', 'Appellation test B'] })
      .expect(200);

    expect(res.body.data.map((a: { appellation: string }) => a.appellation)).toEqual([
      'Appellation test A',
      'Appellation test B',
    ]);
  });

  it('refuse un doublon d’appellation', async () => {
    const res = await agent
      .put(`/api/metiers/${encodeURIComponent(codeCree!)}/appellations`)
      .send({ appellations: ['Même appellation', 'même appellation'] })
      .expect(400);
    expect(res.body.error.code).toBe('REQUETE_INVALIDE');
  });

  it('remplace les codes ROME en bloc, avec vérification du référentiel', async () => {
    const referentiels = await agent.get('/api/referentiels').expect(200);
    const codeRome = referentiels.body.rome[0].codeRome;

    const res = await agent
      .put(`/api/metiers/${encodeURIComponent(codeCree!)}/rome`)
      .send({ codesRome: [codeRome] })
      .expect(200);
    expect(res.body.data[0].codeRome).toBe(codeRome);
  });

  it('refuse un code ROME inconnu', async () => {
    const res = await agent
      .put(`/api/metiers/${encodeURIComponent(codeCree!)}/rome`)
      .send({ codesRome: ['Z9999'] }) // <= 10 caractères (limite du schéma), mais aucun code réel
      .expect(400);
    expect(res.body.error.code).toBe('REQUETE_INVALIDE');
  });

  it('enregistre les conditions d’exercice en bloc', async () => {
    const referentiels = await agent.get('/api/referentiels').expect(200);
    const codeCondition = referentiels.body.conditions[0].codeCondition;

    const res = await agent
      .put(`/api/metiers/${encodeURIComponent(codeCree!)}/conditions`)
      .send({ conditions: [{ codeCondition, valeur: 'significatif' }] })
      .expect(200);
    expect(res.body.data[0].valeur).toBe('significatif');
  });

  it('enregistre les conditions d’accès en bloc', async () => {
    const referentiels = await agent.get('/api/referentiels').expect(200);
    const codeAcces = referentiels.body.acces[0].codeAcces;

    const res = await agent
      .put(`/api/metiers/${encodeURIComponent(codeCree!)}/acces`)
      .send({ acces: [{ codeAcces, valeur: 'Valeur de test' }] })
      .expect(200);
    expect(res.body.data[0].valeur).toBe('Valeur de test');
  });

  it('enregistre les ressources transverses en bloc', async () => {
    const referentiels = await agent.get('/api/referentiels').expect(200);
    const codeTransversale = referentiels.body.transversales[0].codeTransversale;

    const res = await agent
      .put(`/api/metiers/${encodeURIComponent(codeCree!)}/transversales`)
      .send({ transversales: [{ codeTransversale, niveau: 2, nonConcerne: false }] })
      .expect(200);
    expect(res.body.data[0].niveau).toBe(2);
  });

  it('refuse un niveau et « non concerné » simultanés', async () => {
    const referentiels = await agent.get('/api/referentiels').expect(200);
    const codeTransversale = referentiels.body.transversales[0].codeTransversale;

    const res = await agent
      .put(`/api/metiers/${encodeURIComponent(codeCree!)}/transversales`)
      .send({ transversales: [{ codeTransversale, niveau: 2, nonConcerne: true }] })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('la fiche fraîchement créée n’a encore aucun couple activité-compétence', async () => {
    const res = await agent.get(`/api/metiers/${encodeURIComponent(codeCree!)}/activites`).expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('liste les activités ajoutables à cette fiche (catalogue complet, rien encore rattaché)', async () => {
    const res = await agent
      .get(`/api/metiers/${encodeURIComponent(codeCree!)}/couples-ajoutables`)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('l’état des passerelles est disponible même sans aucun couple', async () => {
    const res = await agent.get(`/api/metiers/${encodeURIComponent(codeCree!)}/proximites/etat`).expect(200);
    expect(res.body).toBeDefined();
  });

  it('supprime la fiche, avec cascade complète', async () => {
    await agent.delete(`/api/metiers/${encodeURIComponent(codeCree!)}`).expect(204);

    await agent.get(`/api/metiers/${encodeURIComponent(codeCree!)}`).expect(404);
    codeCree = null; // déjà supprimée : rien à nettoyer dans afterAll
  });

  it('404 en supprimant une fiche déjà absente', async () => {
    await agent.delete('/api/metiers/CODE-INEXISTANT-XYZ').expect(404);
  });
});
