import { QueryTypes, Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { Metier, MetierProximite } from '../models';

// ---------- Fraîcheur de la table matérialisée ----------
//
// `metier_proximite` n'est jamais recalculée toute seule. Trois choses la périment :
// les formacodes portés par les couples de la fiche, `respons_transverse`, et les
// niveaux des ressources transverses TRANSV_2 / 8 / 10 (voir `CODES_TRANSVERSE_BONUS`)
// — plus `interface_amont_aval`. Chaque écriture sur l'un d'eux date la fiche via
// `marquerProximitePerimee()`, et le front compare cette date au dernier calcul.

/** Date la fiche comme modifiée sur un point qui entre dans le calcul des passerelles. */
export async function marquerProximitePerimee(
  codeMetier: string,
  transaction?: Transaction,
): Promise<void> {
  await Metier.update(
    { proximitePerimeeLe: new Date() },
    // `silent` : `updated_at` ne doit pas bouger pour un marqueur interne.
    { where: { codeMetier }, transaction, silent: true },
  );
}

/** `perimee` : la fiche a changé depuis le dernier `recalculerProximites()`. */
export async function etatProximites(
  codeMetier: string,
): Promise<{ calculeLe: Date | null; modifieeLe: Date | null; perimee: boolean }> {
  const [etat] = await sequelize.query<{ calculeLe: Date | null; modifieeLe: Date | null }>(
    `SELECT (SELECT MAX(calcule_le) FROM metier_proximite) AS calculeLe,
            m.proximite_perimee_le                         AS modifieeLe
       FROM metier m
      WHERE m.code_metier = :codeMetier`,
    { replacements: { codeMetier }, type: QueryTypes.SELECT },
  );

  const calculeLe = etat?.calculeLe ? new Date(etat.calculeLe) : null;
  const modifieeLe = etat?.modifieeLe ? new Date(etat.modifieeLe) : null;

  return {
    calculeLe,
    modifieeLe,
    // Jamais calculé mais déjà modifié compte aussi comme périmé.
    perimee: modifieeLe !== null && (calculeLe === null || modifieeLe > calculeLe),
  };
}

export interface ParametresProximite {
  /** « Nombre d'heures max d'acquisition » (défaut 10 000 dans le classeur). */
  heuresMax: number;
  /** « Nombre min de domaines de connaissance commun » (défaut 1). */
  dcMin: number;
  /**
   * « Minimum degré d'élargissement » (défaut 0,1 dans le classeur). Exclut de fait les
   * régressions (-1) : un métier qui demande MOINS de formation que la source n'est pas un
   * élargissement, quelle que soit sa proximité en heures ou en domaines communs.
   */
  degreMin: number;
  /** « Nombre max de métiers à afficher » (défaut 15). */
  limite: number;
}

export interface MetierProche {
  codeMetier: string;
  intitule: string;
  codeFamille: string | null;
  dureeAcquisitionHeures: number | null;
  degreElargissement: number | null;
  nbDcCommuns: number | null;
}

/**
 * Lit la table matérialisée `metier_proximite`.
 * L'index (code_metier_source, duree_acquisition_heures) permet de servir le tri sans filesort.
 */
export async function trouverMetiersProches(
  codeMetier: string,
  { heuresMax, dcMin, degreMin, limite }: ParametresProximite,
): Promise<MetierProche[]> {
  return sequelize.query<MetierProche>(
    `SELECT m.code_metier            AS codeMetier,
            m.intitule               AS intitule,
            m.code_famille           AS codeFamille,
            p.duree_acquisition_heures AS dureeAcquisitionHeures,
            p.degre_elargissement    AS degreElargissement,
            p.nb_dc_communs          AS nbDcCommuns
       FROM metier_proximite p
       JOIN metier m ON m.code_metier = p.code_metier_cible
      WHERE p.code_metier_source = :codeMetier
        AND p.code_metier_cible <> :codeMetier
        AND (p.duree_acquisition_heures IS NULL OR p.duree_acquisition_heures <= :heuresMax)
        AND (p.nb_dc_communs IS NULL OR p.nb_dc_communs >= :dcMin)
        -- Pas de repli « OR IS NULL » ici : un degré NULL (niveau de formation non déductible
        -- pour l'un des deux métiers) ne peut pas être confirmé comme un élargissement.
        AND p.degre_elargissement >= :degreMin
      ORDER BY p.duree_acquisition_heures ASC, p.degre_elargissement ASC
      LIMIT :limite`,
    {
      replacements: { codeMetier, heuresMax, dcMin, degreMin, limite },
      type: QueryTypes.SELECT,
    },
  );
}

export interface EcartConnaissance {
  codeFormacode: string;
  intitule: string;
  niveauSource: number | null;
  niveauCible: number | null;
  /** > 0 : à acquérir. <= 0 : déjà maîtrisé au niveau requis. */
  heuresAcquerir: number | null;
}

/**
 * Écart détaillé entre deux métiers, calculé à la volée depuis les domaines de connaissance
 * de leurs activités respectives (pas depuis la table matérialisée : on veut le détail).
 */
export async function comparerMetiers(
  codeSource: string,
  codeCible: string,
): Promise<{ ecarts: EcartConnaissance[]; totalHeures: number; nbDcCommuns: number }> {
  const ecarts = await sequelize.query<EcartConnaissance>(
    // Les connaissances pendent du couple (migration 008) : la jointure se fait sur son
    // identifiant. Le MAX retient le niveau le plus élevé quand un formacode revient sur
    // plusieurs couples du même métier.
    //
    // `formacode_niveau` porte jusqu'à 3 lignes par (formacode, niveau) — une par origine
    // (base_formacodes / base_competences / outil_fiche_metier, voir migration 011). Une
    // jointure directe sur (formacode, niveau) sans filtrer l'origine multiplie les lignes
    // du résultat par autant d'origines présentes ; `duree_prioritaire` n'en retient qu'une,
    // avec la même priorité que `chargerDureesParFormacodeNiveau()` plus bas dans ce fichier.
    `WITH duree_prioritaire AS (
        SELECT code_formacode, niveau, duree_heures,
               ROW_NUMBER() OVER (
                 PARTITION BY code_formacode, niveau
                 ORDER BY CASE origine
                            WHEN 'outil_fiche_metier' THEN 3
                            WHEN 'base_formacodes' THEN 2
                            WHEN 'base_competences' THEN 1
                            ELSE 0
                          END DESC
               ) AS rang
          FROM formacode_niveau
     ),
     dc_source AS (
        SELECT ac.code_formacode, MAX(ac.niveau) AS niveau
          FROM metier_activite ma
          JOIN activite_connaissance ac ON ac.metier_activite_id = ma.id
         WHERE ma.code_metier = :codeSource
         GROUP BY ac.code_formacode
     ),
     dc_cible AS (
        SELECT ac.code_formacode, MAX(ac.niveau) AS niveau
          FROM metier_activite ma
          JOIN activite_connaissance ac ON ac.metier_activite_id = ma.id
         WHERE ma.code_metier = :codeCible
         GROUP BY ac.code_formacode
     )
     SELECT c.code_formacode AS codeFormacode,
            f.intitule       AS intitule,
            s.niveau         AS niveauSource,
            c.niveau         AS niveauCible,
            CASE
              WHEN s.niveau IS NOT NULL AND s.niveau >= c.niveau THEN 0
              ELSE COALESCE(fn_cible.duree_heures, 0) - COALESCE(fn_source.duree_heures, 0)
            END AS heuresAcquerir
       FROM dc_cible c
       JOIN formacode f ON f.code_formacode = c.code_formacode
       LEFT JOIN dc_source s ON s.code_formacode = c.code_formacode
       LEFT JOIN duree_prioritaire fn_cible
              ON fn_cible.code_formacode = c.code_formacode
             AND fn_cible.niveau = c.niveau
             AND fn_cible.rang = 1
       LEFT JOIN duree_prioritaire fn_source
              ON fn_source.code_formacode = c.code_formacode
             AND fn_source.niveau = s.niveau
             AND fn_source.rang = 1
      ORDER BY heuresAcquerir DESC`,
    { replacements: { codeSource, codeCible }, type: QueryTypes.SELECT },
  );

  const totalHeures = ecarts.reduce((somme, e) => somme + Number(e.heuresAcquerir ?? 0), 0);
  const nbDcCommuns = ecarts.filter((e) => e.niveauSource !== null).length;

  return { ecarts, totalHeures, nbDcCommuns };
}

// ---------- Degré d'élargissement ----------
//
// Formule reconstituée depuis `Outil_passerelles_062026.xlsx` (feuilles DE_niv_form →
// DE_respon_transv → DE_ress_transv → Degré élargissement, qui s'empilent). La comparaison
// est ORIENTÉE : `source` est le métier de départ, `cible` le métier visé — passer de A à B
// ne coûte pas la même chose que de B à A (d'où le couple (source, cible) en clé primaire de
// `metier_proximite`, déjà pensé pour ça).
//
// 1. Base sur l'écart de NIVEAU_FORMATION (cible - source) :
//      écart < 0        -> -1 (régression : la cible demande moins de formation, pas de bonus)
//      écart = 0        ->  0
//      0 < écart <= 1   ->  1
//      écart > 1        ->  2
// 2. Si la base n'est pas -1, trois bonus s'additionnent (source -> cible) :
//      responsabilité transversale : non significatif -> significatif       = +0,5
//      chacune des ressources transverses 2, 8, 10 : niveau cible > source  = +1/6
//      interface amont/aval : Non -> Oui (OU ou ET)                        = +0,5
//                              Non -> Oui (ET)                              = +1
//                              Oui (OU) -> Oui (ET)                        = +0,5
//
// NIVEAU_FORMATION n'existe pas en base (colonne `moyenne_niv_formation` supprimée en
// migration 003, faute de source fiable). Décision prise avec le métier : le dériver du
// niveau de diplôme attendu (`metier_acces` ACCES_3/ACCES_4, ex. "Niv.4"), en moyennant la
// borne basse et la borne haute quand les deux sont renseignées.

export const CODE_ACCES_NIVEAU_BASSE = 'ACCES_3';
export const CODE_ACCES_NIVEAU_HAUTE = 'ACCES_4';
/** Niveaux RNCP portés par ACCES_3/ACCES_4 — seules valeurs observées sur les 333 métiers. */
export const NIVEAUX_RNCP = ['Niv.3', 'Niv.4', 'Niv.5', 'Niv.6', 'Niv.7', 'Niv.8'] as const;
/** Les seules ressources transverses qui pèsent dans le degré d'élargissement. */
export const CODES_TRANSVERSE_BONUS = ['TRANSV_2', 'TRANSV_8', 'TRANSV_10'] as const;

const RANG_INTERFACE: Record<string, number> = {
  Non: 0,
  'Oui, en amont OU aval': 1,
  'Oui, en amont ET aval': 2,
};

interface DonneesMetier {
  codeMetier: string;
  niveauFormation: number | null;
  responsTransverse: 'oui' | 'non' | null;
  rangInterface: number | null;
  rangTransverse: Record<string, number>;
  /** codeFormacode -> niveau requis (le plus élevé si le formacode revient sur plusieurs couples). */
  domainesConnaissance: Map<string, number>;
}

function parserNiveauDiplome(valeur: string | undefined): number | null {
  const m = valeur?.match(/Niv\.(\d+(?:[.,]\d+)?)/i);
  return m ? Number(m[1].replace(',', '.')) : null;
}

/** Degré de base + bonus, orienté source -> cible. `null` si le niveau de formation manque. */
function calculerDegreElargissement(source: DonneesMetier, cible: DonneesMetier): number | null {
  if (source.niveauFormation === null || cible.niveauFormation === null) return null;

  const ecart = cible.niveauFormation - source.niveauFormation;
  const base = ecart < 0 ? -1 : ecart > 1 ? 2 : ecart > 0 ? 1 : 0;
  if (base === -1) return -1;

  let bonus = 0;

  if (source.responsTransverse === 'non' && cible.responsTransverse === 'oui') bonus += 0.5;

  for (const code of CODES_TRANSVERSE_BONUS) {
    if (cible.rangTransverse[code] > source.rangTransverse[code]) bonus += 1 / 6;
  }

  if (source.rangInterface !== null && cible.rangInterface !== null) {
    const ecartInterface = cible.rangInterface - source.rangInterface;
    if (ecartInterface > 0) bonus += ecartInterface === 2 ? 1 : 0.5;
  }

  return base + bonus;
}

/**
 * Nombre de domaines de connaissance communs et heures manquantes, orienté source -> cible.
 * Même sémantique que `comparerMetiers()` ci-dessus (source retenue si son niveau suffit déjà,
 * sinon écart de durée à combler), mais tenue en mémoire pour éviter 333² allers-retours SQL.
 */
function calculerEcartConnaissances(
  source: DonneesMetier,
  cible: DonneesMetier,
  dureeParFormacodeNiveau: Map<string, number>,
): { nbDcCommuns: number; dureeAcquisitionHeures: number } {
  let nbDcCommuns = 0;
  let dureeAcquisitionHeures = 0;

  for (const [codeFormacode, niveauCible] of cible.domainesConnaissance) {
    const niveauSource = source.domainesConnaissance.get(codeFormacode) ?? null;
    if (niveauSource !== null) {
      nbDcCommuns++;
      if (niveauSource >= niveauCible) continue;
    }
    const dureeCible = dureeParFormacodeNiveau.get(`${codeFormacode}|${niveauCible}`) ?? 0;
    const dureeSource =
      niveauSource !== null ? (dureeParFormacodeNiveau.get(`${codeFormacode}|${niveauSource}`) ?? 0) : 0;
    dureeAcquisitionHeures += dureeCible - dureeSource;
  }

  return { nbDcCommuns, dureeAcquisitionHeures };
}

async function chargerDonneesMetiers(): Promise<Map<string, DonneesMetier>> {
  const metiers = await Metier.findAll({ attributes: ['codeMetier', 'responsTransverse'] });

  const acces = await sequelize.query<{ codeMetier: string; codeAcces: string; valeur: string }>(
    `SELECT code_metier AS codeMetier, code_acces AS codeAcces, valeur
       FROM metier_acces
      WHERE code_acces IN (:basse, :haute)`,
    {
      replacements: { basse: CODE_ACCES_NIVEAU_BASSE, haute: CODE_ACCES_NIVEAU_HAUTE },
      type: QueryTypes.SELECT,
    },
  );
  const accesParMetier = new Map<string, { basse?: string; haute?: string }>();
  for (const a of acces) {
    const entree = accesParMetier.get(a.codeMetier) ?? {};
    if (a.codeAcces === CODE_ACCES_NIVEAU_BASSE) entree.basse = a.valeur;
    else entree.haute = a.valeur;
    accesParMetier.set(a.codeMetier, entree);
  }

  const interfaces = await sequelize.query<{ codeMetier: string; interfaceAmontAval: string | null }>(
    `SELECT code_metier AS codeMetier, interface_amont_aval AS interfaceAmontAval FROM metier`,
    { type: QueryTypes.SELECT },
  );
  const interfaceParMetier = new Map(interfaces.map((i) => [i.codeMetier, i.interfaceAmontAval]));

  const transversales = await sequelize.query<{
    codeMetier: string;
    codeTransversale: string;
    niveau: number | null;
    nonConcerne: boolean;
  }>(
    `SELECT code_metier AS codeMetier, code_transversale AS codeTransversale, niveau, non_concerne AS nonConcerne
       FROM metier_transversale
      WHERE code_transversale IN (:codes)`,
    { replacements: { codes: CODES_TRANSVERSE_BONUS }, type: QueryTypes.SELECT },
  );
  const transverseParMetier = new Map<string, Record<string, number>>();
  for (const t of transversales) {
    const entree = transverseParMetier.get(t.codeMetier) ?? {};
    entree[t.codeTransversale] = t.nonConcerne ? 0 : (t.niveau ?? 0);
    transverseParMetier.set(t.codeMetier, entree);
  }

  const niveauxConnaissance = await sequelize.query<{
    codeMetier: string;
    codeFormacode: string;
    niveau: number;
  }>(
    `SELECT ma.code_metier AS codeMetier, ac.code_formacode AS codeFormacode, MAX(ac.niveau) AS niveau
       FROM metier_activite ma
       JOIN activite_connaissance ac ON ac.metier_activite_id = ma.id
      WHERE ac.niveau IS NOT NULL
      GROUP BY ma.code_metier, ac.code_formacode`,
    { type: QueryTypes.SELECT },
  );
  const domainesParMetier = new Map<string, Map<string, number>>();
  for (const n of niveauxConnaissance) {
    if (!domainesParMetier.has(n.codeMetier)) domainesParMetier.set(n.codeMetier, new Map());
    domainesParMetier.get(n.codeMetier)!.set(n.codeFormacode, n.niveau);
  }

  const donnees = new Map<string, DonneesMetier>();
  for (const m of metiers) {
    const a = accesParMetier.get(m.codeMetier);
    const niveauBasse = parserNiveauDiplome(a?.basse);
    const niveauHaute = parserNiveauDiplome(a?.haute);
    const niveauFormation =
      niveauBasse !== null && niveauHaute !== null
        ? (niveauBasse + niveauHaute) / 2
        : (niveauBasse ?? niveauHaute);

    const interfaceMetier = interfaceParMetier.get(m.codeMetier) ?? null;
    const rangTransverse = transverseParMetier.get(m.codeMetier) ?? {};

    donnees.set(m.codeMetier, {
      codeMetier: m.codeMetier,
      niveauFormation,
      responsTransverse: m.responsTransverse,
      rangInterface: interfaceMetier !== null ? (RANG_INTERFACE[interfaceMetier] ?? null) : null,
      rangTransverse: Object.fromEntries(CODES_TRANSVERSE_BONUS.map((c) => [c, rangTransverse[c] ?? 0])),
      domainesConnaissance: domainesParMetier.get(m.codeMetier) ?? new Map(),
    });
  }
  return donnees;
}

/**
 * Priorité décroissante entre les trois origines possibles d'une durée, en cas de doublon
 * sur un même (formacode, niveau) : une saisie manuelle dans l'outil (`outil_fiche_metier`)
 * prime sur les deux imports en bloc, et `base_formacodes` prime sur `base_competences`
 * (même critère que l'import, voir formacodes.importer.ts) ; sans ça un XLOOKUP côté
 * classeur n'aurait de toute façon retenu qu'une seule valeur.
 */
const PRIORITE_ORIGINE: Record<string, number> = {
  outil_fiche_metier: 3,
  base_formacodes: 2,
  base_competences: 1,
};

/** `code_formacode|niveau` -> durée en heures. Une seule origine retenue en cas de doublon. */
async function chargerDureesParFormacodeNiveau(): Promise<Map<string, number>> {
  const rows = await sequelize.query<{
    codeFormacode: string;
    niveau: number;
    dureeHeures: number | null;
    origine: string;
  }>(
    `SELECT code_formacode AS codeFormacode, niveau, duree_heures AS dureeHeures, origine
       FROM formacode_niveau`,
    { type: QueryTypes.SELECT },
  );

  const duree = new Map<string, number>();
  const priorite = new Map<string, number>();
  for (const r of rows) {
    const cle = `${r.codeFormacode}|${r.niveau}`;
    const rang = PRIORITE_ORIGINE[r.origine] ?? 0;
    if ((priorite.get(cle) ?? -1) >= rang) continue;
    priorite.set(cle, rang);
    duree.set(cle, Number(r.dureeHeures ?? 0));
  }
  return duree;
}

/**
 * Recalcule intégralement `metier_proximite` (333² ≈ 110 000 lignes, hors diagonale).
 * Tout est chargé en mémoire puis calculé en JS : à cette volumétrie, c'est très largement
 * plus rapide que 110 000 allers-retours SQL, et le calcul par paire est trivial (O(1) à O(k)
 * avec k = nombre de domaines de connaissance du métier cible, quelques dizaines au plus).
 */
export async function recalculerProximites(): Promise<{ lignes: number }> {
  const [donneesParMetier, dureeParFormacodeNiveau] = await Promise.all([
    chargerDonneesMetiers(),
    chargerDureesParFormacodeNiveau(),
  ]);
  const metiers = [...donneesParMetier.values()];
  const maintenant = new Date();

  const lignes: Array<{
    codeMetierSource: string;
    codeMetierCible: string;
    degreElargissement: number | null;
    dureeAcquisitionHeures: number;
    nbDcCommuns: number;
    calculeLe: Date;
  }> = [];

  for (const source of metiers) {
    for (const cible of metiers) {
      if (source.codeMetier === cible.codeMetier) continue;
      const { nbDcCommuns, dureeAcquisitionHeures } = calculerEcartConnaissances(
        source,
        cible,
        dureeParFormacodeNiveau,
      );
      lignes.push({
        codeMetierSource: source.codeMetier,
        codeMetierCible: cible.codeMetier,
        degreElargissement: calculerDegreElargissement(source, cible),
        dureeAcquisitionHeures,
        nbDcCommuns,
        calculeLe: maintenant,
      });
    }
  }

  const TAILLE_LOT = 2000;
  await sequelize.transaction(async (transaction) => {
    // Pas de TRUNCATE : sur MySQL/MariaDB il commit implicitement et casserait
    // l'atomicité de la transaction (un DELETE échoué laisserait la table vidée).
    await MetierProximite.destroy({ where: {}, transaction });
    for (let i = 0; i < lignes.length; i += TAILLE_LOT) {
      await MetierProximite.bulkCreate(lignes.slice(i, i + TAILLE_LOT), { transaction });
    }
  });

  return { lignes: lignes.length };
}
