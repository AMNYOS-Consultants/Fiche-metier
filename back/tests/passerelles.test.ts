import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { agentAuthentifie } from './helpers/client';

describe('Passerelles', () => {
  let agent: request.Agent;
  let codeA: string;
  let codeB: string;

  beforeAll(async () => {
    agent = await agentAuthentifie();
    const metiers = await agent.get('/api/metiers/options').expect(200);
    codeA = metiers.body.data[0].codeMetier;
    codeB = metiers.body.data[1].codeMetier;
  });

  it('404 sur un code métier inconnu', async () => {
    await agent.get('/api/passerelles/CODE-INEXISTANT-XYZ/proches').expect(404);
  });

  it('liste les métiers proches, triés, avec les paramètres par défaut du classeur', async () => {
    const res = await agent.get(`/api/passerelles/${encodeURIComponent(codeA)}/proches`).expect(200);
    expect(res.body.metier.codeMetier).toBe(codeA);
    expect(res.body.parametres).toEqual({ heuresMax: 10_000, dcMin: 1, degreMin: 0.1, limite: 15 });
    expect(Array.isArray(res.body.data)).toBe(true);
    // Le métier ne peut pas être sa propre passerelle.
    expect(res.body.data.every((m: { codeMetier: string }) => m.codeMetier !== codeA)).toBe(true);
  });

  it('respecte le paramètre limite, plafonné à 350', async () => {
    const res = await agent
      .get(`/api/passerelles/${encodeURIComponent(codeA)}/proches?limite=999999`)
      .expect(200);
    expect(res.body.parametres.limite).toBe(350);
  });

  it('compare deux métiers : écarts de connaissances cohérents', async () => {
    const res = await agent
      .get(`/api/passerelles/${encodeURIComponent(codeA)}/vers/${encodeURIComponent(codeB)}`)
      .expect(200);

    expect(res.body).toHaveProperty('ecarts');
    expect(res.body).toHaveProperty('totalHeures');
    expect(res.body).toHaveProperty('nbDcCommuns');
    expect(Array.isArray(res.body.ecarts)).toBe(true);
    expect(res.body.totalHeures).toBeGreaterThanOrEqual(0);
    expect(res.body.nbDcCommuns).toBeGreaterThanOrEqual(0);

    // Régression : un même formacode ne doit apparaître qu'une fois dans les écarts — le
    // bug corrigé dans comparerMetiers() faisait apparaître des doublons quand un formacode
    // avait plusieurs lignes formacode_niveau (une par origine) pour le même niveau.
    const codes = res.body.ecarts.map((e: { codeFormacode: string }) => e.codeFormacode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('aucun domaine ne rend d’heures : le plancher à 0 du classeur de référence', async () => {
    // Régression : une durée de niveau cible non documentée vaut 0, et la soustraction de la
    // durée du niveau détenu produisait un crédit négatif qui effaçait des heures réelles
    // (cas P232 -> H276 : -230,70 h sur le formacode 35071, exigé au niveau 3 alors que le
    // référentiel ne documente que les niveaux 1 et 2). Le classeur de référence, lui, masque
    // toute différence négative.
    const paires = [
      [codeA, codeB],
      [codeB, codeA],
    ];

    for (const [source, cible] of paires) {
      const res = await agent
        .get(`/api/passerelles/${encodeURIComponent(source)}/vers/${encodeURIComponent(cible)}`)
        .expect(200);

      for (const e of res.body.ecarts) {
        expect(Number(e.heuresAcquerir)).toBeGreaterThanOrEqual(0);
      }
      // Le total est exactement la somme des lignes : plus rien ne se compense.
      const somme = res.body.ecarts.reduce(
        (s: number, e: { heuresAcquerir: number }) => s + Number(e.heuresAcquerir),
        0,
      );
      expect(res.body.totalHeures).toBeCloseTo(somme, 2);
      expect(res.body.totalHeures).toBeGreaterThanOrEqual(0);
    }
  });

  it('le tableau précalculé ne porte aucune durée négative', async () => {
    const res = await agent.get(`/api/passerelles/${encodeURIComponent(codeA)}/proches?limite=350`).expect(200);
    for (const m of res.body.data) {
      expect(Number(m.dureeAcquisitionHeures ?? 0)).toBeGreaterThanOrEqual(0);
    }
  });

  it('404 en comparant avec un métier cible inconnu', async () => {
    await agent.get(`/api/passerelles/${encodeURIComponent(codeA)}/vers/CODE-INEXISTANT-XYZ`).expect(404);
  });

  it('la comparaison est symétrique dans sa structure (A→B et B→A répondent toutes deux)', async () => {
    const aVersB = await agent
      .get(`/api/passerelles/${encodeURIComponent(codeA)}/vers/${encodeURIComponent(codeB)}`)
      .expect(200);
    const bVersA = await agent
      .get(`/api/passerelles/${encodeURIComponent(codeB)}/vers/${encodeURIComponent(codeA)}`)
      .expect(200);

    expect(typeof aVersB.body.totalHeures).toBe('number');
    expect(typeof bVersA.body.totalHeures).toBe('number');
  });
});
