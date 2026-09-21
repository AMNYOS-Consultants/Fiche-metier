import fs from 'node:fs';
import * as XLSX from 'xlsx';

export type Ligne = Record<string, unknown>;

/**
 * Lit une feuille en tableau d'objets indexés par l'en-tête de la ligne 1.
 * `defval: null` est important : sans lui, xlsx omet les cellules vides et les objets
 * résultants n'ont pas les mêmes clés d'une ligne à l'autre.
 */
export function lireFeuille(cheminFichier: string, nomFeuille: string): Ligne[] {
  if (!fs.existsSync(cheminFichier)) {
    throw new Error(`Fichier introuvable : ${cheminFichier}`);
  }

  const classeur = XLSX.readFile(cheminFichier, { cellDates: true });
  const feuille = classeur.Sheets[nomFeuille];

  if (!feuille) {
    throw new Error(
      `Feuille « ${nomFeuille} » absente de ${cheminFichier}. ` +
        `Feuilles disponibles : ${classeur.SheetNames.join(', ')}`,
    );
  }

  return XLSX.utils.sheet_to_json<Ligne>(feuille, { defval: null, raw: true });
}

/**
 * Noms des feuilles d'un classeur. Utile quand le nom porte une date et changera à la
 * prochaine livraison du référentiel (« Arbo Principale 15-06-2026 ») : l'appelant le
 * retrouve par préfixe au lieu de le coder en dur.
 */
export function nomsFeuilles(cheminFichier: string): string[] {
  if (!fs.existsSync(cheminFichier)) {
    throw new Error(`Fichier introuvable : ${cheminFichier}`);
  }
  return XLSX.readFile(cheminFichier, { bookSheets: true }).SheetNames;
}

/**
 * Lit une feuille en tableau de tableaux, indexé par position de colonne.
 *
 * À préférer à `lireFeuille` dès que les en-têtes sont ambigus. Dans
 * `Outil_collecte_fiche_metier`, deux colonnes portent le libellé « CODE_METIER »
 * (la 40, qui contient le code, et la 41, qui contient la famille) : un accès par nom
 * en écraserait une. Les feuilles `nomencl_*` ont une mise en page irrégulière et
 * n'ont, elles, pas de ligne d'en-tête exploitable.
 */
export function lireFeuilleBrute(cheminFichier: string, nomFeuille: string): unknown[][] {
  if (!fs.existsSync(cheminFichier)) {
    throw new Error(`Fichier introuvable : ${cheminFichier}`);
  }

  const classeur = XLSX.readFile(cheminFichier, { cellDates: true });
  const feuille = classeur.Sheets[nomFeuille];

  if (!feuille) {
    throw new Error(
      `Feuille « ${nomFeuille} » absente de ${cheminFichier}. ` +
        `Feuilles disponibles : ${classeur.SheetNames.join(', ')}`,
    );
  }

  return XLSX.utils.sheet_to_json<unknown[]>(feuille, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: true, // conserve la numérotation des lignes du tableur
  });
}

/**
 * Convertit une date du classeur. Les cellules typées date sortent en `Date` grâce à
 * `cellDates`, mais les colonnes de l'outil de collecte sont du texte « JJ/MM/AAAA hh:mm:ss ».
 */
export function dateFr(valeur: unknown): Date | null {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur;

  const m = String(valeur)
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) return null;

  const [, j, mo, a, h = '0', mi = '0', s = '0'] = m;
  const d = new Date(Number(a), Number(mo) - 1, Number(j), Number(h), Number(mi), Number(s));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Chaîne nettoyée, ou null si la cellule est vide. */
export function texte(valeur: unknown): string | null {
  if (valeur === null || valeur === undefined) return null;
  const s = String(valeur).trim();
  return s === '' ? null : s;
}

/** Nombre, ou null. Gère la virgule décimale française. */
export function nombre(valeur: unknown): number | null {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : null;
  const n = Number(String(valeur).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Le niveau d'approfondissement est parfois textuel dans les sources :
 * « 3 », « Niveau unique (3) », « niveau unique (2) ».
 */
export function niveauApprofondissement(valeur: unknown): {
  niveau: number | null;
  estUnique: boolean;
} {
  const brut = texte(valeur);
  if (!brut) return { niveau: null, estUnique: false };

  const estUnique = /niveau\s+unique/i.test(brut);
  const chiffre = brut.match(/(\d+)/);

  return { niveau: chiffre ? Number(chiffre[1]) : null, estUnique };
}
