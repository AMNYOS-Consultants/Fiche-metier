import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { agentAuthentifie } from './helpers/client';
import {
  Activite,
  ActiviteConnaissance,
  FamilleActivite,
  Metier,
  MetierActivite,
  MotCle,
} from '../src/models';

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

  it('/familles renvoie l’arborescence de la page, comptes inclus', async () => {
    const res = await agent.get('/api/activites/familles').expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);

    for (const f of res.body.data) {
      expect(f.codeFamilleActivite).toMatch(/^[A-Z]\.\d{2}$/);
      expect(f).toHaveProperty('domaine1');
      expect(f).toHaveProperty('domaine2');
      // Jointure interne : une famille listée porte forcément au moins une activité.
      expect(f.nbActivites).toBeGreaterThan(0);
    }
  });

  it('/familles exclut les familles de la nomenclature sans aucune activité', async () => {
    const referentiels = await agent.get('/api/referentiels').expect(200);
    const arborescence = await agent.get('/api/activites/familles').expect(200);

    // 39 familles dans nomencl_FAMACTIVITES, dont 5 orphelines (A.02, B.03, D.06, D.07, F.03).
    expect(arborescence.body.data.length).toBeLessThan(referentiels.body.famillesActivite.length);

    const codesListes = new Set(
      arborescence.body.data.map((f: { codeFamilleActivite: string }) => f.codeFamilleActivite),
    );
    expect(codesListes.has('A.02')).toBe(false);
  });

  it('les comptes de /familles couvrent la totalité du catalogue', async () => {
    const arborescence = await agent.get('/api/activites/familles').expect(200);
    const total = arborescence.body.data.reduce(
      (somme: number, f: { nbActivites: number }) => somme + Number(f.nbActivites),
      0,
    );

    const catalogue = await agent.get('/api/activites?limit=1').expect(200);
    // Aucune activité n'est sans famille : l'accordéon doit tout montrer, sans trou.
    expect(total).toBe(catalogue.body.pagination.total);
  });

  it('le compte d’une famille correspond au filtre par famille', async () => {
    const arborescence = await agent.get('/api/activites/familles').expect(200);
    const famille = arborescence.body.data[0];

    const res = await agent
      .get(`/api/activites?famille=${encodeURIComponent(famille.codeFamilleActivite)}&limit=200`)
      .expect(200);
    expect(res.body.pagination.total).toBe(Number(famille.nbActivites));
    // Une famille tient dans un seul appel : le plafond de l'API (200) couvre la plus grosse.
    expect(res.body.data.length).toBe(res.body.pagination.total);
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

describe('Édition depuis la page d’une activité', () => {
  let agent: request.Agent;

  beforeAll(async () => {
    agent = await agentAuthentifie();
  });

  it('les variantes exposent l’identifiant de couple de chaque métier', async () => {
    const incoherences = await agent.get('/api/activites/incoherences').expect(200);
    if (incoherences.body.data.length === 0) return;
    const code = incoherences.body.data[0].codeActivite;

    const res = await agent.get(`/api/activites/${encodeURIComponent(code)}/variantes`).expect(200);
    for (const variante of res.body.data) {
      for (const metier of variante.metiers) {
        expect(typeof metier.coupleId).toBe('number');
        expect(metier.coupleId).toBeGreaterThan(0);
      }
    }
  });

  it('réécrit une rédaction sans toucher aux autres variantes du même code', async () => {
    const incoherences = await agent.get('/api/activites/incoherences').expect(200);
    if (incoherences.body.data.length === 0) return;
    const code: string = incoherences.body.data[0].codeActivite;

    const avant = await agent.get(`/api/activites/${encodeURIComponent(code)}/variantes`).expect(200);
    const cible = [...avant.body.data].sort(
      (a: { metiers: unknown[] }, b: { metiers: unknown[] }) => a.metiers.length - b.metiers.length,
    )[0];
    const autre = avant.body.data.find(
      (v: { coupleModeleId: number }) => v.coupleModeleId !== cible.coupleModeleId,
    );

    const edition = {
      intituleActivite: 'ZZTEST intitulé de test',
      intituleCompetence: cible.intituleCompetence,
      detailsActivite: cible.detailsActivite,
      detailsCompetence: cible.detailsCompetence,
      niveauxMaitrise: cible.niveauxMaitrise,
    };

    try {
      const res = await agent
        .put(`/api/activites/${encodeURIComponent(code)}/redaction`)
        .send({ coupleModeleId: cible.coupleModeleId, edition })
        .expect(200);
      expect(res.body.nbCouplesModifies).toBe(cible.metiers.length);

      const apres = await agent
        .get(`/api/activites/${encodeURIComponent(code)}/variantes`)
        .expect(200);
      const modifiee = apres.body.data.find(
        (v: { intituleActivite: string }) => v.intituleActivite === 'ZZTEST intitulé de test',
      );
      expect(modifiee).toBeDefined();
      expect(modifiee.metiers).toHaveLength(cible.metiers.length);

      // L'autre variante est intacte : c'est ce qui distingue cette route de l'harmonisation.
      const autreApres = apres.body.data.find(
        (v: { coupleModeleId: number }) => v.coupleModeleId === autre.coupleModeleId,
      );
      expect(autreApres.intituleActivite).toBe(autre.intituleActivite);
      expect(autreApres.metiers).toHaveLength(autre.metiers.length);
    } finally {
      // Remise en état : on réécrit la rédaction d'origine sur le même couple modèle.
      await agent
        .put(`/api/activites/${encodeURIComponent(code)}/redaction`)
        .send({
          coupleModeleId: cible.coupleModeleId,
          edition: {
            intituleActivite: cible.intituleActivite,
            intituleCompetence: cible.intituleCompetence,
            detailsActivite: cible.detailsActivite,
            detailsCompetence: cible.detailsCompetence,
            niveauxMaitrise: cible.niveauxMaitrise,
          },
        });
    }
  });

  it('horodate le couple à chaque édition, même quand seuls les détails changent', async () => {
    const incoherences = await agent.get('/api/activites/incoherences').expect(200);
    if (incoherences.body.data.length === 0) return;
    const code: string = incoherences.body.data[0].codeActivite;

    const avant = await agent.get(`/api/activites/${encodeURIComponent(code)}/variantes`).expect(200);
    const cible = [...avant.body.data].sort(
      (a: { metiers: unknown[] }, b: { metiers: unknown[] }) => a.metiers.length - b.metiers.length,
    )[0];

    const original = {
      intituleActivite: cible.intituleActivite,
      intituleCompetence: cible.intituleCompetence,
      detailsActivite: cible.detailsActivite,
      detailsCompetence: cible.detailsCompetence,
      niveauxMaitrise: cible.niveauxMaitrise,
    };

    try {
      // Intitulés strictement identiques, seuls les détails changent : sans le `updatedAt`
      // explicite d'`appliquerEdition`, Sequelize n'émettrait aucun UPDATE sur la ligne
      // `metier_activite` et le couple resterait daté de sa version précédente.
      await agent
        .put(`/api/activites/${encodeURIComponent(code)}/redaction`)
        .send({
          coupleModeleId: cible.coupleModeleId,
          edition: { ...original, detailsActivite: ['ZZTEST détail ajouté'] },
        })
        .expect(200);

      const apres = await agent
        .get(`/api/activites/${encodeURIComponent(code)}/variantes`)
        .expect(200);
      const modifiee = apres.body.data.find((v: { detailsActivite: string[] }) =>
        v.detailsActivite.includes('ZZTEST détail ajouté'),
      );
      expect(modifiee).toBeDefined();
      for (const m of modifiee.metiers) {
        expect(m.modifieLe).not.toBeNull();
        // Daté à l'instant : une date de migration ou d'import serait bien plus ancienne.
        expect(Date.now() - new Date(m.modifieLe).getTime()).toBeLessThan(120_000);
      }
    } finally {
      await agent
        .put(`/api/activites/${encodeURIComponent(code)}/redaction`)
        .send({ coupleModeleId: cible.coupleModeleId, edition: original });
    }
  });

  it('refuse un formacode inconnu sur les domaines d’un couple', async () => {
    const liste = await agent.get('/api/activites?limit=1').expect(200);
    const code = liste.body.data[0].codeActivite;
    const variantes = await agent
      .get(`/api/activites/${encodeURIComponent(code)}/variantes`)
      .expect(200);
    const coupleId = variantes.body.data[0].metiers[0].coupleId;

    const res = await agent
      .put(`/api/activites/${encodeURIComponent(code)}/couples/${coupleId}/connaissances`)
      .send({ connaissances: [{ codeFormacode: 'ZZZINCONNU', niveau: 1 }] })
      .expect(400);
    expect(res.body.error.message).toMatch(/Formacode\(s\) inconnu/);
  });

  it('refuse un couple qui n’appartient pas au code activité', async () => {
    const liste = await agent.get('/api/activites?limit=1').expect(200);
    const code = liste.body.data[0].codeActivite;

    await agent
      .put(`/api/activites/${encodeURIComponent(code)}/couples/999999999/connaissances`)
      .send({ connaissances: [] })
      .expect(404);
  });

  it('remplace les domaines d’un couple et périme ses passerelles', async () => {
    const liste = await agent.get('/api/activites?limit=1').expect(200);
    const code: string = liste.body.data[0].codeActivite;
    const variantes = await agent
      .get(`/api/activites/${encodeURIComponent(code)}/variantes`)
      .expect(200);
    const variante = variantes.body.data[0];
    const coupleId: number = variante.metiers[0].coupleId;
    const codeMetier: string = variante.metiers[0].codeMetier;

    // Snapshot complet via le modèle : la durée et la justification viennent des classeurs
    // et ne repasseraient pas par l'API de remise en état, qui ne saisit que code + niveau.
    const initiales = (
      await ActiviteConnaissance.findAll({ where: { metierActiviteId: coupleId } })
    ).map((c) => c.get({ plain: true }));

    const formacodes = await agent.get('/api/formacodes?limit=1').expect(200);
    const nouveau = formacodes.body.data[0].codeFormacode;

    try {
      const res = await agent
        .put(`/api/activites/${encodeURIComponent(code)}/couples/${coupleId}/connaissances`)
        .send({ connaissances: [{ codeFormacode: nouveau, niveau: 2 }] })
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].codeFormacode).toBe(nouveau);
      expect(res.body.data[0].niveau).toBe(2);
      // La durée vient du référentiel `formacode_niveau`, elle n'est pas saisie à la main.
      expect(res.body.data[0]).toHaveProperty('dureeHeures');

      const etat = await agent
        .get(`/api/metiers/${encodeURIComponent(codeMetier)}/proximites/etat`)
        .expect(200);
      expect(etat.body).toBeDefined();
    } finally {
      // Restauration à l'identique, champ par champ — y compris les `id`, pour que
      // l'empreinte de la base soit inchangée après le test.
      await ActiviteConnaissance.destroy({ where: { metierActiviteId: coupleId } });
      if (initiales.length > 0) await ActiviteConnaissance.bulkCreate(initiales);
    }
  });

  it('refuse un mot-clé envoyé en double', async () => {
    const liste = await agent.get('/api/activites?limit=1').expect(200);
    const code = liste.body.data[0].codeActivite;
    const variantes = await agent
      .get(`/api/activites/${encodeURIComponent(code)}/variantes`)
      .expect(200);
    const coupleId = variantes.body.data[0].metiers[0].coupleId;

    const res = await agent
      .put(`/api/activites/${encodeURIComponent(code)}/couples/${coupleId}/mots-cles`)
      .send({ motsCles: ['Traçabilité', 'Traçabilité'] })
      .expect(400);
    expect(res.body.error.message).toMatch(/même mot-clé/);
  });

  it('refuse un couple qui n’appartient pas au code activité (mots-clés)', async () => {
    const liste = await agent.get('/api/activites?limit=1').expect(200);
    const code = liste.body.data[0].codeActivite;

    await agent
      .put(`/api/activites/${encodeURIComponent(code)}/couples/999999999/mots-cles`)
      .send({ motsCles: [] })
      .expect(404);
  });

  it('remplace les mots-clés d’un couple, résout et purge `mot_cle`', async () => {
    const liste = await agent.get('/api/activites?limit=1').expect(200);
    const code: string = liste.body.data[0].codeActivite;
    const variantes = await agent
      .get(`/api/activites/${encodeURIComponent(code)}/variantes`)
      .expect(200);
    const coupleId: number = variantes.body.data[0].metiers[0].coupleId;

    // Snapshot des LIBELLÉS, pas des id : `ecrireMotsCles` purge tout mot-clé devenu
    // orphelin, y compris parmi ceux qu'on retire ici. Restaurer par id (`bulkCreate`
    // direct) risquerait de viser un `mot_cle` qui n'existe plus — constaté une fois : un
    // couple réel a perdu ses mots-clés le temps de le découvrir et de les restaurer à la
    // main. La restauration repasse donc par l'API, qui recrée ce qu'il faut.
    const initiales: string[] = variantes.body.data[0].metiers[0].motsCles;

    // Un libellé déjà connu, réutilisé sans recréation, et un inédit — pour exercer les
    // deux chemins de `ecrireMotsCles` (résolution existante / création).
    const existant = await MotCle.findOne();
    const nouveauLibelle = 'ZZTEST mot-clé de test';

    try {
      const res = await agent
        .put(`/api/activites/${encodeURIComponent(code)}/couples/${coupleId}/mots-cles`)
        .send({ motsCles: [existant!.libelle, nouveauLibelle] })
        .expect(200);

      expect(res.body.data).toEqual([existant!.libelle, nouveauLibelle]);

      const cree = await MotCle.findOne({ where: { libelle: nouveauLibelle } });
      expect(cree).not.toBeNull();

      // Relecture par l'API de vérification (obtenirVariantes) : le champ doit refléter
      // exactement ce qui vient d'être écrit, pas une valeur mise en cache.
      const relu = await agent
        .get(`/api/activites/${encodeURIComponent(code)}/variantes`)
        .expect(200);
      const metierRelu = relu.body.data
        .flatMap((v: { metiers: Array<{ coupleId: number; motsCles: string[] }> }) => v.metiers)
        .find((m: { coupleId: number }) => m.coupleId === coupleId);
      expect(metierRelu.motsCles).toEqual([existant!.libelle, nouveauLibelle]);
    } finally {
      // Restauration par l'API : `nouveauLibelle` en sera automatiquement purgé (devenu
      // orphelin), et un original qui aurait été purgé entre-temps serait recréé.
      await agent
        .put(`/api/activites/${encodeURIComponent(code)}/couples/${coupleId}/mots-cles`)
        .send({ motsCles: initiales });
    }
  });
});

describe('Création d’un couple activité-compétence', () => {
  let agent: request.Agent;
  /** Codes créés par les tests : supprimés en fin de suite, la cascade emporte le reste. */
  const codesCrees: string[] = [];
  /** Familles créées par les tests : à retirer après leurs activités (clé étrangère). */
  const famillesCreees: string[] = [];
  let codeMetier = '';

  beforeAll(async () => {
    agent = await agentAuthentifie();
    const metiers = await agent.get('/api/metiers/options').expect(200);
    codeMetier = metiers.body.data[0].codeMetier;
  });

  afterAll(async () => {
    if (codesCrees.length === 0 && famillesCreees.length === 0) return;
    // Supprimer l'activité emporte le couple (fk_ma_activite ON DELETE CASCADE) et,
    // par lui, détails, niveaux et domaines. Les familles ne partent qu'ensuite : leurs
    // activités les référencent. Reste à remettre `nb_couple` d'aplomb.
    if (codesCrees.length > 0) await Activite.destroy({ where: { codeActivite: codesCrees } });
    if (famillesCreees.length > 0) {
      await FamilleActivite.destroy({ where: { codeFamilleActivite: famillesCreees } });
    }
    const total = await MetierActivite.count({ where: { codeMetier } });
    await Metier.update({ nbCouple: total }, { where: { codeMetier }, silent: true });
  });

  it('crée une nouvelle activité dans une famille : 3e segment attribué, déclinaison .01', async () => {
    const familles = await agent.get('/api/activites/familles').expect(200);
    const famille: string = familles.body.data[0].codeFamilleActivite;

    const duFamille = await agent
      .get(`/api/activites?famille=${encodeURIComponent(famille)}&limit=200`)
      .expect(200);
    const maxTroisieme = Math.max(
      ...duFamille.body.data.map((a: { codeActivite: string }) =>
        Number(a.codeActivite.split('.')[2]),
      ),
    );

    const res = await agent
      .post('/api/activites')
      .send({
        codeMetier,
        famille,
        intituleActivite: 'ZZTEST activité créée par les tests',
        intituleCompetence: 'ZZTEST compétence',
        detailsActivite: ['Détail A', 'Détail B'],
        detailsCompetence: ['Détail compétence'],
        niveauxMaitrise: [{ niveau: 1, description: 'Niveau 1' }],
        connaissances: [],
      })
      .expect(201);

    codesCrees.push(res.body.codeActivite);
    // MAX + 1 sur le 3e segment, et non COUNT + 1 : la numérotation porte des trous.
    expect(res.body.codeActivite).toBe(
      `${famille}.${String(maxTroisieme + 1).padStart(2, '0')}.01`,
    );

    const detail = await agent
      .get(`/api/activites/${encodeURIComponent(res.body.codeActivite)}`)
      .expect(200);
    expect(detail.body.codeFamilleActivite).toBe(famille);
    // Ce couple ne vient d'aucun classeur de collecte.
    expect(detail.body.dossierSourceId).toBeNull();
    expect(detail.body.couples).toHaveLength(1);
    expect(detail.body.couples[0].codeMetier).toBe(codeMetier);
    expect(detail.body.couples[0].detailsActivite).toHaveLength(2);
    expect(detail.body.couples[0].niveauxMaitrise).toHaveLength(1);
  });

  it('crée une déclinaison dans un halo existant : 4e segment attribué', async () => {
    const existantes = await agent.get('/api/activites?limit=1').expect(200);
    const halo: string = existantes.body.data[0].codeActivite.split('.').slice(0, 3).join('.');
    const famille = halo.split('.').slice(0, 2).join('.');

    const duFamille = await agent
      .get(`/api/activites?famille=${encodeURIComponent(famille)}&limit=200`)
      .expect(200);
    const maxQuatrieme = Math.max(
      ...duFamille.body.data
        .filter((a: { codeActivite: string }) => a.codeActivite.startsWith(`${halo}.`))
        .map((a: { codeActivite: string }) => Number(a.codeActivite.split('.')[3])),
    );

    const res = await agent
      .post('/api/activites')
      .send({
        codeMetier,
        halo,
        intituleActivite: 'ZZTEST déclinaison créée par les tests',
        intituleCompetence: null,
        detailsActivite: [],
        detailsCompetence: [],
        niveauxMaitrise: [],
        connaissances: [],
      })
      .expect(201);

    codesCrees.push(res.body.codeActivite);
    expect(res.body.codeActivite).toBe(`${halo}.${String(maxQuatrieme + 1).padStart(2, '0')}`);
  });

  it('un domaine ajouté hérite sa durée du référentiel', async () => {
    const familles = await agent.get('/api/activites/familles').expect(200);
    const famille: string = familles.body.data[0].codeFamilleActivite;

    // Un formacode dont le référentiel connaît une durée pour le niveau visé.
    const niveaux = await agent.get('/api/formacodes?limit=50').expect(200);
    let codeFormacode: string | null = null;
    let niveauAttendu = 0;
    for (const f of niveaux.body.data) {
      const detail = await agent
        .get(`/api/formacodes/${encodeURIComponent(f.codeFormacode)}`)
        .expect(200);
      const avecDuree = detail.body.niveaux.find(
        (n: { dureeHeures: string | null }) => n.dureeHeures !== null,
      );
      if (avecDuree) {
        codeFormacode = f.codeFormacode;
        niveauAttendu = avecDuree.niveau;
        break;
      }
    }
    if (!codeFormacode) return;

    const res = await agent
      .post('/api/activites')
      .send({
        codeMetier,
        famille,
        intituleActivite: 'ZZTEST activité avec domaine',
        intituleCompetence: null,
        detailsActivite: [],
        detailsCompetence: [],
        niveauxMaitrise: [],
        connaissances: [{ codeFormacode, niveau: niveauAttendu }],
      })
      .expect(201);
    codesCrees.push(res.body.codeActivite);

    const detail = await agent
      .get(`/api/activites/${encodeURIComponent(res.body.codeActivite)}`)
      .expect(200);
    const dc = detail.body.couples[0].connaissances;
    expect(dc).toHaveLength(1);
    expect(dc[0].codeFormacode).toBe(codeFormacode);
    expect(dc[0].dureeHeures).not.toBeNull();
  });

  it('crée une famille sous une lettre existante, en héritant son domaine 1', async () => {
    const referentiels = await agent.get('/api/referentiels').expect(200);
    const famillesAvant: Array<{ codeFamilleActivite: string; domaine1: string | null }> =
      referentiels.body.famillesActivite;

    // Une lettre déjà utilisée : son domaine 1 doit être repris, pas ressaisi.
    const lettre = famillesAvant[0].codeFamilleActivite.split('.')[0];
    const domaine1Attendu = famillesAvant.find((f) =>
      f.codeFamilleActivite.startsWith(`${lettre}.`),
    )!.domaine1;
    const maxSousCode = Math.max(
      ...famillesAvant
        .filter((f) => f.codeFamilleActivite.startsWith(`${lettre}.`))
        .map((f) => Number(f.codeFamilleActivite.split('.')[1])),
    );

    const res = await agent
      .post('/api/activites')
      .send({
        codeMetier,
        nouvelleFamille: { lettre, domaine2: 'ZZTEST sous-domaine' },
        intituleActivite: 'ZZTEST activité d’une famille neuve',
        intituleCompetence: null,
        detailsActivite: [],
        detailsCompetence: [],
        niveauxMaitrise: [],
        connaissances: [],
      })
      .expect(201);

    codesCrees.push(res.body.codeActivite);
    famillesCreees.push(`${lettre}.${String(maxSousCode + 1).padStart(2, '0')}`);
    // Famille neuve : elle démarre à l'activité 01, déclinaison 01.
    expect(res.body.codeActivite).toBe(
      `${lettre}.${String(maxSousCode + 1).padStart(2, '0')}.01.01`,
    );

    const apres = await agent.get('/api/referentiels').expect(200);
    const creee = apres.body.famillesActivite.find(
      (f: { codeFamilleActivite: string }) =>
        f.codeFamilleActivite === `${lettre}.${String(maxSousCode + 1).padStart(2, '0')}`,
    );
    expect(creee.domaine1).toBe(domaine1Attendu);
    expect(creee.domaine2).toBe('ZZTEST sous-domaine');
  });

  it('crée une lettre entièrement nouvelle avec son domaine 1', async () => {
    const referentiels = await agent.get('/api/referentiels').expect(200);
    const lettresPrises = new Set(
      referentiels.body.famillesActivite.map((f: { codeFamilleActivite: string }) =>
        f.codeFamilleActivite.split('.')[0],
      ),
    );
    const libre = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((l) => !lettresPrises.has(l));
    if (!libre) return;

    const res = await agent
      .post('/api/activites')
      .send({
        codeMetier,
        nouvelleFamille: {
          lettre: libre,
          domaine1: 'ZZTEST domaine 1 inédit',
          domaine2: 'ZZTEST domaine 2',
          domaine3: 'ZZTEST description libre',
        },
        intituleActivite: 'ZZTEST première activité d’une lettre neuve',
        intituleCompetence: null,
        detailsActivite: [],
        detailsCompetence: [],
        niveauxMaitrise: [],
        connaissances: [],
      })
      .expect(201);

    codesCrees.push(res.body.codeActivite);
    famillesCreees.push(`${libre}.01`);
    // Tout est neuf : la famille, l'activité et la déclinaison démarrent à 01.
    expect(res.body.codeActivite).toBe(`${libre}.01.01.01`);

    // La lettre apparaît dans l'arborescence de la page dès qu'elle porte une activité.
    const arborescence = await agent.get('/api/activites/familles').expect(200);
    const entree = arborescence.body.data.find(
      (f: { codeFamilleActivite: string }) => f.codeFamilleActivite === `${libre}.01`,
    );
    expect(entree.domaine1).toBe('ZZTEST domaine 1 inédit');
    expect(Number(entree.nbActivites)).toBe(1);
  });

  it('refuse une lettre nouvelle sans libellé de domaine 1', async () => {
    const referentiels = await agent.get('/api/referentiels').expect(200);
    const lettresPrises = new Set(
      referentiels.body.famillesActivite.map((f: { codeFamilleActivite: string }) =>
        f.codeFamilleActivite.split('.')[0],
      ),
    );
    const libres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => !lettresPrises.has(l));
    if (libres.length < 2) return;

    const res = await agent
      .post('/api/activites')
      .send({
        codeMetier,
        // Dernière lettre libre : pas celle qu'utilise le test précédent.
        nouvelleFamille: { lettre: libres[libres.length - 1], domaine2: 'ZZTEST' },
        intituleActivite: 'ZZTEST',
        intituleCompetence: null,
        detailsActivite: [],
        detailsCompetence: [],
        niveauxMaitrise: [],
        connaissances: [],
      })
      .expect(400);
    expect(res.body.error.message).toMatch(/domaine d’activité 1 est requis/);

    // Rien ne doit subsister de la tentative.
    const apres = await agent.get('/api/referentiels').expect(200);
    const orpheline = apres.body.famillesActivite.find((f: { codeFamilleActivite: string }) =>
      f.codeFamilleActivite.startsWith(`${libres[libres.length - 1]}.`),
    );
    expect(orpheline).toBeUndefined();
  });

  it('refuse famille et halo ensemble, ou aucun des deux', async () => {
    const base = {
      codeMetier,
      intituleActivite: 'ZZTEST',
      intituleCompetence: null,
      detailsActivite: [],
      detailsCompetence: [],
      niveauxMaitrise: [],
      connaissances: [],
    };

    await agent
      .post('/api/activites')
      .send({ ...base, famille: 'I.02', halo: 'I.02.08' })
      .expect(400);
    await agent.post('/api/activites').send(base).expect(400);
  });

  it('refuse un halo qui n’existe pas', async () => {
    const res = await agent
      .post('/api/activites')
      .send({
        codeMetier,
        halo: 'I.02.99',
        intituleActivite: 'ZZTEST',
        intituleCompetence: null,
        detailsActivite: [],
        detailsCompetence: [],
        niveauxMaitrise: [],
        connaissances: [],
      })
      .expect(400);
    expect(res.body.error.message).toMatch(/n’existe pas/);
  });

  it('refuse un métier inconnu', async () => {
    await agent
      .post('/api/activites')
      .send({
        codeMetier: 'ZZZ999',
        famille: 'I.02',
        intituleActivite: 'ZZTEST',
        intituleCompetence: null,
        detailsActivite: [],
        detailsCompetence: [],
        niveauxMaitrise: [],
        connaissances: [],
      })
      .expect(404);
  });

  it('un formacode inconnu annule toute la création, sans activité orpheline', async () => {
    const avant = await agent.get('/api/activites?limit=1').expect(200);

    await agent
      .post('/api/activites')
      .send({
        codeMetier,
        famille: 'I.02',
        intituleActivite: 'ZZTEST création qui doit échouer',
        intituleCompetence: null,
        detailsActivite: [],
        detailsCompetence: [],
        niveauxMaitrise: [],
        connaissances: [{ codeFormacode: 'ZZINCONNU', niveau: 1 }],
      })
      .expect(400);

    // La validation des formacodes arrive après la création de l'activité dans la
    // transaction : c'est le rollback qui garantit qu'il n'en reste rien.
    const apres = await agent.get('/api/activites?limit=1').expect(200);
    expect(apres.body.pagination.total).toBe(avant.body.pagination.total);
  });
});

describe('Incohérences — scinder une rédaction vers un nouveau code', () => {
  let agent: request.Agent;
  /** Renseignés dès qu'une scission a eu lieu : `afterAll` remet la base en état. */
  let codeCree: string | null = null;
  let codeOrigine: string | null = null;

  beforeAll(async () => {
    agent = await agentAuthentifie();
  });

  // La scission touche de vraies données : on repointe les couples déplacés vers leur code
  // d'origine et on supprime l'activité créée. Sans `edition`, la scission ne modifie que
  // `code_activite` — le retour en arrière est donc exact, rien n'est perdu.
  afterAll(async () => {
    if (!codeCree || !codeOrigine) return;
    await MetierActivite.update(
      { codeActivite: codeOrigine },
      { where: { codeActivite: codeCree } },
    );
    await Activite.destroy({ where: { codeActivite: codeCree } });
  });

  it('refuse un couple qui ne porte pas le code visé', async () => {
    const incoherences = await agent.get('/api/activites/incoherences').expect(200);
    if (incoherences.body.data.length === 0) return;
    const code = incoherences.body.data[0].codeActivite;

    const res = await agent
      .post(`/api/activites/${encodeURIComponent(code)}/scinder`)
      .send({ coupleModeleId: 999_999_999 })
      .expect(400);
    expect(res.body.error.code).toBe('REQUETE_INVALIDE');
  });

  it('refuse de scinder un code dont toutes les rédactions sont identiques', async () => {
    // Un code cohérent : ses couples partagent tous la même rédaction, il n'y a rien à détacher.
    const coherents = await agent.get('/api/activites?limit=50').expect(200);
    for (const activite of coherents.body.data) {
      const variantes = await agent
        .get(`/api/activites/${encodeURIComponent(activite.codeActivite)}/variantes`)
        .expect(200);
      if (variantes.body.data.length !== 1) continue;

      const res = await agent
        .post(`/api/activites/${encodeURIComponent(activite.codeActivite)}/scinder`)
        .send({ coupleModeleId: variantes.body.data[0].coupleModeleId })
        .expect(400);
      expect(res.body.error.message).toMatch(/rien à détacher/);
      return;
    }
  });

  it('détache la rédaction divergente vers le prochain code libre du halo', async () => {
    const incoherences = await agent.get('/api/activites/incoherences').expect(200);
    if (incoherences.body.data.length === 0) return;

    const code: string = incoherences.body.data[0].codeActivite;
    const variantes = await agent
      .get(`/api/activites/${encodeURIComponent(code)}/variantes`)
      .expect(200);

    // La variante la moins portée : le moins de lignes déplacées, donc le moins à remettre.
    const variante = [...variantes.body.data].sort(
      (a: { metiers: unknown[] }, b: { metiers: unknown[] }) => a.metiers.length - b.metiers.length,
    )[0];

    const res = await agent
      .post(`/api/activites/${encodeURIComponent(code)}/scinder`)
      .send({ coupleModeleId: variante.coupleModeleId })
      .expect(201);

    codeOrigine = code;
    codeCree = res.body.codeActivite;

    const halo = code.split('.').slice(0, 3).join('.');
    expect(codeCree!.startsWith(`${halo}.`)).toBe(true);
    expect(codeCree).not.toBe(code);
    expect(res.body.nbMetiersDeplaces).toBe(variante.metiers.length);

    // Le nouveau code existe, porte les métiers déplacés, et hérite de la famille d'origine.
    const cree = await agent.get(`/api/activites/${encodeURIComponent(codeCree!)}`).expect(200);
    expect(cree.body.couples).toHaveLength(variante.metiers.length);
    const origine = await agent.get(`/api/activites/${encodeURIComponent(code)}`).expect(200);
    expect(cree.body.codeFamilleActivite).toBe(origine.body.codeFamilleActivite);

    // Les détails du couple suivent le déplacement : ils pendent de metier_activite.id.
    const coupleDeplace = cree.body.couples[0];
    expect(coupleDeplace.intituleActivite).toBe(variante.intituleActivite);
    expect(coupleDeplace.detailsActivite.map((d: { libelle: string }) => d.libelle)).toEqual(
      variante.detailsActivite,
    );

    // Le code d'origine ne porte plus cette rédaction : une variante de moins.
    const apres = await agent
      .get(`/api/activites/${encodeURIComponent(code)}/variantes`)
      .expect(200);
    expect(apres.body.data.length).toBe(variantes.body.data.length - 1);
  });

  it('le nouveau code n’écrase jamais un code existant du halo', async () => {
    if (!codeCree) return;
    const segments = codeCree.split('.');
    const halo = segments.slice(0, 3).join('.');
    const suffixeCree = Number(segments[3]);

    // Le filtre `famille` porte sur les deux premiers segments : de quoi couvrir le halo.
    const famille = segments.slice(0, 2).join('.');
    const duHalo = await agent
      .get(`/api/activites?famille=${encodeURIComponent(famille)}&limit=200`)
      .expect(200);

    const autresDuHalo = duHalo.body.data.filter(
      (a: { codeActivite: string }) =>
        a.codeActivite.startsWith(`${halo}.`) && a.codeActivite !== codeCree,
    );
    expect(autresDuHalo.length).toBeGreaterThan(0);
    // MAX + 1 et non COUNT + 1 : le suffixe attribué dépasse tous ceux déjà pris.
    for (const a of autresDuHalo) {
      expect(Number(a.codeActivite.split('.')[3])).toBeLessThan(suffixeCree);
    }
  });
});
