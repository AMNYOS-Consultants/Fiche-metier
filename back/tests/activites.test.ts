import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { agentAuthentifie } from './helpers/client';

describe('Activités & compétences', () => {
  let agent: request.Agent;

  beforeAll(async () => {
    agent = await agentAuthentifie();
  });

  it('liste les activités, paginées', async () => {
    const res = await agent.get('/api/activites?limit=5').expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.pagination.total).toBeGreaterThan(0);
  });

  it('chaque ligne porte sa famille (domaine d’activité 1 et 2) quand elle est connue', async () => {
    const res = await agent.get('/api/activites?limit=25').expect(200);
    const avecFamille = res.body.data.filter((a: { famille: unknown }) => a.famille);
    // La catégorisation couvre la quasi-totalité du catalogue (voir famille_activite) :
    // sur un échantillon de 25, s'attendre à en voir au moins une.
    expect(avecFamille.length).toBeGreaterThan(0);
    for (const a of avecFamille) {
      expect(a.famille).toHaveProperty('domaine1');
      expect(a.famille).toHaveProperty('domaine2');
      expect(a.famille).toHaveProperty('domaine3');
    }
  });

  it('filtre par famille', async () => {
    // Une activité connue porte forcément une famille reliée (voir famille_activite) :
    // partir de là plutôt que du référentiel garantit un résultat non vide, sans supposer
    // que la première famille listée a des activités rattachées.
    const uneActivite = await agent.get('/api/activites?limit=1').expect(200);
    const codeFamilleActivite = uneActivite.body.data[0].codeFamilleActivite;
    expect(codeFamilleActivite).not.toBeNull();

    const res = await agent
      .get(`/api/activites?famille=${encodeURIComponent(codeFamilleActivite)}`)
      .expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const a of res.body.data) {
      expect(a.codeFamilleActivite).toBe(codeFamilleActivite);
    }
  });

  it('404 sur un code activité inconnu', async () => {
    await agent.get('/api/activites/CODE-INEXISTANT-XYZ').expect(404);
  });

  it('le détail d’une activité liste les métiers (couples) qui l’emploient', async () => {
    const liste = await agent.get('/api/activites?limit=1').expect(200);
    const code = liste.body.data[0].codeActivite;

    const res = await agent.get(`/api/activites/${encodeURIComponent(code)}`).expect(200);
    expect(res.body.codeActivite).toBe(code);
    expect(Array.isArray(res.body.couples)).toBe(true);
  });

  it('la page des incohérences répond (même vide)', async () => {
    const res = await agent.get('/api/activites/incoherences').expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
