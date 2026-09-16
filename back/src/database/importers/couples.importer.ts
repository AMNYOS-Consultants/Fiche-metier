import path from 'node:path';
import { Transaction } from 'sequelize';
import { env } from '../../config/env';
import {
  sequelize,
  Activite,
  MetierActivite,
  ActiviteDetail,
  CompetenceDetail,
  NiveauMaitrise,
  ActiviteMotCle,
  MotCle,
  Metier,
  DossierSource,
  ImportBatch,
  ActiviteConnaissance,
  Formacode,
  Nsf,
  FamilleActivite,
} from '../../models';
import { lireFeuilleBrute, texte, nombre } from './xlsxReader';

/**
 * Les couples activité-compétence occupent 6 blocs de 30 colonnes consécutives,
 * à partir de l'index 46 de `Outil_collecte_fiche_metier`.
 */
const BASE = 46;
const PAS = 30;
const NB_BLOCS = 6;

/** Décalages au sein d'un bloc. */
const B = {
  actInt: 0,
  actDet: [1, 9] as const, // ACT_DETn_1..9
  compInt: 10,
  compDet: [11, 19] as const, // COMP_DETn_1..9
  motsCles: [20, 22] as const, // MOT_CLE_ACTn_1..3
  nivMatr: [23, 26] as const, // NIV_MATRn_1..4
  code: [27, 29] as const, // CODE_ACT_n_1..3 : « C » + « 02 » + « 04.03 »
} as const;

const COL_METIER = 40;
const COL_DOSSIER = 1;

/**
 * Les domaines de connaissance occupent les colonnes 243 à 422 : 6 groupes de 30,
 * un par couple, chacun portant jusqu'à 5 domaines. Au sein d'un groupe, les 5 valeurs
 * d'un même champ sont contiguës — 5 formacodes, puis 5 intitulés, etc.
 */
const CONN_BASE = 243;
const CONN_PAS = 30;
const CONN_PAR_GROUPE = 5;

const C = {
  formacode: 0,
  intitule: 5,
  niveau: 10,
  duree: 15,
  nsf: 20,
  justification: 25,
} as const;

interface Connaissance {
  codeFormacode: string;
  intitule: string | null;
  niveau: number | null;
  dureeHeures: number | null;
  codeNsf: string | null;
  justificationDuree: string | null;
  ordre: number;
}

function lireConnaissances(ligne: unknown[], indexBloc: number): Connaissance[] {
  const base = CONN_BASE + indexBloc * CONN_PAS;
  const domaines: Connaissance[] = [];

  for (let k = 0; k < CONN_PAR_GROUPE; k++) {
    const codeFormacode = texte(ligne[base + C.formacode + k]);
    if (!codeFormacode) continue;

    domaines.push({
      codeFormacode,
      intitule: texte(ligne[base + C.intitule + k]),
      niveau: nombre(ligne[base + C.niveau + k]),
      dureeHeures: nombre(ligne[base + C.duree + k]),
      codeNsf: texte(ligne[base + C.nsf + k]),
      justificationDuree: texte(ligne[base + C.justification + k]),
      ordre: k + 1,
    });
  }

  return domaines;
}

interface Bloc {
  ordre: number;
  codeActivite: string;
  intituleActivite: string;
  intituleCompetence: string | null;
  detailsActivite: string[];
  detailsCompetence: string[];
  motsCles: string[];
  niveaux: string[];
  connaissances: Connaissance[];
}

function lireBlocs(ligne: unknown[]): Bloc[] {
  const blocs: Bloc[] = [];

  for (let i = 0; i < NB_BLOCS; i++) {
    const base = BASE + i * PAS;
    const intituleActivite = texte(ligne[base + B.actInt]);
    if (!intituleActivite) continue;

    const plage = (bornes: readonly [number, number]): string[] => {
      const valeurs: string[] = [];
      for (let c = bornes[0]; c <= bornes[1]; c++) {
        const v = texte(ligne[base + c]);
        if (v) valeurs.push(v);
      }
      return valeurs;
    };

    // Le code est éclaté en trois cellules : « C » / « 02 » / « 04.03 » -> « C.02.04.03 ».
    const codeActivite = corrigerCodeActivite(plage(B.code).join('.'));
    if (!codeActivite) continue;

    blocs.push({
      ordre: i + 1,
      codeActivite,
      intituleActivite,
      intituleCompetence: texte(ligne[base + B.compInt]),
      detailsActivite: plage(B.actDet),
      detailsCompetence: plage(B.compDet),
      motsCles: plage(B.motsCles),
      niveaux: plage(B.nivMatr),
      connaissances: lireConnaissances(ligne, i),
    });
  }

  return blocs;
}

/**
 * Corrige les erreurs de saisie connues du classeur source, sur la cellule du sous-code
 * (deuxième segment) : « B.025.32.01 » n'a pas de sens (3 chiffres) et vaut en réalité
 * « B.02.32.01 » (confirmé par le métier).
 */
const CODES_ACTIVITE_CORRIGES: ReadonlyMap<string, string> = new Map([
  ['B.025.32.01', 'B.02.32.01'],
]);

function corrigerCodeActivite(code: string): string {
  return CODES_ACTIVITE_CORRIGES.get(code) ?? code;
}

/**
 * Déduit le code de famille (« B.01 ») du code activité (« B.01.02.01 ») : lettre en
 * majuscule, sous-code sur 2 chiffres. Récupère ainsi les préfixes mal saisis dans la
 * source (« E.2 », « k.02 », « I.3 » -> « E.02 », « K.02 », « I.03 ») ; ne renvoie le code
 * que s'il correspond à une famille réellement connue de `famille_activite`, pour ne
 * jamais violer la clé étrangère (« B.025 », 3 chiffres, reste irrécupérable).
 */
export function deriverCodeFamille(codeActivite: string, famillesConnues: Set<string>): string | null {
  const [lettre, sousCode] = codeActivite.split('.');
  if (!lettre || !sousCode) return null;
  const code = `${lettre.toUpperCase()}.${sousCode.padStart(2, '0')}`;
  return famillesConnues.has(code) ? code : null;
}

export async function importerCouples(): Promise<void> {
  const fichier = path.resolve(__dirname, '../../..', env.xlsx.competences);
  const lignes = lireFeuilleBrute(fichier, 'Outil_collecte_fiche_metier');

  const batch = await ImportBatch.create({
    fichier: path.basename(fichier),
    feuille: 'Outil_collecte_fiche_metier (couples activité-compétence)',
    version: 'V3.3',
    lignesLues: lignes.length - 1,
    rapport: null,
    termineLe: null,
  });

  const metiersConnus = new Set((await Metier.findAll({ attributes: ['codeMetier'] })).map((m) => m.codeMetier));
  const dossiers = new Map((await DossierSource.findAll()).map((d) => [d.libelle, d.id] as const));

  const rejets: Array<{ ligne: number; code: string; motif: string }> = [];
  const domainesIgnores: Array<{ couple: number; formacode: string; motif: string }> = [];
  let couples = 0;
  let connaissances = 0;

  const transaction = await sequelize.transaction();
  try {
    const formacodesConnus = new Set(
      (await Formacode.findAll({ attributes: ['codeFormacode'], transaction })).map(
        (f) => f.codeFormacode,
      ),
    );
    const nsfConnus = new Set(
      (await Nsf.findAll({ attributes: ['codeNsf'], transaction })).map((n) => n.codeNsf),
    );
    const famillesConnues = new Set(
      (await FamilleActivite.findAll({ attributes: ['codeFamilleActivite'], transaction })).map(
        (f) => f.codeFamilleActivite,
      ),
    );

    // Cache mémoire des mots-clés : 1 316 valeurs distinctes pour 1 818 couples,
    // un findOrCreate par cellule ferait des milliers d'allers-retours inutiles.
    const motsCles = new Map<string, number>();
    for (const m of await MotCle.findAll({ transaction })) {
      motsCles.set(m.libelle.toLowerCase(), m.id);
    }

    const vus = new Map<string, number>();

    for (const [index, ligne] of lignes.slice(1).entries()) {
      const numeroLigne = index + 2;
      const codeMetier = texte(ligne[COL_METIER]);
      if (!codeMetier) continue;

      if (!metiersConnus.has(codeMetier)) {
        rejets.push({ ligne: numeroLigne, code: codeMetier, motif: 'Métier absent en base' });
        continue;
      }

      // Même règle que l'import des métiers : première ligne gagne. Sans ça, les couples
      // de la ligne 315 (doublon D314) viendraient s'ajouter à ceux du métier de la
      // ligne 314, qui se retrouverait avec les activités de deux métiers distincts.
      const premiere = vus.get(codeMetier);
      if (premiere !== undefined) {
        rejets.push({
          ligne: numeroLigne,
          code: codeMetier,
          motif: `Couples ignorés: code déjà traité ligne ${premiere}`,
        });
        continue;
      }
      vus.set(codeMetier, numeroLigne);

      // Purge avant réécriture : les suppressions faites dans le classeur doivent se
      // répercuter. La cascade emporte détails, niveaux et mots-clés.
      await MetierActivite.destroy({ where: { codeMetier }, transaction });

      const dossierId = dossiers.get(texte(ligne[COL_DOSSIER]) ?? '') ?? null;

      for (const bloc of lireBlocs(ligne)) {
        await enregistrerCouple(
          bloc,
          codeMetier,
          dossierId,
          motsCles,
          formacodesConnus,
          nsfConnus,
          famillesConnues,
          domainesIgnores,
          transaction,
        );
        couples += 1;
        connaissances += bloc.connaissances.length;
      }
    }

    const rapport =
      rejets.length || domainesIgnores.length ? { rejets, domainesIgnores } : null;

    await batch.update(
      {
        lignesOk: couples,
        lignesErreur: rejets.length,
        rapport,
        statut: 'termine',
        termineLe: new Date(),
      },
      { transaction },
    );
    await transaction.commit();

    console.log(`   ${couples} couples, ${connaissances} domaines de connaissance`);
    for (const r of rejets) console.log(`   ⚠️  ligne ${r.ligne} (${r.code}) : ${r.motif}`);
    if (domainesIgnores.length) {
      console.log(`   ⚠️  ${domainesIgnores.length} domaine(s) en double ignoré(s)`);
    }
  } catch (err) {
    await transaction.rollback();
    await batch.update({ statut: 'echec', termineLe: new Date() });
    throw err;
  }
}

async function enregistrerCouple(
  bloc: Bloc,
  codeMetier: string,
  dossierId: number | null,
  motsCles: Map<string, number>,
  formacodesConnus: Set<string>,
  nsfConnus: Set<string>,
  famillesConnues: Set<string>,
  ignores: Array<{ couple: number; formacode: string; motif: string }>,
  transaction: Transaction,
): Promise<void> {
  // Le catalogue ne porte que le code : le libellé qui fait foi est celui du couple,
  // car 121 codes sont rédigés différemment selon le métier (migration 006).
  await Activite.findOrCreate({
    where: { codeActivite: bloc.codeActivite },
    defaults: {
      codeActivite: bloc.codeActivite,
      codeFamilleActivite: deriverCodeFamille(bloc.codeActivite, famillesConnues),
      intituleActivite: bloc.intituleActivite,
      intituleCompetence: bloc.intituleCompetence,
      dossierSourceId: dossierId,
    },
    transaction,
  });

  // Les couples du métier ont été purgés juste avant : une création suffit.
  const couple = await MetierActivite.create(
    {
      codeMetier,
      codeActivite: bloc.codeActivite,
      ordre: bloc.ordre,
      intituleActivite: bloc.intituleActivite,
      intituleCompetence: bloc.intituleCompetence,
    },
    { transaction },
  );

  if (bloc.detailsActivite.length) {
    await ActiviteDetail.bulkCreate(
      bloc.detailsActivite.map((libelle, i) => ({
        metierActiviteId: couple.id,
        libelle,
        ordre: i + 1,
      })),
      { transaction },
    );
  }

  if (bloc.detailsCompetence.length) {
    await CompetenceDetail.bulkCreate(
      bloc.detailsCompetence.map((libelle, i) => ({
        metierActiviteId: couple.id,
        libelle,
        ordre: i + 1,
      })),
      { transaction },
    );
  }

  if (bloc.niveaux.length) {
    await NiveauMaitrise.bulkCreate(
      bloc.niveaux.map((description, i) => ({
        metierActiviteId: couple.id,
        niveau: i + 1,
        description,
      })),
      { transaction },
    );
  }

  await enregistrerMotsCles(bloc, couple.id, motsCles, transaction);
  await enregistrerConnaissances(bloc, couple.id, formacodesConnus, nsfConnus, ignores, transaction);
}

/**
 * Domaines de connaissance du couple. Les formacodes et NSF inconnus sont créés à la
 * volée : la contrainte de clé étrangère l'exige, et 10 des codes cités par les fiches
 * ne figurent dans aucun des deux référentiels.
 */
async function enregistrerConnaissances(
  bloc: Bloc,
  coupleId: number,
  formacodesConnus: Set<string>,
  nsfConnus: Set<string>,
  ignores: Array<{ couple: number; formacode: string; motif: string }>,
  transaction: Transaction,
): Promise<void> {
  const vus = new Set<string>();

  for (const conn of bloc.connaissances) {
    // uk_couple_conn (couple, formacode) : la source répète parfois un domaine
    // dans le même groupe de 5.
    if (vus.has(conn.codeFormacode)) {
      ignores.push({
        couple: coupleId,
        formacode: conn.codeFormacode,
        motif: 'Domaine cité deux fois sur le même couple',
      });
      continue;
    }
    vus.add(conn.codeFormacode);

    if (!formacodesConnus.has(conn.codeFormacode)) {
      await Formacode.findOrCreate({
        where: { codeFormacode: conn.codeFormacode },
        // Le libellé de la collecte est en capitales : c'est un repli, les référentiels
        // fournissent une version proprement casée quand ils connaissent le code.
        defaults: {
          codeFormacode: conn.codeFormacode,
          intitule: conn.intitule ?? conn.codeFormacode,
          codeNsf: null,
          estFondamental: false,
        },
        transaction,
      });
      formacodesConnus.add(conn.codeFormacode);
    }

    if (conn.codeNsf && !nsfConnus.has(conn.codeNsf)) {
      await Nsf.findOrCreate({
        where: { codeNsf: conn.codeNsf },
        defaults: { codeNsf: conn.codeNsf, libelle: null },
        transaction,
      });
      nsfConnus.add(conn.codeNsf);
    }

    await ActiviteConnaissance.create(
      {
        metierActiviteId: coupleId,
        codeFormacode: conn.codeFormacode,
        intitule: conn.intitule,
        niveau: conn.niveau,
        dureeHeures: conn.dureeHeures,
        justificationDuree: conn.justificationDuree,
        codeNsf: conn.codeNsf,
        estFondamental: false,
        ordre: conn.ordre,
      },
      { transaction },
    );
  }
}

async function enregistrerMotsCles(
  bloc: Bloc,
  coupleId: number,
  motsCles: Map<string, number>,
  transaction: Transaction,
): Promise<void> {
  const liens: Array<{ metierActiviteId: number; motCleId: number; ordre: number }> = [];
  const vus = new Set<number>();

  for (const [i, libelle] of bloc.motsCles.entries()) {
    const cle = libelle.toLowerCase();
    let id = motsCles.get(cle);

    if (id === undefined) {
      const [motCle] = await MotCle.findOrCreate({
        where: { libelle },
        defaults: { libelle },
        transaction,
      });
      id = motCle.id;
      motsCles.set(cle, id);
    }

    // Un même mot-clé peut être saisi deux fois sur un couple : la clé primaire
    // (couple, mot_clé) l'interdit.
    if (vus.has(id)) continue;
    vus.add(id);
    liens.push({ metierActiviteId: coupleId, motCleId: id, ordre: i + 1 });
  }

  if (liens.length) await ActiviteMotCle.bulkCreate(liens, { transaction });
}
