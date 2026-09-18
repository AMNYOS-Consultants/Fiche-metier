import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Op } from 'sequelize';
import { agentAuthentifie, PREFIXE_TEST } from './helpers/client';
import {
  Formacode,
  FormacodeNiveau,
  ActiviteConnaissance,
  ImportBatch,
  Metier,
} from '../src/models';
import { corrigerFormacodes } from '../src/database/importers/correctionsFormacodes';

/**
 * Le service de correction (erreurs de saisie, doublons, intitulés manquants) est exercé
 * sur des formacodes de test rattachés à une fiche de test — jamais sur la liste réelle
 * de `CORRECTIONS_FORMACODES`, déjà appliquée en base et qui ne ferait donc rien.
 *
 * Montage : une fiche ZZTEST créée par l'API, un couple recopié dessus (n'importe lequel),
 * deux formacodes ZZTEST dont l'un (« ancien ») est cité par ce couple et porte des durées
 * qui entrent en collision avec celles de l'autre (« nouveau ») pour un niveau seulement.
 */
const ANCIEN = `${PREFIXE_TEST}_A`;
const NOUVEAU = `${PREFIXE_TEST}_B`;
const SANS_NOM = `${PREFIXE_TEST}_N`;

describe('Corrections de formacodes', () => {
  let agent: request.Agent;
  let codeMetier: string | null = null;
  let coupleId: number;
  /** Les journaux `import_batch` écrits par le test sont retirés à la fin. */
  let dernierBatchAvant: number;

  async function nettoyerFormacodes() {
    await Formacode.destroy({ where: { codeFormacode: { [Op.in]: [ANCIEN, NOUVEAU, SANS_NOM] } } });
  }

  beforeAll(async () => {
    agent = await agentAuthentifie();
    await nettoyerFormacodes();
    dernierBatchAvant = (await ImportBatch.max('id')) ?? 0;

    const referentiels = await agent.get('/api/referentiels').expect(200);
    const famille = referentiels.body.famillesMetier[0].codeFamille;
    const total = (await agent.get('/api/metiers/options').expect(200)).body.data.length;
    const fiche = await agent
      .post('/api/metiers')
      .send({
        codeFamille: famille,
        totalAttendu: total,
        intitule: 'ZZTEST Fiche pour corrections de formacodes',
        definition: 'Définition de test',
        dossierSourceId: null,
        dossierAutre: null,
        redacteur: 'Suite de tests',
        responsTransverse: 'non',
        interfaceAmontAval: 'Non',
      })
      .expect(201);
    codeMetier = fiche.body.codeMetier;

    // Un couple à recopier : celui d'une fiche quelconque qui en porte au moins un.
    const metiers = await agent.get('/api/metiers?limit=5').expect(200);
    let source: number | null = null;
    for (const m of metiers.body.data) {
      const couples = await agent
        .get(`/api/metiers/${encodeURIComponent(m.codeMetier)}/activites`)
        .expect(200);
      if (couples.body.data.length > 0) {
        source = couples.body.data[0].id;
        break;
      }
    }
    expect(source).not.toBeNull();
    const couple = await agent
      .post(`/api/metiers/${encodeURIComponent(codeMetier!)}/couples`)
      .send({ coupleSourceId: source })
      .expect(201);
    coupleId = couple.body.id;

    await Formacode.bulkCreate([
      { codeFormacode: ANCIEN, intitule: 'Ancien (test)', codeNsf: null, estFondamental: false },
      { codeFormacode: NOUVEAU, intitule: 'Nouveau (test)', codeNsf: null, estFondamental: false },
      { codeFormacode: SANS_NOM, intitule: SANS_NOM, codeNsf: null, estFondamental: false },
    ]);
    const duree = (codeFormacode: string, niveau: number, dureeHeures: number) => ({
      codeFormacode,
      niveau,
      dureeHeures,
      dureeSemaines: null,
      dureeMois: null,
      methodeCalcul: null,
      source: null,
      origine: 'outil_fiche_metier' as const,
    });
    await FormacodeNiveau.bulkCreate([
      // Niveau 1 : existe sur les deux → la durée de l'ancien doit être abandonnée.
      duree(ANCIEN, 1, 10),
      duree(NOUVEAU, 1, 99),
      // Niveau 2 : seulement sur l'ancien → doit être re-pointée.
      duree(ANCIEN, 2, 20),
    ]);
    await ActiviteConnaissance.create({
      metierActiviteId: coupleId,
      codeFormacode: ANCIEN,
      intitule: 'DOMAINE DE TEST',
      niveau: 2,
      dureeHeures: null,
      justificationDuree: null,
      codeNsf: null,
      ordre: 5,
    });
    // Repère de péremption remis à zéro : c'est ce que la correction doit poser.
    await Metier.update({ proximitePerimeeLe: null }, { where: { codeMetier: codeMetier! }, silent: true });
  });

  afterAll(async () => {
    await nettoyerFormacodes();
    if (codeMetier) await agent.delete(`/api/metiers/${encodeURIComponent(codeMetier)}`);
    await ImportBatch.destroy({ where: { id: { [Op.gt]: dernierBatchAvant } } });
  });

  it('re-pointe les références, supprime l’ancien code et date la fiche périmée', async () => {
    const bilan = await corrigerFormacodes(
      [{ ancien: ANCIEN, nouveau: NOUVEAU, motif: 'test' }],
      [{ code: SANS_NOM, intitule: 'Intitulé de test' }],
    );

    expect(bilan.codes).toHaveLength(1);
    expect(bilan.codes[0]).toMatchObject({
      statut: 'corrige',
      connaissancesDeplacees: 1,
      connaissancesDoublons: 0,
      niveauxDeplaces: 1,
      niveauxDoublons: 1,
      metiersTouches: 1,
    });
    expect(bilan.intitules[0]).toMatchObject({ code: SANS_NOM, statut: 'corrige' });

    // L'ancien code a disparu, le couple cite le nouveau, le libellé contextualisé reste.
    expect(await Formacode.findByPk(ANCIEN)).toBeNull();
    const connaissance = await ActiviteConnaissance.findOne({
      where: { metierActiviteId: coupleId, codeFormacode: NOUVEAU },
    });
    expect(connaissance?.intitule).toBe('DOMAINE DE TEST');

    // Durées : la collision garde la valeur du nouveau, l'autre a suivi.
    const niveaux = await FormacodeNiveau.findAll({
      where: { codeFormacode: NOUVEAU },
      order: [['niveau', 'ASC']],
    });
    expect(niveaux.map((n) => [n.niveau, Number(n.dureeHeures)])).toEqual([
      [1, 99],
      [2, 20],
    ]);

    expect((await Formacode.findByPk(SANS_NOM))?.intitule).toBe('Intitulé de test');

    const fiche = await Metier.findByPk(codeMetier!, { attributes: ['proximitePerimeeLe'] });
    expect(fiche?.proximitePerimeeLe).not.toBeNull();
  });

  it('est idempotent : un second passage ne touche à rien', async () => {
    const bilan = await corrigerFormacodes(
      [{ ancien: ANCIEN, nouveau: NOUVEAU, motif: 'test' }],
      [{ code: SANS_NOM, intitule: 'Intitulé de test' }],
    );
    expect(bilan.codes[0].statut).toBe('deja_corrige');
    expect(bilan.intitules[0].statut).toBe('deja_corrige');
  });

  it('ignore une correction dont la cible n’existe pas, sans rien supprimer', async () => {
    const bilan = await corrigerFormacodes(
      [{ ancien: NOUVEAU, nouveau: `${PREFIXE_TEST}_X`, motif: 'test' }],
      [{ code: `${PREFIXE_TEST}_X`, intitule: 'x' }],
    );
    expect(bilan.codes[0].statut).toBe('cible_absente');
    expect(bilan.intitules[0].statut).toBe('code_absent');
    expect(await Formacode.findByPk(NOUVEAU)).not.toBeNull();
  });

  it('journalise chaque passage dans import_batch', async () => {
    const batchs = await ImportBatch.findAll({
      where: { id: { [Op.gt]: dernierBatchAvant }, fichier: 'corrections formacodes' },
      order: [['id', 'ASC']],
    });
    expect(batchs.length).toBe(3);
    expect(batchs[0].statut).toBe('termine');
    expect(batchs[0].lignesOk).toBe(2);
    expect(batchs[2].lignesErreur).toBe(2);
  });
});
