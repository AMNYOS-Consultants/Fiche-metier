import path from 'node:path';
import { Transaction } from 'sequelize';
import { env } from '../../config/env';
import {
  sequelize,
  Metier,
  MetierAppellation,
  MetierRome,
  MetierCondition,
  MetierTransversale,
  MetierAcces,
  DossierSource,
  ImportBatch,
  Rome,
} from '../../models';
import { lireFeuilleBrute, texte, nombre, dateFr } from './xlsxReader';

/**
 * Index des colonnes de `Outil_collecte_fiche_metier` (439 colonnes, base 0).
 * Source unique des fiches métier : `data_METIERS` n'est jamais lue — docs/SCHEMA.md §1 bis.
 */
const COL = {
  nObs: 0,
  dossier: 1,
  dossierAutre: 2,
  intitule: 3,
  definition: 4,
  appellations: [5, 14] as const, // APPELL_METIER_1..10
  rome: [15, 17] as const, // ROME_1..3
  conditions: [18, 32] as const, // COND_1..15
  acces: [33, 39] as const, // ACCES_METIER_1..7
  /** Le code est en 40. La colonne 41 s'appelle aussi « CODE_METIER » mais porte la famille. */
  codeMetier: 40,
  responsTransverse: 42,
  interfaceAmontAval: 43,
  redacteur: 44,
  nbCouple: 45,
  transversales: [226, 242] as const, // TRANSV_1..17
  remarque: 423,
  cle: 425,
  dateSaisie: 426,
  dateEnregistrement: 427,
  dateModification: 428,
  tempsSaisie: 429,
  origineSaisie: 430,
  langueSaisie: 431,
  appareilSaisie: 432,
} as const;

interface Rejet {
  ligne: number;
  code: string | null;
  intitule: string | null;
  motif: string;
}

export async function importerMetiers(): Promise<void> {
  const fichier = path.resolve(__dirname, '../../..', env.xlsx.competences);
  const lignes = lireFeuilleBrute(fichier, 'Outil_collecte_fiche_metier');

  const batch = await ImportBatch.create({
    fichier: path.basename(fichier),
    feuille: 'Outil_collecte_fiche_metier',
    version: 'V3.3',
    lignesLues: lignes.length - 1,
    rapport: null,
    termineLe: null,
  });

  const dossiers = new Map(
    (await DossierSource.findAll()).map((d) => [d.libelle, d.id] as const),
  );

  const rejets: Rejet[] = [];
  const vus = new Map<string, number>();
  let ok = 0;

  const transaction = await sequelize.transaction();
  try {
    for (const [index, ligne] of lignes.slice(1).entries()) {
      const numeroLigne = index + 2; // +1 en-tête, +1 base 1
      const code = texte(ligne[COL.codeMetier]);
      const intitule = texte(ligne[COL.intitule]);

      if (!code) continue; // lignes vides en fin de feuille
      if (!intitule) {
        rejets.push({ ligne: numeroLigne, code, intitule: null, motif: 'INT_METIER absent' });
        continue;
      }

      // `D314` désigne deux métiers distincts (lignes 314 et 315). Rien dans cette feuille
      // ne permet de trancher et `data_METIERS`, qui le pouvait, est écartée par décision.
      // On refuse la seconde plutôt que d'écraser la première : la perte est visible.
      const premiere = vus.get(code);
      if (premiere !== undefined) {
        rejets.push({
          ligne: numeroLigne,
          code,
          intitule,
          motif: `Code déjà utilisé ligne ${premiere} — à corriger dans le classeur`,
        });
        continue;
      }
      vus.set(code, numeroLigne);

      await importerLigne(ligne, code, intitule, dossiers, transaction);
      ok += 1;
    }

    await batch.update(
      {
        lignesOk: ok,
        lignesErreur: rejets.length,
        rapport: rejets.length > 0 ? { rejets } : null,
        statut: 'termine',
        termineLe: new Date(),
      },
      { transaction },
    );
    await transaction.commit();

    console.log(`   ${ok} métiers importés, ${rejets.length} rejetés`);
    for (const r of rejets) {
      console.log(`   ⚠️  ligne ${r.ligne} (${r.code}) : ${r.motif}`);
    }
  } catch (err) {
    await transaction.rollback();
    await batch.update({ statut: 'echec', termineLe: new Date() });
    throw err;
  }
}

async function importerLigne(
  ligne: unknown[],
  codeMetier: string,
  intitule: string,
  dossiers: Map<string, number>,
  transaction: Transaction,
): Promise<void> {
  const libelleDossier = texte(ligne[COL.dossier]);

  await Metier.upsert(
    {
      codeMetier,
      nObs: nombre(ligne[COL.nObs]),
      // Casse de saisie conservée telle quelle — décision, docs/SCHEMA.md §1 bis.
      intitule,
      definition: texte(ligne[COL.definition]),
      // La famille vient du code métier ; son libellé est importé par referentiels.importer.
      codeFamille: codeMetier.match(/^[A-Z]/)?.[0] ?? null,
      dossierSourceId: libelleDossier ? (dossiers.get(libelleDossier) ?? null) : null,
      dossierAutre: texte(ligne[COL.dossierAutre]),
      responsTransverse: ouiNon(ligne[COL.responsTransverse]),
      interfaceAmontAval: texte(ligne[COL.interfaceAmontAval]),
      redacteur: texte(ligne[COL.redacteur]),
      nbCouple: nombre(ligne[COL.nbCouple]),
      remarque: texte(ligne[COL.remarque]),
      cleCollecte: texte(ligne[COL.cle]),
      dateSaisie: dateFr(ligne[COL.dateSaisie]),
      dateEnregistrement: dateFr(ligne[COL.dateEnregistrement]),
      dateModification: dateFr(ligne[COL.dateModification]),
      tempsSaisie: nombre(ligne[COL.tempsSaisie]),
      origineSaisie: texte(ligne[COL.origineSaisie]),
      langueSaisie: texte(ligne[COL.langueSaisie]),
      appareilSaisie: texte(ligne[COL.appareilSaisie]),
    },
    { transaction },
  );

  // Les tables de liaison sont vidées avant réécriture : sans ça, un ré-import après
  // suppression d'une appellation dans le classeur laisserait l'ancienne en base.
  await Promise.all([
    MetierAppellation.destroy({ where: { codeMetier }, transaction }),
    MetierRome.destroy({ where: { codeMetier }, transaction }),
    MetierCondition.destroy({ where: { codeMetier }, transaction }),
    MetierTransversale.destroy({ where: { codeMetier }, transaction }),
    MetierAcces.destroy({ where: { codeMetier }, transaction }),
  ]);

  await importerAppellations(ligne, codeMetier, transaction);
  await importerRome(ligne, codeMetier, transaction);
  await importerConditions(ligne, codeMetier, transaction);
  await importerTransversales(ligne, codeMetier, transaction);
  await importerAcces(ligne, codeMetier, transaction);
}

/**
 * RESPONS_TRANSV mélange deux vocabulaires dans la source : « Oui »/« Non » et
 * « Significatif »/« Non significatif ». La correspondance est sans ambiguïté ; on
 * normalise plutôt que d'élargir l'ENUM, sinon le champ devient infiltrable.
 */
function ouiNon(valeur: unknown): 'oui' | 'non' | null {
  const v = texte(valeur)?.toLowerCase();
  if (!v) return null;
  if (v === 'oui' || v === 'significatif') return 'oui';
  if (v === 'non' || v === 'non significatif') return 'non';
  return null;
}

async function importerAppellations(
  ligne: unknown[],
  codeMetier: string,
  transaction: Transaction,
): Promise<void> {
  const [debut, fin] = COL.appellations;
  const lignes = [];
  for (let i = debut; i <= fin; i++) {
    const appellation = texte(ligne[i]);
    if (appellation) lignes.push({ codeMetier, appellation, ordre: i - debut + 1 });
  }
  if (lignes.length) await MetierAppellation.bulkCreate(lignes, { transaction });
}

/**
 * Codes ROME saisis tronqués dans `Outil_collecte_fiche_metier`, corrigés au vu du
 * référentiel officiel (`docs/rome-arborescence-principale-juin-2026.xlsx`, importé par
 * `rome.importer.ts`) plutôt qu'en base à la main — sans quoi la correction ne survivait
 * pas à un réimport complet (constaté : elle avait été appliquée par un `UPDATE` ponctuel,
 * absente de tout import frais, y compris en CI).
 */
const CODES_ROME_CORRIGES: Record<string, string> = {
  I130: 'I1304',
};

/**
 * Découpe une cellule ROME en code et libellé.
 *
 * Formes rencontrées : « A1413 », « H2102 – Conduite d'équipement… », mais aussi
 * « D 1213 » et « D 1407 » (espace parasite) et « I130 » (quatre caractères, corrigé via
 * `CODES_ROME_CORRIGES`). Les codes hors norme non répertoriés sont conservés tels
 * quels plutôt qu'écartés — ils désignent de vraies fiches, mal saisies.
 */
function analyserRome(brut: string): { code: string; libelle: string | null } {
  const sansEspace = brut.replace(/^([A-Z])\s+(\d)/, '$1$2').trim();
  const avecLibelle = sansEspace.match(/^([A-Z]\d{4})\s*[–\-—]\s*(.+)$/);

  if (avecLibelle) {
    const code = avecLibelle[1];
    return { code: CODES_ROME_CORRIGES[code] ?? code, libelle: avecLibelle[2].trim() };
  }
  const code = sansEspace.match(/^[A-Z]\d{4}/)?.[0] ?? sansEspace.slice(0, 10);
  return { code: CODES_ROME_CORRIGES[code] ?? code, libelle: null };
}

async function importerRome(
  ligne: unknown[],
  codeMetier: string,
  transaction: Transaction,
): Promise<void> {
  const [debut, fin] = COL.rome;
  const vus = new Set<string>();
  const lignes = [];

  for (let i = debut; i <= fin; i++) {
    const brut = texte(ligne[i]);
    if (!brut) continue;

    const { code, libelle } = analyserRome(brut);
    if (vus.has(code)) continue; // uk_metier_rome (code_metier, code_rome)
    vus.add(code);

    // Le référentiel est alimenté au fil de l'eau : la clé étrangère l'exige, et seuls
    // 27 codes sur 136 portent un libellé. `update` n'écrase pas un libellé déjà connu
    // par un `null` venu d'une autre fiche.
    const [rome] = await Rome.findOrCreate({
      where: { codeRome: code },
      defaults: { codeRome: code, libelle },
      transaction,
    });
    if (libelle && !rome.libelle) {
      await rome.update({ libelle }, { transaction });
    }

    lignes.push({ codeMetier, codeRome: code, ordre: i - debut + 1 });
  }

  if (lignes.length) await MetierRome.bulkCreate(lignes, { transaction });
}

async function importerConditions(
  ligne: unknown[],
  codeMetier: string,
  transaction: Transaction,
): Promise<void> {
  const [debut, fin] = COL.conditions;
  const lignes = [];
  for (let i = debut; i <= fin; i++) {
    const v = texte(ligne[i])?.toLowerCase();
    if (!v) continue;
    lignes.push({
      codeMetier,
      codeCondition: `COND_${i - debut + 1}`,
      valeur: (v === 'significatif' ? 'significatif' : 'non_significatif') as
        | 'significatif'
        | 'non_significatif',
    });
  }
  if (lignes.length) await MetierCondition.bulkCreate(lignes, { transaction });
}

async function importerTransversales(
  ligne: unknown[],
  codeMetier: string,
  transaction: Transaction,
): Promise<void> {
  const [debut, fin] = COL.transversales;
  const lignes = [];
  for (let i = debut; i <= fin; i++) {
    const v = texte(ligne[i]);
    if (!v) continue;
    // « Non Concerné » n'est pas une donnée manquante : on le distingue explicitement.
    const niveau = v.match(/(\d+)/);
    lignes.push({
      codeMetier,
      codeTransversale: `TRANSV_${i - debut + 1}`,
      niveau: niveau ? Number(niveau[1]) : null,
      nonConcerne: !niveau,
    });
  }
  if (lignes.length) await MetierTransversale.bulkCreate(lignes, { transaction });
}

async function importerAcces(
  ligne: unknown[],
  codeMetier: string,
  transaction: Transaction,
): Promise<void> {
  const [debut, fin] = COL.acces;
  const lignes = [];
  for (let i = debut; i <= fin; i++) {
    const valeur = texte(ligne[i]);
    if (valeur) lignes.push({ codeMetier, codeAcces: `ACCES_${i - debut + 1}`, valeur });
  }
  if (lignes.length) await MetierAcces.bulkCreate(lignes, { transaction });
}
