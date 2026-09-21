import * as XLSX from 'xlsx';
import {
  ColonneClasseur,
  FEUILLE_LISEZ_MOI,
  TABLES,
  TableClasseur,
} from './schema';
import { ContenuClasseur, HORS_CLASSEUR, LigneClasseur } from './lecture';

/**
 * Écriture du classeur d'échange, pilotée par le schéma : une feuille par table, dans
 * l'ordre de déclaration, précédée d'un « Lisez-moi ».
 *
 * Les valeurs ne sont pas embellies. Les énumérations sortent telles qu'en base
 * (`significatif`, pas « Significatif »), les booléens en 0/1, les dates en ISO 8601 et
 * jamais en sérial Excel. Traduire ici obligerait l'import à deviner le sens inverse, et
 * un aller-retour ne doit pas dépendre d'une table de correspondance implicite.
 */

type Cellule = string | number | null;

/** Métadonnées portées par le « Lisez-moi », relues par l'import pour se situer. */
export interface MetaClasseur {
  exporteLe: string;
  versionSchema: string | null;
}

/** Les libellés qui servent de clé de lecture au « Lisez-moi ». */
export const ETIQUETTE_EXPORTE_LE = 'Exporté le';
export const ETIQUETTE_VERSION_SCHEMA = 'Dernière migration appliquée';

function cellule(valeur: unknown, colonne: ColonneClasseur): Cellule {
  if (valeur === null || valeur === undefined || valeur === '') return null;

  switch (colonne.type) {
    case 'date':
      // Déjà formatée en chaîne par SQL (voir lecture.ts) : surtout ne pas la faire passer
      // par un objet `Date`, qui y ajouterait un fuseau que la valeur ne porte pas.
      return String(valeur);
    case 'decimal': {
      // `DECIMAL` arrive en chaîne : on le rend numérique pour qu'Excel n'affiche pas du
      // texte aligné à gauche, et que la relecture n'ait pas à deviner le séparateur.
      const n = Number(valeur);
      return Number.isFinite(n) ? n : null;
    }
    case 'entier':
    case 'booleen': {
      const n = Number(valeur);
      return Number.isFinite(n) ? n : null;
    }
    default:
      return String(valeur);
  }
}

function ecrireFeuille(
  classeur: XLSX.WorkBook,
  table: TableClasseur,
  lignes: LigneClasseur[],
): void {
  const cellules = lignes.map((ligne) =>
    table.colonnes.map((c) => cellule(ligne[c.champ], c)),
  );
  const feuille = XLSX.utils.aoa_to_sheet([
    table.colonnes.map((c) => c.entete),
    ...cellules,
  ]);
  feuille['!cols'] = table.colonnes.map((c) => ({ wch: c.largeur }));
  // Un nom de feuille au-delà de 31 caractères, ou portant l'un des caractères interdits
  // ([]:*?/\), fait refuser le classeur entier à l'ouverture. Un test vérifie que les
  // noms du schéma respectent les deux contraintes ; la troncature n'est qu'un filet.
  XLSX.utils.book_append_sheet(classeur, feuille, table.feuille.slice(0, 31));
}

/**
 * Première feuille : ce que contient le classeur, et les conventions pour le relire. Les
 * comptes sont pris sur les feuilles réellement écrites — une table ajoutée au schéma y
 * apparaît sans rien à mettre à jour ici.
 */
function ecrireLisezMoi(
  classeur: XLSX.WorkBook,
  contenu: ContenuClasseur,
  meta: MetaClasseur,
): void {
  const total = TABLES.reduce((s, t) => s + (contenu[t.cle]?.length ?? 0), 0);

  const lignes: Cellule[][] = [
    ['Export général — base Fiches métiers'],
    [],
    [ETIQUETTE_EXPORTE_LE, meta.exporteLe],
    [ETIQUETTE_VERSION_SCHEMA, meta.versionSchema],
    ['Feuilles de données', TABLES.length],
    ['Lignes au total', total],
    [],
    ['Ce classeur peut être réimporté tel quel, ou après modification, par l’écran'],
    ['d’accueil de l’application. L’import SYNCHRONISE : à la fin, la base est l’exacte'],
    ['image de ce fichier. Une ligne retirée ici est donc supprimée en base.'],
    [],
    ['Conventions à respecter si vous modifiez ce fichier :'],
    ['— ne renommez pas les feuilles ni les en-têtes de colonne, ils servent de repères ;'],
    ['— les booléens s’écrivent 0 ou 1, pas Oui/Non ;'],
    ['— les énumérations gardent leur forme de base : « significatif »,'],
    ['   « non_significatif », « oui », « non », « base_formacodes »… ;'],
    ['— les dates s’écrivent en ISO 8601 sans fuseau (2026-09-21T10:20:45) ;'],
    ['— une cellule vide vaut NULL ;'],
    ['— les fins de ligne d’un texte reviennent en saut de ligne simple : le format Excel'],
    ['   ne conserve pas les retours chariot. L’import ne considère donc pas une'],
    ['   différence de fin de ligne comme une modification, et ne réécrit pas la cellule'],
    ['   pour cette seule raison ;'],
    ['— les colonnes de libellé joint (« Famille (libellé) », « ROME (libellé) »,'],
    ['   « NSF (libellé) »…) et les colonnes de rappel du couple sont informatives :'],
    ['   l’import les ignore. Pour changer un rattachement, modifiez la colonne de code.'],
    [],
    ['« Couple (id) » est l’identifiant de la ligne dans metier_activite. C’est lui qui'],
    ['porte la rédaction d’un couple (détails, niveaux de maîtrise, domaines de'],
    ['connaissance), et donc la clé de rattachement des cinq feuilles filles. La paire'],
    ['(code métier, code activité) ne suffirait pas : un métier peut porter deux fois le'],
    ['même code d’activité. Une ligne ajoutée à la main doit donc fournir un id libre.'],
    [],
    ['Ne sont pas exportées, et ne seront pas réimportées :'],
    ...Object.entries(HORS_CLASSEUR).map(([table, raison]) => [`— ${table}`, raison] as Cellule[]),
    [],
    ['Feuille', 'Table source', 'Lignes'],
    ...TABLES.map(
      (t) => [t.feuille, t.table, contenu[t.cle]?.length ?? 0] as Cellule[],
    ),
  ];

  const feuille = XLSX.utils.aoa_to_sheet(lignes);
  feuille['!cols'] = [{ wch: 32 }, { wch: 30 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(classeur, feuille, FEUILLE_LISEZ_MOI);
}

/** Construit le classeur complet et le rend sous forme de tampon .xlsx. */
export function ecrireClasseur(contenu: ContenuClasseur, meta: MetaClasseur): Buffer {
  const classeur = XLSX.utils.book_new();
  ecrireLisezMoi(classeur, contenu, meta);
  for (const table of TABLES) {
    ecrireFeuille(classeur, table, contenu[table.cle] ?? []);
  }
  return XLSX.write(classeur, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Nom de fichier proposé au téléchargement, daté pour ne pas écraser un export précédent. */
export function nomFichier(exporteLe: string): string {
  const jour = exporteLe.slice(0, 10);
  return `export-base-fiches-metiers-${jour}.xlsx`;
}
