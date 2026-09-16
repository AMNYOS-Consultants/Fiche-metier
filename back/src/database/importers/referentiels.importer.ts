import path from 'node:path';
import { Transaction } from 'sequelize';
import { env } from '../../config/env';
import {
  sequelize,
  DossierSource,
  FamilleMetier,
  FamilleActivite,
  CritereCondition,
  CompetenceTransversale,
  CritereAcces,
  ImportBatch,
} from '../../models';
import { lireFeuilleBrute, texte } from './xlsxReader';

/** Colonnes de `Outil_collecte_fiche_metier` utilisées ici (index 0). */
const COL = { dossier: 1, famille: 41 } as const;

/**
 * Les 7 conditions d'accès ne sont nomenclaturées nulle part : `nomencl_ACCES` n'est pas
 * une nomenclature mais une zone de travail pour le métier D19. Les libellés ci-dessous
 * sont les questions du formulaire, relevées dans le gabarit `fiche métier` (lignes 46 à 58).
 */
const CERTIFICATION = 'Certification professionnelle';
const EXPERIENCE = 'Expérience professionnelle';

/** Question du niveau attendu : ACCES_3 en porte la borne basse, ACCES_4 la borne haute. */
const QUESTION_NIVEAU =
  'Quel est le niveau ou l’intervalle de niveaux de qualification professionnelle attendu ?';

const CRITERES_ACCES: Array<{ code: string; libelle: string; groupe: string }> = [
  {
    code: 'ACCES_1',
    groupe: CERTIFICATION,
    libelle:
      'Ce métier est-il accessible pour des personnes sans qualification ou certification professionnelle particulière ?',
  },
  {
    code: 'ACCES_2',
    groupe: CERTIFICATION,
    libelle:
      'Quel est le domaine professionnel visé par la formation certifiante / qualifiante souhaitée ou exigée ?',
  },
  { code: 'ACCES_3', groupe: CERTIFICATION, libelle: QUESTION_NIVEAU },
  { code: 'ACCES_4', groupe: CERTIFICATION, libelle: QUESTION_NIVEAU },
  {
    code: 'ACCES_5',
    groupe: EXPERIENCE,
    libelle: 'Ce métier est-il généralement accessible sans aucune expérience professionnelle ?',
  },
  {
    code: 'ACCES_6',
    groupe: EXPERIENCE,
    libelle:
      'Quel est le domaine professionnel visé par l’expérience professionnelle souhaitée ou indispensable ?',
  },
  {
    code: 'ACCES_7',
    groupe: EXPERIENCE,
    libelle: 'Autre précision sur les conditions d’accès au métier',
  },
];

export async function importerReferentiels(): Promise<void> {
  const fichier = path.resolve(__dirname, '../../..', env.xlsx.competences);

  const collecte = lireFeuilleBrute(fichier, 'Outil_collecte_fiche_metier');
  const cond = lireFeuilleBrute(fichier, 'nomencl_COND');
  const transv = lireFeuilleBrute(fichier, 'nomencl_TRANSV');
  const famActivites = lireFeuilleBrute(fichier, 'nomencl_FAMACTIVITES');

  const batch = await ImportBatch.create({
    fichier: path.basename(fichier),
    feuille: 'Outil_collecte_fiche_metier + nomencl_COND + nomencl_TRANSV',
    version: 'V3.3',
    lignesLues: collecte.length - 1,
    rapport: null,
    termineLe: null,
  });

  const transaction = await sequelize.transaction();
  try {
    const bilan = {
      dossiersSource: await importerDossiers(collecte, transaction),
      famillesMetier: await importerFamilles(collecte, transaction),
      famillesActivite: await importerFamillesActivite(famActivites, transaction),
      conditions: await importerConditions(cond, transaction),
      transversales: await importerTransversales(transv, transaction),
      acces: await importerAcces(transaction),
    };

    const total = Object.values(bilan).reduce((s, n) => s + n, 0);
    await batch.update(
      { lignesOk: total, rapport: bilan, statut: 'termine', termineLe: new Date() },
      { transaction },
    );
    await transaction.commit();

    for (const [nom, n] of Object.entries(bilan)) {
      console.log(`   ${String(n).padStart(4)}  ${nom}`);
    }
  } catch (err) {
    await transaction.rollback();
    await batch.update({ statut: 'echec', termineLe: new Date() });
    throw err;
  }
}

/** Les 7 dossiers sources, déduits des valeurs distinctes de la colonne DOSSIER. */
async function importerDossiers(lignes: unknown[][], transaction: Transaction): Promise<number> {
  const libelles = new Set<string>();
  for (const ligne of lignes.slice(1)) {
    const v = texte(ligne[COL.dossier]);
    if (v) libelles.add(v);
  }

  for (const libelle of libelles) {
    // Le préfixe avant « _ » est l'OPCO : « OCAPIAT_cartographie… » -> « OCAPIAT ».
    const opco = libelle.includes('_') ? libelle.split('_')[0] : null;
    await DossierSource.findOrCreate({
      where: { libelle },
      defaults: { libelle, opco, annee: null },
      transaction,
    });
  }
  return libelles.size;
}

/**
 * Le libellé complet de la famille est porté par la colonne 41 du formulaire, sous la
 * forme « D - Production de biens industriels ». C'est la seule source de ces libellés :
 * `data_METIERS` ne contient que la lettre, déductible du code métier.
 */
async function importerFamilles(lignes: unknown[][], transaction: Transaction): Promise<number> {
  const familles = new Map<string, string>();
  for (const ligne of lignes.slice(1)) {
    const v = texte(ligne[COL.famille]);
    if (!v) continue;
    const m = v.match(/^([A-Z])\s*-\s*(.+)$/);
    if (m) familles.set(m[1], m[2].trim());
  }

  for (const [codeFamille, intitule] of familles) {
    await FamilleMetier.upsert({ codeFamille, intitule, definition: null }, { transaction });
  }
  return familles.size;
}

/**
 * nomencl_FAMACTIVITES s'arrête à D.08, mais des activités réelles utilisent D.09 et D.10
 * (23 couples en base). Reprises du fichier de 2021 « Base couples activités compétences
 * après MAJ nomenclature » (colonnes INT_DOM_1/2/3_ACT), qui reste cohérent sur ces deux
 * familles une fois écartée une erreur de saisie du classeur (deux couples D.09.07.01 et
 * D.09.08.01 y sont classés à tort sous « D.10 » — leur propre code les rattache à D.09,
 * conforme aux 13 autres couples D.09). Ce fichier n'a pas de colonne « exemple de
 * compétence », d'où `exempleCompetence: null` pour ces deux familles.
 */
const FAMILLES_MANQUANTES: ReadonlyArray<{
  codeFamilleActivite: string;
  domaine1: string;
  domaine2: string;
  domaine3: string;
}> = [
  {
    codeFamilleActivite: 'D.09',
    domaine1: 'Production ',
    domaine2: 'Production végétale et animale',
    domaine3: 'exploitation, entretien, récolte, tri, conditionnement des cultures et élevages',
  },
  {
    codeFamilleActivite: 'D.10',
    domaine1: 'Production ',
    domaine2: 'Production alimentaire et culinaire',
    domaine3: 'Confection de plats, valorisation des produits',
  },
];

/**
 * nomencl_FAMACTIVITES : 37 familles d'activités (« A.01 », « B.02 »…), en-tête ligne 1,
 * données à partir de la ligne 2 — code en A, les trois niveaux de domaine en B/C/D,
 * l'exemple de compétence contextualisée en E. Colonnes F/G (numéro + lettre) ne sont que
 * des aides de tri, ignorées ici.
 *
 * C'est la seule source de ces libellés : `data_ACT_COMP_CONN` (couples.importer.ts) les
 * répète sur chaque couple, mais avec des variantes de saisie (207 des 1546 lignes
 * divergent de la famille qu'elles citent) — cette feuille fait foi. `FAMILLES_MANQUANTES`
 * comble les deux familles qu'elle ne couvre pas.
 */
export async function importerFamillesActivite(
  lignes: unknown[][],
  transaction: Transaction,
): Promise<number> {
  let n = 0;
  for (const ligne of lignes.slice(1)) {
    const code = texte(ligne[0]);
    if (!code || !/^[A-Z]\.\d{2}$/.test(code)) continue;

    await FamilleActivite.upsert(
      {
        codeFamilleActivite: code,
        domaine1: texte(ligne[1]),
        domaine2: texte(ligne[2]),
        domaine3: texte(ligne[3]),
        exempleCompetence: texte(ligne[4]),
      },
      { transaction },
    );
    n += 1;
  }

  for (const famille of FAMILLES_MANQUANTES) {
    await FamilleActivite.upsert(
      { ...famille, exempleCompetence: null },
      { transaction },
    );
    n += 1;
  }
  return n;
}

/** nomencl_COND : code en colonne 0, libellé en colonne 1, à partir de la ligne 3. */
async function importerConditions(lignes: unknown[][], transaction: Transaction): Promise<number> {
  let n = 0;
  for (const ligne of lignes) {
    const code = texte(ligne[0]);
    const libelle = texte(ligne[1]);
    if (!code || !libelle || !/^COND_\d+$/.test(code)) continue;

    await CritereCondition.upsert(
      { codeCondition: code, libelle, ordre: Number(code.split('_')[1]) },
      { transaction },
    );
    n += 1;
  }
  return n;
}

/**
 * nomencl_TRANSV : la feuille n'a pas de colonne de code. Les 17 compétences sont
 * entrecoupées de lignes de regroupement (« Ressources cognitives », « Ressources
 * personnelles »…) qu'on distingue par leur colonne `num_colonne` vide.
 * `num_colonne` vaut 32 pour TRANSV_1 : l'ordre s'en déduit.
 *
 * Ces lignes de séparation ne sont plus ignorées : elles donnent le groupe des
 * compétences qui les suivent, tel qu'affiché sur la fiche métier.
 */
async function importerTransversales(
  lignes: unknown[][],
  transaction: Transaction,
): Promise<number> {
  const DECALAGE = 31; // num_colonne 32 -> TRANSV_1
  let groupe: string | null = null;
  let n = 0;

  for (const ligne of lignes) {
    const libelle = texte(ligne[1]);
    if (!libelle) continue;

    const numColonne = Number(texte(ligne[8]));
    const estCompetence = Number.isInteger(numColonne) && numColonne > DECALAGE;

    if (!estCompetence) {
      // Ligne de regroupement. Le `s+` couvre la coquille « Resssources » de la source.
      if (/^ress+ources/i.test(libelle)) groupe = corrigerCoquille(libelle);
      continue;
    }

    const ordre = numColonne - DECALAGE;
    await CompetenceTransversale.upsert(
      {
        codeTransversale: `TRANSV_${ordre}`,
        libelle,
        groupe,
        palier1: texte(ligne[2]),
        palier2: texte(ligne[3]),
        palier3: texte(ligne[4]),
        palier4: texte(ligne[5]),
        ordre,
      },
      { transaction },
    );
    n += 1;
  }
  return n;
}

/**
 * `nomencl_TRANSV` orthographie un des quatre groupes « Resssources sociales et
 * relationnelles », avec trois `s`. Correction ciblée : on ramène uniquement ce mot à
 * son orthographe correcte, sans toucher au reste du libellé.
 *
 * Seule exception à la règle « on conserve la saisie brute » (docs/SCHEMA.md §1 bis) :
 * il s'agit d'un intitulé d'affichage, pas d'une donnée métier.
 */
function corrigerCoquille(libelle: string): string {
  return libelle.replace(/\bRess{2,}ources\b/gi, (m) =>
    m[0] === m[0].toUpperCase() ? 'Ressources' : 'ressources',
  );
}

async function importerAcces(transaction: Transaction): Promise<number> {
  for (const [i, critere] of CRITERES_ACCES.entries()) {
    await CritereAcces.upsert(
      { codeAcces: critere.code, libelle: critere.libelle, groupe: critere.groupe, ordre: i + 1 },
      { transaction },
    );
  }
  return CRITERES_ACCES.length;
}
