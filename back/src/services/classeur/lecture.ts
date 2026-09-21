import { QueryTypes } from 'sequelize';
import { sequelize } from '../../database/connection';
import { TABLES } from './schema';

/**
 * Lecture de la base vers les lignes du classeur : une requête par table, chaque colonne
 * aliasée sur le nom de champ du schéma.
 *
 * Le SQL est écrit à la main plutôt que dérivé du schéma, parce que les colonnes
 * *informatives* viennent de jointures qui diffèrent d'une table à l'autre et qu'un
 * générateur les rendrait illisibles. En contrepartie, un test compare les clés renvoyées
 * par chaque requête à la liste des champs du schéma : une colonne ajoutée d'un seul côté
 * fait échouer la suite.
 *
 * Une requête par table, et non un `findAll` à includes multiples : plusieurs `hasMany`
 * inclus ensemble produiraient un produit cartésien (un métier avec 5 couples et 12
 * ressources transverses donnerait 60 lignes dupliquées).
 *
 * Conventions de valeurs, communes à tout le classeur :
 * - les booléens sortent en 0/1 (`tinyint(1)` non converti par une requête brute) ;
 * - les décimaux sortent en chaîne (`DECIMAL` sérialisé par mysql2, pour ne pas perdre de
 *   précision) ;
 * - **les dates sortent en chaîne, formatées par SQL** et jamais converties en objet
 *   `Date`. C'est indispensable à l'aller-retour : mysql2 *lit* un DATETIME comme s'il
 *   était en UTC mais *réécrit* une `Date` en heure locale du serveur Node, si bien qu'un
 *   export puis import décalait chaque horodatage de l'écart de fuseau. Ces colonnes
 *   portent d'ailleurs des heures murales (date de saisie d'une fiche), pas des instants :
 *   leur attacher un fuseau serait de toute façon une invention.
 */

/** `2026-09-21T10:20:45` — ISO 8601 sans fuseau, comme la valeur stockée. */
const FORMAT_DATE = '%Y-%m-%dT%H:%i:%s';

export type LigneClasseur = Record<string, unknown>;
export type ContenuClasseur = Record<string, LigneClasseur[]>;

/** Les tables exclues du classeur, et la raison de leur exclusion. */
export const HORS_CLASSEUR: Record<string, string> = {
  metier_proximite: 'table calculée, reconstruite par db:recalc-proximites',
  metier_connaissance_ecart: 'table calculée, reconstruite par db:recalc-proximites',
  schema_migrations: 'infrastructure, propre à une instance',
  import_batch: 'journal des imports, propre à une instance',
  mot_cle: 'reconstituée depuis les libellés de la feuille « Mots-clés »',
};

const REQUETES: Record<string, string> = {
  famillesMetier: `SELECT code_famille AS codeFamille, intitule, definition
                     FROM famille_metier ORDER BY code_famille`,

  famillesActivite: `SELECT code_famille_activite AS codeFamilleActivite, domaine_1 AS domaine1,
                            domaine_2 AS domaine2, domaine_3 AS domaine3,
                            exemple_competence AS exempleCompetence
                       FROM famille_activite ORDER BY code_famille_activite`,

  dossiersSource: `SELECT id, libelle, opco, annee FROM dossier_source ORDER BY id`,

  nsf: `SELECT code_nsf AS codeNsf, libelle FROM nsf ORDER BY code_nsf`,

  rome: `SELECT code_rome AS codeRome, libelle FROM rome ORDER BY code_rome`,

  criteresCondition: `SELECT code_condition AS codeCondition, ordre, libelle
                        FROM critere_condition ORDER BY ordre`,

  criteresAcces: `SELECT code_acces AS codeAcces, ordre, libelle, groupe
                    FROM critere_acces ORDER BY ordre`,

  competencesTransversales: `SELECT code_transversale AS codeTransversale, ordre, libelle, groupe,
                                    palier_1 AS palier1, palier_2 AS palier2,
                                    palier_3 AS palier3, palier_4 AS palier4
                               FROM competence_transversale ORDER BY ordre`,

  formacodes: `SELECT f.code_formacode AS codeFormacode, f.intitule, f.code_nsf AS codeNsf,
                      n.libelle AS nsfLibelle, f.est_fondamental AS estFondamental,
                      DATE_FORMAT(f.created_at, :fmt) AS creeLe, DATE_FORMAT(f.updated_at, :fmt) AS modifieLe
                 FROM formacode f
                 LEFT JOIN nsf n ON n.code_nsf = f.code_nsf
                ORDER BY f.code_formacode`,

  formacodeNiveaux: `SELECT code_formacode AS codeFormacode, niveau, origine,
                            est_niveau_unique AS estNiveauUnique, duree_heures AS dureeHeures,
                            duree_semaines AS dureeSemaines, duree_mois AS dureeMois,
                            methode_calcul AS methodeCalcul, source,
                            DATE_FORMAT(created_at, :fmt) AS creeLe, DATE_FORMAT(updated_at, :fmt) AS modifieLe
                       FROM formacode_niveau ORDER BY code_formacode, niveau, origine`,

  activites: `SELECT a.code_activite AS codeActivite,
                     a.code_famille_activite AS codeFamilleActivite,
                     a.intitule_activite AS intituleActivite,
                     a.intitule_competence AS intituleCompetence,
                     a.dossier_source_id AS dossierSourceId, ds.libelle AS dossierSourceLibelle,
                     DATE_FORMAT(a.created_at, :fmt) AS creeLe, DATE_FORMAT(a.updated_at, :fmt) AS modifieLe
                FROM activite a
                LEFT JOIN dossier_source ds ON ds.id = a.dossier_source_id
               ORDER BY a.code_activite`,

  metiers: `SELECT m.code_metier AS codeMetier, m.n_obs AS nObs, m.intitule, m.definition,
                   m.code_famille AS codeFamille, fm.intitule AS familleIntitule,
                   m.dossier_source_id AS dossierSourceId, ds.libelle AS dossierSourceLibelle,
                   m.dossier_autre AS dossierAutre, m.respons_transverse AS responsTransverse,
                   m.interface_amont_aval AS interfaceAmontAval, m.redacteur, m.remarque,
                   m.nb_couple AS nbCouple, m.cle_collecte AS cleCollecte,
                   DATE_FORMAT(m.date_saisie, :fmt) AS dateSaisie, DATE_FORMAT(m.date_enregistrement, :fmt) AS dateEnregistrement,
                   DATE_FORMAT(m.date_modification, :fmt) AS dateModification, m.temps_saisie AS tempsSaisie,
                   m.origine_saisie AS origineSaisie, m.langue_saisie AS langueSaisie,
                   m.appareil_saisie AS appareilSaisie,
                   DATE_FORMAT(m.proximite_perimee_le, :fmt) AS proximitePerimeeLe,
                   DATE_FORMAT(m.created_at, :fmt) AS creeLe, DATE_FORMAT(m.updated_at, :fmt) AS modifieLe
              FROM metier m
              LEFT JOIN famille_metier fm ON fm.code_famille = m.code_famille
              LEFT JOIN dossier_source ds ON ds.id = m.dossier_source_id
             ORDER BY m.code_metier`,

  appellations: `SELECT code_metier AS codeMetier, ordre, appellation
                   FROM metier_appellation ORDER BY code_metier, ordre`,

  codesRome: `SELECT mr.code_metier AS codeMetier, mr.ordre, mr.code_rome AS codeRome,
                     r.libelle AS romeLibelle
                FROM metier_rome mr
                LEFT JOIN rome r ON r.code_rome = mr.code_rome
               ORDER BY mr.code_metier, mr.ordre`,

  transversales: `SELECT mt.code_metier AS codeMetier, mt.code_transversale AS codeTransversale,
                         ct.libelle AS transversaleLibelle, ct.groupe, mt.niveau,
                         mt.non_concerne AS nonConcerne
                    FROM metier_transversale mt
                    LEFT JOIN competence_transversale ct
                           ON ct.code_transversale = mt.code_transversale
                   ORDER BY mt.code_metier, ct.ordre`,

  conditions: `SELECT mc.code_metier AS codeMetier, mc.code_condition AS codeCondition,
                      cc.libelle AS conditionLibelle, mc.valeur
                 FROM metier_condition mc
                 LEFT JOIN critere_condition cc ON cc.code_condition = mc.code_condition
                ORDER BY mc.code_metier, cc.ordre`,

  acces: `SELECT ma.code_metier AS codeMetier, ma.code_acces AS codeAcces,
                 ca.libelle AS accesLibelle, ca.groupe, ma.valeur
            FROM metier_acces ma
            LEFT JOIN critere_acces ca ON ca.code_acces = ma.code_acces
           ORDER BY ma.code_metier, ca.ordre`,

  couples: `SELECT id AS coupleId, code_metier AS codeMetier, ordre,
                   code_activite AS codeActivite,
                   intitule_activite AS intituleActivite,
                   intitule_competence AS intituleCompetence,
                   DATE_FORMAT(created_at, :fmt) AS creeLe, DATE_FORMAT(updated_at, :fmt) AS modifieLe
              FROM metier_activite ORDER BY code_metier, ordre`,

  activiteDetails: `SELECT ad.metier_activite_id AS coupleId, ma.code_metier AS codeMetier,
                           ma.ordre AS ordreCouple, ma.code_activite AS codeActivite,
                           ad.ordre, ad.libelle
                      FROM activite_detail ad
                      JOIN metier_activite ma ON ma.id = ad.metier_activite_id
                     ORDER BY ma.code_metier, ma.ordre, ad.ordre`,

  competenceDetails: `SELECT cd.metier_activite_id AS coupleId, ma.code_metier AS codeMetier,
                             ma.ordre AS ordreCouple, ma.code_activite AS codeActivite,
                             cd.ordre, cd.libelle
                        FROM competence_detail cd
                        JOIN metier_activite ma ON ma.id = cd.metier_activite_id
                       ORDER BY ma.code_metier, ma.ordre, cd.ordre`,

  niveauxMaitrise: `SELECT nm.metier_activite_id AS coupleId, ma.code_metier AS codeMetier,
                           ma.ordre AS ordreCouple, ma.code_activite AS codeActivite,
                           nm.niveau, nm.description
                      FROM niveau_maitrise nm
                      JOIN metier_activite ma ON ma.id = nm.metier_activite_id
                     ORDER BY ma.code_metier, ma.ordre, nm.niveau`,

  motsClesCouple: `SELECT amc.metier_activite_id AS coupleId, ma.code_metier AS codeMetier,
                          ma.ordre AS ordreCouple, ma.code_activite AS codeActivite,
                          amc.ordre, mc.libelle AS motCle
                     FROM activite_mot_cle amc
                     JOIN metier_activite ma ON ma.id = amc.metier_activite_id
                     JOIN mot_cle mc ON mc.id = amc.mot_cle_id
                    ORDER BY ma.code_metier, ma.ordre, amc.ordre`,

  connaissances: `SELECT ac.metier_activite_id AS coupleId, ma.code_metier AS codeMetier,
                         ma.ordre AS ordreCouple, ma.code_activite AS codeActivite,
                         ac.ordre, ac.code_formacode AS codeFormacode, ac.intitule,
                         ac.niveau, ac.duree_heures AS dureeHeures,
                         ac.justification_duree AS justificationDuree,
                         ac.code_nsf AS codeNsf, ac.est_fondamental AS estFondamental,
                         DATE_FORMAT(ac.created_at, :fmt) AS creeLe, DATE_FORMAT(ac.updated_at, :fmt) AS modifieLe
                    FROM activite_connaissance ac
                    JOIN metier_activite ma ON ma.id = ac.metier_activite_id
                   ORDER BY ma.code_metier, ma.ordre, ac.ordre`,
};

/** La requête de lecture d'une table du classeur — exposée pour le test de conformité. */
export function requete(cle: string): string {
  const sql = REQUETES[cle];
  if (!sql) throw new Error(`Aucune requête de lecture pour « ${cle} »`);
  return sql;
}

/** Lit une seule table du classeur. */
export async function lireTable(cle: string): Promise<LigneClasseur[]> {
  return sequelize.query<LigneClasseur>(requete(cle), {
    replacements: { fmt: FORMAT_DATE },
    type: QueryTypes.SELECT,
  });
}

/** Lit la base entière, dans l'ordre des tables du schéma. */
export async function lireBase(): Promise<ContenuClasseur> {
  const lues = await Promise.all(TABLES.map((t) => lireTable(t.cle)));
  return Object.fromEntries(TABLES.map((t, i) => [t.cle, lues[i]]));
}

/** La dernière migration appliquée : l'import s'en sert pour se situer. */
export async function versionSchema(): Promise<string | null> {
  // Les migrations sont préfixées d'un numéro sur trois chiffres (`012-…`) : l'ordre
  // lexical est donc l'ordre chronologique.
  const ligne = await sequelize.query<{ derniere: string | null }>(
    `SELECT MAX(nom) AS derniere FROM schema_migrations`,
    { type: QueryTypes.SELECT, plain: true },
  );
  return ligne?.derniere ?? null;
}
