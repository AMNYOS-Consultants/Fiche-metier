/**
 * Le schéma du classeur d'échange : **une seule définition**, lue par l'export qui écrit
 * le fichier et par l'import qui le relit.
 *
 * C'est le point important de ce module. Tant que la génération du classeur vivait côté
 * front et sa lecture côté back, deux listes de colonnes coexistaient : la moindre
 * divergence (un en-tête renommé, une colonne ajoutée d'un seul côté) cassait l'aller-retour
 * en silence, sans qu'aucun test ne puisse l'attraper. Ici, une colonne ajoutée est
 * immédiatement exportée *et* importée.
 *
 * Trois notions structurent chaque table :
 *
 * - `identite` — les champs qui disent « c'est la même ligne ». L'import synchronise sur
 *   cette identité : présente des deux côtés et différente, la ligne est mise à jour ;
 *   absente de la base, elle est créée ; absente du fichier, elle est supprimée. Toutes
 *   les identités retenues ici ont été vérifiées uniques en base.
 * - `informative` — une colonne écrite pour la lecture humaine mais **jamais réinjectée**
 *   (le libellé d'une famille, celui d'un code ROME, les colonnes de rappel du couple sur
 *   les feuilles filles). Sans ce marquage, l'import tenterait d'écrire un libellé joint
 *   dans une table qui ne le porte pas.
 * - `references` — les clés étrangères, exprimées entre tables du classeur. Elles servent
 *   à deux choses : valider l'intégrité *du fichier* avant d'écrire quoi que ce soit (après
 *   synchronisation la base est l'image du fichier, donc une référence qui ne se résout pas
 *   dans le fichier ne se résoudra pas non plus en base), et déduire l'ordre d'écriture.
 */

export type TypeColonne = 'texte' | 'entier' | 'decimal' | 'booleen' | 'date' | 'enum';

export interface ColonneClasseur {
  /** En-tête écrit en ligne 1, et cherché à la relecture. */
  entete: string;
  /** Nom du champ dans les lignes manipulées par le code. */
  champ: string;
  largeur: number;
  type: TypeColonne;
  /**
   * Colonne SQL, quand `snake(champ)` ne la donne pas : les horodatages (`created_at`),
   * et `coupleId` qui est `id` sur `metier_activite` mais `metier_activite_id` sur ses
   * filles. Un test vérifie que toutes les colonnes résolues existent réellement en base,
   * de sorte qu'un oubli d'exception ne passe pas inaperçu.
   */
  sql?: string;
  /** Valeurs admises, pour `type: 'enum'`. */
  valeurs?: readonly string[];
  /** Écrite pour la lecture humaine, ignorée à l'import (libellé joint, rappel de clé). */
  informative?: true;
  /** Refuse une cellule vide à l'import. */
  obligatoire?: true;
  /**
   * Le champ n'est pas une colonne : il se résout à l'écriture. Seul `motCle`, qui
   * désigne une ligne de `mot_cle` par son libellé et non par son id auto-incrémenté.
   */
  resolue?: true;
}

/**
 * `codeMetier` → `code_metier`, `nObs` → `n_obs`, `domaine1` → `domaine_1`. Le découpage
 * porte aussi sur les chiffres, sans quoi `palier1` donnerait `palier1`.
 */
export function snake(champ: string): string {
  return champ
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([a-zA-Z])(\d)/g, '$1_$2')
    .toLowerCase();
}

/** Colonne SQL d'un champ. */
export function colonneSql(c: ColonneClasseur): string {
  return c.sql ?? snake(c.champ);
}

export interface ReferenceClasseur {
  champ: string;
  /** `cle` de la table visée. */
  vers: string;
  champCible: string;
}

export interface TableClasseur {
  /** Clé de la table dans les rapports et les charges JSON. */
  cle: string;
  feuille: string;
  /** Table SQL correspondante. */
  table: string;
  /** Champs formant l'identité de synchronisation (tous vérifiés uniques en base). */
  identite: string[];
  colonnes: ColonneClasseur[];
  references?: ReferenceClasseur[];
}

const OUI_NON = ['oui', 'non'] as const;
const SIGNIFICATIF = ['significatif', 'non_significatif'] as const;
const ORIGINES = ['base_formacodes', 'base_competences', 'outil_fiche_metier'] as const;

/** Les quatre colonnes de rappel que portent les feuilles filles d'un couple. */
function rappelDuCouple(): ColonneClasseur[] {
  return [
    { entete: 'Couple (id)', champ: 'coupleId', largeur: 12, type: 'entier', sql: 'metier_activite_id', obligatoire: true },
    { entete: 'Code métier', champ: 'codeMetier', largeur: 12, type: 'texte', informative: true },
    { entete: 'Ordre couple', champ: 'ordreCouple', largeur: 12, type: 'entier', informative: true },
    { entete: 'Code activité', champ: 'codeActivite', largeur: 14, type: 'texte', informative: true },
  ];
}

/** Les deux horodatages, identiques partout où ils existent. */
function horodatage(): ColonneClasseur[] {
  return [
    { entete: 'Créé le', champ: 'creeLe', largeur: 22, type: 'date', sql: 'created_at' },
    { entete: 'Modifié le', champ: 'modifieLe', largeur: 22, type: 'date', sql: 'updated_at' },
  ];
}

export const TABLES: readonly TableClasseur[] = [
  // ---------- Référentiels sans dépendance ----------
  {
    cle: 'famillesMetier',
    feuille: 'Réf - Familles métier',
    table: 'famille_metier',
    identite: ['codeFamille'],
    colonnes: [
      { entete: 'Code famille', champ: 'codeFamille', largeur: 12, type: 'texte', obligatoire: true },
      { entete: 'Intitulé', champ: 'intitule', largeur: 40, type: 'texte', obligatoire: true },
      { entete: 'Définition', champ: 'definition', largeur: 70, type: 'texte' },
    ],
  },
  {
    cle: 'famillesActivite',
    feuille: 'Réf - Familles activité',
    table: 'famille_activite',
    identite: ['codeFamilleActivite'],
    colonnes: [
      { entete: 'Code famille activité', champ: 'codeFamilleActivite', largeur: 18, type: 'texte', obligatoire: true },
      { entete: 'Domaine 1', champ: 'domaine1', largeur: 35, type: 'texte' },
      { entete: 'Domaine 2', champ: 'domaine2', largeur: 35, type: 'texte' },
      { entete: 'Domaine 3', champ: 'domaine3', largeur: 50, type: 'texte' },
      { entete: 'Exemple de compétence', champ: 'exempleCompetence', largeur: 60, type: 'texte' },
    ],
  },
  {
    cle: 'dossiersSource',
    feuille: 'Réf - Dossiers source',
    table: 'dossier_source',
    // `id` est auto-incrémenté, mais c'est lui que portent metier et activite : une ligne
    // ajoutée à la main doit donc en fournir un, sans quoi rien ne pourrait s'y rattacher.
    identite: ['id'],
    colonnes: [
      { entete: 'Id', champ: 'id', largeur: 8, type: 'entier', obligatoire: true },
      { entete: 'Libellé', champ: 'libelle', largeur: 45, type: 'texte', obligatoire: true },
      { entete: 'OPCO', champ: 'opco', largeur: 16, type: 'texte' },
      { entete: 'Année', champ: 'annee', largeur: 10, type: 'entier' },
    ],
  },
  {
    cle: 'nsf',
    feuille: 'Réf - NSF',
    table: 'nsf',
    identite: ['codeNsf'],
    colonnes: [
      { entete: 'Code NSF', champ: 'codeNsf', largeur: 10, type: 'texte', obligatoire: true },
      { entete: 'Libellé', champ: 'libelle', largeur: 55, type: 'texte' },
    ],
  },
  {
    cle: 'rome',
    feuille: 'Réf - ROME',
    table: 'rome',
    identite: ['codeRome'],
    colonnes: [
      { entete: 'Code ROME', champ: 'codeRome', largeur: 12, type: 'texte', obligatoire: true },
      { entete: 'Libellé', champ: 'libelle', largeur: 60, type: 'texte' },
    ],
  },
  {
    cle: 'criteresCondition',
    feuille: 'Réf - Critères condition',
    table: 'critere_condition',
    identite: ['codeCondition'],
    colonnes: [
      { entete: 'Code condition', champ: 'codeCondition', largeur: 14, type: 'texte', obligatoire: true },
      { entete: 'Ordre', champ: 'ordre', largeur: 8, type: 'entier', obligatoire: true },
      { entete: 'Libellé', champ: 'libelle', largeur: 50, type: 'texte', obligatoire: true },
    ],
  },
  {
    cle: 'criteresAcces',
    feuille: 'Réf - Critères accès',
    table: 'critere_acces',
    identite: ['codeAcces'],
    colonnes: [
      { entete: 'Code accès', champ: 'codeAcces', largeur: 12, type: 'texte', obligatoire: true },
      { entete: 'Ordre', champ: 'ordre', largeur: 8, type: 'entier', obligatoire: true },
      { entete: 'Libellé', champ: 'libelle', largeur: 55, type: 'texte', obligatoire: true },
      { entete: 'Groupe', champ: 'groupe', largeur: 25, type: 'texte' },
    ],
  },
  {
    cle: 'competencesTransversales',
    feuille: 'Réf - Transversales',
    table: 'competence_transversale',
    identite: ['codeTransversale'],
    colonnes: [
      { entete: 'Code transversale', champ: 'codeTransversale', largeur: 16, type: 'texte', obligatoire: true },
      { entete: 'Ordre', champ: 'ordre', largeur: 8, type: 'entier', obligatoire: true },
      { entete: 'Libellé', champ: 'libelle', largeur: 40, type: 'texte', obligatoire: true },
      { entete: 'Groupe', champ: 'groupe', largeur: 25, type: 'texte' },
      { entete: 'Palier 1', champ: 'palier1', largeur: 60, type: 'texte' },
      { entete: 'Palier 2', champ: 'palier2', largeur: 60, type: 'texte' },
      { entete: 'Palier 3', champ: 'palier3', largeur: 60, type: 'texte' },
      { entete: 'Palier 4', champ: 'palier4', largeur: 60, type: 'texte' },
    ],
  },

  // ---------- Référentiels dépendants ----------
  {
    cle: 'formacodes',
    feuille: 'Réf - Formacodes',
    table: 'formacode',
    identite: ['codeFormacode'],
    references: [{ champ: 'codeNsf', vers: 'nsf', champCible: 'codeNsf' }],
    colonnes: [
      { entete: 'Formacode', champ: 'codeFormacode', largeur: 11, type: 'texte', obligatoire: true },
      { entete: 'Intitulé', champ: 'intitule', largeur: 45, type: 'texte', obligatoire: true },
      { entete: 'Code NSF', champ: 'codeNsf', largeur: 10, type: 'texte' },
      { entete: 'NSF (libellé)', champ: 'nsfLibelle', largeur: 40, type: 'texte', informative: true },
      { entete: 'Fondamental (0/1)', champ: 'estFondamental', largeur: 16, type: 'booleen' },
      ...horodatage(),
    ],
  },
  {
    cle: 'formacodeNiveaux',
    feuille: 'Réf - Durées formacode',
    table: 'formacode_niveau',
    // `origine` fait partie de l'identité : jusqu'à trois durées concurrentes coexistent
    // pour un même (formacode, niveau), et les confondre fausserait les passerelles.
    identite: ['codeFormacode', 'niveau', 'origine'],
    references: [{ champ: 'codeFormacode', vers: 'formacodes', champCible: 'codeFormacode' }],
    colonnes: [
      { entete: 'Formacode', champ: 'codeFormacode', largeur: 11, type: 'texte', obligatoire: true },
      { entete: 'Niveau', champ: 'niveau', largeur: 8, type: 'entier', obligatoire: true },
      { entete: 'Origine', champ: 'origine', largeur: 20, type: 'enum', valeurs: ORIGINES, obligatoire: true },
      { entete: 'Niveau unique (0/1)', champ: 'estNiveauUnique', largeur: 17, type: 'booleen' },
      { entete: 'Durée (h)', champ: 'dureeHeures', largeur: 11, type: 'decimal' },
      { entete: 'Durée (semaines)', champ: 'dureeSemaines', largeur: 15, type: 'decimal' },
      { entete: 'Durée (mois)', champ: 'dureeMois', largeur: 13, type: 'decimal' },
      { entete: 'Méthode de calcul', champ: 'methodeCalcul', largeur: 70, type: 'texte' },
      { entete: 'Source', champ: 'source', largeur: 70, type: 'texte' },
      ...horodatage(),
    ],
  },
  {
    cle: 'activites',
    feuille: 'Réf - Activités',
    table: 'activite',
    identite: ['codeActivite'],
    references: [
      { champ: 'codeFamilleActivite', vers: 'famillesActivite', champCible: 'codeFamilleActivite' },
      { champ: 'dossierSourceId', vers: 'dossiersSource', champCible: 'id' },
    ],
    colonnes: [
      { entete: 'Code activité', champ: 'codeActivite', largeur: 14, type: 'texte', obligatoire: true },
      { entete: 'Code famille activité', champ: 'codeFamilleActivite', largeur: 18, type: 'texte' },
      { entete: 'Intitulé activité', champ: 'intituleActivite', largeur: 55, type: 'texte' },
      { entete: 'Intitulé compétence', champ: 'intituleCompetence', largeur: 55, type: 'texte' },
      { entete: 'Dossier source (id)', champ: 'dossierSourceId', largeur: 16, type: 'entier' },
      { entete: 'Dossier source (libellé)', champ: 'dossierSourceLibelle', largeur: 36, type: 'texte', informative: true },
      ...horodatage(),
    ],
  },

  // ---------- Fiches métier ----------
  {
    cle: 'metiers',
    feuille: 'Métiers',
    table: 'metier',
    identite: ['codeMetier'],
    references: [
      { champ: 'codeFamille', vers: 'famillesMetier', champCible: 'codeFamille' },
      { champ: 'dossierSourceId', vers: 'dossiersSource', champCible: 'id' },
    ],
    colonnes: [
      { entete: 'Code métier', champ: 'codeMetier', largeur: 12, type: 'texte', obligatoire: true },
      { entete: 'N° obs', champ: 'nObs', largeur: 9, type: 'entier' },
      { entete: 'Intitulé', champ: 'intitule', largeur: 40, type: 'texte', obligatoire: true },
      { entete: 'Définition', champ: 'definition', largeur: 60, type: 'texte' },
      { entete: 'Code famille', champ: 'codeFamille', largeur: 12, type: 'texte' },
      { entete: 'Famille (libellé)', champ: 'familleIntitule', largeur: 32, type: 'texte', informative: true },
      { entete: 'Dossier source (id)', champ: 'dossierSourceId', largeur: 16, type: 'entier' },
      { entete: 'Dossier source (libellé)', champ: 'dossierSourceLibelle', largeur: 36, type: 'texte', informative: true },
      { entete: 'Dossier (autre)', champ: 'dossierAutre', largeur: 24, type: 'texte' },
      { entete: 'Respons. transverses', champ: 'responsTransverse', largeur: 18, type: 'enum', valeurs: OUI_NON },
      { entete: 'Interface amont/aval', champ: 'interfaceAmontAval', largeur: 22, type: 'texte' },
      { entete: 'Rédacteur', champ: 'redacteur', largeur: 20, type: 'texte' },
      { entete: 'Remarque', champ: 'remarque', largeur: 40, type: 'texte' },
      { entete: 'Nb couples', champ: 'nbCouple', largeur: 11, type: 'entier' },
      { entete: 'Clé collecte', champ: 'cleCollecte', largeur: 14, type: 'texte' },
      { entete: 'Date saisie', champ: 'dateSaisie', largeur: 22, type: 'date' },
      { entete: 'Date enregistrement', champ: 'dateEnregistrement', largeur: 22, type: 'date' },
      { entete: 'Date modification', champ: 'dateModification', largeur: 22, type: 'date' },
      { entete: 'Temps saisie', champ: 'tempsSaisie', largeur: 13, type: 'decimal' },
      { entete: 'Origine saisie', champ: 'origineSaisie', largeur: 14, type: 'texte' },
      { entete: 'Langue saisie', champ: 'langueSaisie', largeur: 13, type: 'texte' },
      { entete: 'Appareil saisie', champ: 'appareilSaisie', largeur: 14, type: 'texte' },
      { entete: 'Proximités périmées le', champ: 'proximitePerimeeLe', largeur: 22, type: 'date' },
      ...horodatage(),
    ],
  },
  {
    cle: 'appellations',
    feuille: 'Appellations',
    table: 'metier_appellation',
    identite: ['codeMetier', 'ordre'],
    references: [{ champ: 'codeMetier', vers: 'metiers', champCible: 'codeMetier' }],
    colonnes: [
      { entete: 'Code métier', champ: 'codeMetier', largeur: 12, type: 'texte', obligatoire: true },
      { entete: 'Ordre', champ: 'ordre', largeur: 8, type: 'entier', obligatoire: true },
      { entete: 'Appellation', champ: 'appellation', largeur: 45, type: 'texte', obligatoire: true },
    ],
  },
  {
    cle: 'codesRome',
    feuille: 'Codes ROME des métiers',
    table: 'metier_rome',
    identite: ['codeMetier', 'codeRome'],
    references: [
      { champ: 'codeMetier', vers: 'metiers', champCible: 'codeMetier' },
      { champ: 'codeRome', vers: 'rome', champCible: 'codeRome' },
    ],
    colonnes: [
      { entete: 'Code métier', champ: 'codeMetier', largeur: 12, type: 'texte', obligatoire: true },
      { entete: 'Ordre', champ: 'ordre', largeur: 8, type: 'entier', obligatoire: true },
      { entete: 'Code ROME', champ: 'codeRome', largeur: 12, type: 'texte', obligatoire: true },
      { entete: 'ROME (libellé)', champ: 'romeLibelle', largeur: 50, type: 'texte', informative: true },
    ],
  },
  {
    cle: 'transversales',
    feuille: 'Ressources transverses',
    table: 'metier_transversale',
    identite: ['codeMetier', 'codeTransversale'],
    references: [
      { champ: 'codeMetier', vers: 'metiers', champCible: 'codeMetier' },
      { champ: 'codeTransversale', vers: 'competencesTransversales', champCible: 'codeTransversale' },
    ],
    colonnes: [
      { entete: 'Code métier', champ: 'codeMetier', largeur: 12, type: 'texte', obligatoire: true },
      { entete: 'Code transversale', champ: 'codeTransversale', largeur: 16, type: 'texte', obligatoire: true },
      { entete: 'Ressource (libellé)', champ: 'transversaleLibelle', largeur: 40, type: 'texte', informative: true },
      { entete: 'Groupe', champ: 'groupe', largeur: 25, type: 'texte', informative: true },
      { entete: 'Niveau', champ: 'niveau', largeur: 8, type: 'entier' },
      { entete: 'Non concerné (0/1)', champ: 'nonConcerne', largeur: 16, type: 'booleen' },
    ],
  },
  {
    cle: 'conditions',
    feuille: 'Conditions exercice',
    table: 'metier_condition',
    identite: ['codeMetier', 'codeCondition'],
    references: [
      { champ: 'codeMetier', vers: 'metiers', champCible: 'codeMetier' },
      { champ: 'codeCondition', vers: 'criteresCondition', champCible: 'codeCondition' },
    ],
    colonnes: [
      { entete: 'Code métier', champ: 'codeMetier', largeur: 12, type: 'texte', obligatoire: true },
      { entete: 'Code condition', champ: 'codeCondition', largeur: 14, type: 'texte', obligatoire: true },
      { entete: 'Condition (libellé)', champ: 'conditionLibelle', largeur: 45, type: 'texte', informative: true },
      { entete: 'Valeur', champ: 'valeur', largeur: 18, type: 'enum', valeurs: SIGNIFICATIF, obligatoire: true },
    ],
  },
  {
    cle: 'acces',
    feuille: 'Conditions accès',
    table: 'metier_acces',
    identite: ['codeMetier', 'codeAcces'],
    references: [
      { champ: 'codeMetier', vers: 'metiers', champCible: 'codeMetier' },
      { champ: 'codeAcces', vers: 'criteresAcces', champCible: 'codeAcces' },
    ],
    colonnes: [
      { entete: 'Code métier', champ: 'codeMetier', largeur: 12, type: 'texte', obligatoire: true },
      { entete: 'Code accès', champ: 'codeAcces', largeur: 12, type: 'texte', obligatoire: true },
      { entete: 'Condition d’accès (libellé)', champ: 'accesLibelle', largeur: 55, type: 'texte', informative: true },
      { entete: 'Groupe', champ: 'groupe', largeur: 25, type: 'texte', informative: true },
      { entete: 'Valeur', champ: 'valeur', largeur: 40, type: 'texte', obligatoire: true },
    ],
  },

  // ---------- Couples activité-compétence, et leur rédaction ----------
  {
    cle: 'couples',
    feuille: 'Couples',
    table: 'metier_activite',
    // L'identité est l'id, pas (métier, activité) : P285 porte deux fois D.08.06.01. C'est
    // aussi cet id que citent les cinq feuilles filles, d'où son caractère obligatoire —
    // une ligne ajoutée à la main doit en choisir un.
    identite: ['coupleId'],
    references: [
      { champ: 'codeMetier', vers: 'metiers', champCible: 'codeMetier' },
      { champ: 'codeActivite', vers: 'activites', champCible: 'codeActivite' },
    ],
    colonnes: [
      { entete: 'Couple (id)', champ: 'coupleId', largeur: 12, type: 'entier', sql: 'id', obligatoire: true },
      { entete: 'Code métier', champ: 'codeMetier', largeur: 12, type: 'texte', obligatoire: true },
      { entete: 'Ordre', champ: 'ordre', largeur: 8, type: 'entier', obligatoire: true },
      { entete: 'Code activité', champ: 'codeActivite', largeur: 14, type: 'texte', obligatoire: true },
      { entete: 'Intitulé activité', champ: 'intituleActivite', largeur: 45, type: 'texte' },
      { entete: 'Intitulé compétence', champ: 'intituleCompetence', largeur: 45, type: 'texte' },
      ...horodatage(),
    ],
  },
  {
    cle: 'activiteDetails',
    feuille: 'Détails activité',
    table: 'activite_detail',
    identite: ['coupleId', 'ordre'],
    references: [{ champ: 'coupleId', vers: 'couples', champCible: 'coupleId' }],
    colonnes: [
      ...rappelDuCouple(),
      { entete: 'Ordre', champ: 'ordre', largeur: 8, type: 'entier', obligatoire: true },
      { entete: 'Libellé', champ: 'libelle', largeur: 80, type: 'texte', obligatoire: true },
    ],
  },
  {
    cle: 'competenceDetails',
    feuille: 'Détails compétence',
    table: 'competence_detail',
    identite: ['coupleId', 'ordre'],
    references: [{ champ: 'coupleId', vers: 'couples', champCible: 'coupleId' }],
    colonnes: [
      ...rappelDuCouple(),
      { entete: 'Ordre', champ: 'ordre', largeur: 8, type: 'entier', obligatoire: true },
      { entete: 'Libellé', champ: 'libelle', largeur: 80, type: 'texte', obligatoire: true },
    ],
  },
  {
    cle: 'niveauxMaitrise',
    feuille: 'Niveaux de maîtrise',
    table: 'niveau_maitrise',
    identite: ['coupleId', 'niveau'],
    references: [{ champ: 'coupleId', vers: 'couples', champCible: 'coupleId' }],
    colonnes: [
      ...rappelDuCouple(),
      { entete: 'Niveau', champ: 'niveau', largeur: 8, type: 'entier', obligatoire: true },
      { entete: 'Description', champ: 'description', largeur: 80, type: 'texte', obligatoire: true },
    ],
  },
  {
    cle: 'motsClesCouple',
    feuille: 'Mots-clés',
    table: 'activite_mot_cle',
    // Le mot-clé lui-même tient l'identité, pas son id : `mot_cle` est une table
    // d'auto-incréments dont les libellés sont uniques, et l'import la reconstitue.
    identite: ['coupleId', 'motCle'],
    references: [{ champ: 'coupleId', vers: 'couples', champCible: 'coupleId' }],
    colonnes: [
      ...rappelDuCouple(),
      { entete: 'Ordre', champ: 'ordre', largeur: 8, type: 'entier', obligatoire: true },
      { entete: 'Mot-clé', champ: 'motCle', largeur: 30, type: 'texte', obligatoire: true, resolue: true },
    ],
  },
  {
    cle: 'connaissances',
    feuille: 'Domaines de connaissance',
    table: 'activite_connaissance',
    identite: ['coupleId', 'codeFormacode'],
    references: [
      { champ: 'coupleId', vers: 'couples', champCible: 'coupleId' },
      { champ: 'codeFormacode', vers: 'formacodes', champCible: 'codeFormacode' },
      { champ: 'codeNsf', vers: 'nsf', champCible: 'codeNsf' },
    ],
    colonnes: [
      ...rappelDuCouple(),
      { entete: 'Ordre', champ: 'ordre', largeur: 8, type: 'entier', obligatoire: true },
      { entete: 'Formacode', champ: 'codeFormacode', largeur: 11, type: 'texte', obligatoire: true },
      { entete: 'Intitulé', champ: 'intitule', largeur: 40, type: 'texte' },
      { entete: 'Niveau', champ: 'niveau', largeur: 8, type: 'entier' },
      { entete: 'Durée (h)', champ: 'dureeHeures', largeur: 11, type: 'decimal' },
      { entete: 'Justification durée', champ: 'justificationDuree', largeur: 60, type: 'texte' },
      { entete: 'NSF', champ: 'codeNsf', largeur: 8, type: 'texte' },
      { entete: 'Fondamental (0/1)', champ: 'estFondamental', largeur: 16, type: 'booleen' },
      ...horodatage(),
    ],
  },
] as const;

/** Nom de la feuille d'en-tête, écrite par l'export et ignorée par l'import. */
export const FEUILLE_LISEZ_MOI = 'Lisez-moi';

export const PAR_CLE: Record<string, TableClasseur> = Object.fromEntries(
  TABLES.map((t) => [t.cle, t]),
);

/**
 * Ordre d'écriture : une table après celles qu'elle référence. Déduit des `references`
 * par tri topologique, plutôt que tenu dans une liste à part qui finirait par en diverger.
 * Les suppressions se font dans l'ordre inverse, pour ne jamais retirer un parent avant
 * ses enfants.
 */
export function ordreEcriture(): TableClasseur[] {
  const restantes = new Map(TABLES.map((t) => [t.cle, t]));
  const place = new Set<string>();
  const ordre: TableClasseur[] = [];

  while (restantes.size > 0) {
    const prete = [...restantes.values()].find((t) =>
      (t.references ?? []).every((r) => r.vers === t.cle || place.has(r.vers)),
    );
    if (!prete) {
      // Impossible avec le schéma actuel ; le signaler plutôt que de boucler sans fin si
      // une référence circulaire venait à être introduite.
      throw new Error(
        `Références circulaires entre tables du classeur : ${[...restantes.keys()].join(', ')}`,
      );
    }
    ordre.push(prete);
    place.add(prete.cle);
    restantes.delete(prete.cle);
  }

  return ordre;
}

/** Colonnes réellement écrites en base (les colonnes informatives en sont exclues). */
export function colonnesEcrites(t: TableClasseur): ColonneClasseur[] {
  return t.colonnes.filter((c) => !c.informative);
}
