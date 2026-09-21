import * as XLSX from 'xlsx';
import { QueryTypes, Transaction } from 'sequelize';
import { sequelize } from '../../database/connection';
import {
  ColonneClasseur,
  PAR_CLE,
  TABLES,
  TableClasseur,
  colonneSql,
  colonnesEcrites,
  ordreEcriture,
} from './schema';
import { ETIQUETTE_EXPORTE_LE, ETIQUETTE_VERSION_SCHEMA } from './ecriture';
import { ContenuClasseur, LigneClasseur, lireBase, versionSchema } from './lecture';

/**
 * Import du classeur d'échange, en **synchronisation** : à la fin, la base est l'exacte
 * image du fichier. Une ligne absente du fichier est donc supprimée — c'est ce qui permet
 * de retirer une fiche en effaçant sa ligne, et ce qui fait de l'export/import un vrai
 * aller-retour plutôt qu'un cumul.
 *
 * Opération destructrice, d'où la forme en deux temps : `analyser()` ne lit rien d'autre
 * que la base et ne modifie rien, et rend le détail de ce qui serait écrit ;
 * `appliquer()` refait la même analyse puis l'exécute dans une transaction unique. Un
 * fichier qui porte la moindre anomalie n'est jamais appliqué à moitié.
 *
 * L'ordre d'écriture vient du tri topologique des références du schéma : les suppressions
 * d'abord, dans l'ordre inverse (jamais un parent avant ses enfants), puis les créations
 * et mises à jour dans l'ordre direct.
 *
 * Le fichier vient de l'utilisateur : il est analysé par position de colonne après
 * appariement des en-têtes, jamais en laissant la bibliothèque construire des objets dont
 * les clés viendraient du fichier — ce qui écarte les clés spéciales du type `__proto__`.
 */

export interface AnomalieImport {
  feuille?: string;
  /** Numéro de ligne dans le tableur (1 = en-têtes). */
  ligne?: number;
  colonne?: string;
  message: string;
}

export interface DiffTable {
  cle: string;
  feuille: string;
  table: string;
  lues: number;
  ajouts: number;
  modifications: number;
  suppressions: number;
  inchangees: number;
  /** Quelques identités concernées, pour que le rapport soit lisible sans tout déverser. */
  exemples: { ajouts: string[]; modifications: string[]; suppressions: string[] };
}

export interface RapportImport {
  meta: {
    exporteLe: string | null;
    versionSchemaFichier: string | null;
    versionSchemaBase: string | null;
  };
  anomalies: AnomalieImport[];
  avertissements: string[];
  tables: DiffTable[];
  totaux: { lues: number; ajouts: number; modifications: number; suppressions: number };
  /** `true` seulement après une application effective. */
  applique: boolean;
  /** Métiers dont les passerelles sont à recalculer (`db:recalc-proximites`). */
  metiersARecalculer: number;
}

/** Plafond des anomalies collectées : au-delà, le fichier est de toute façon à refaire. */
const MAX_ANOMALIES = 200;
const MAX_EXEMPLES = 5;

// ---------------------------------------------------------------- valeurs

/**
 * Dates : jamais d'objet `Date`, ni ici ni ailleurs dans le classeur. mysql2 *lit* un
 * DATETIME comme s'il était en UTC mais *réécrit* une `Date` en heure locale du serveur
 * Node : passer par un objet décalait chaque horodatage de l'écart de fuseau à chaque
 * aller-retour. On manipule donc la chaîne `AAAA-MM-JJThh:mm:ss`, que MariaDB lit
 * directement comme littéral.
 *
 * Sont acceptés le séparateur `T` ou l'espace, un `Z` final (que produisaient les
 * premières versions), des fractions de seconde, et une cellule datée par Excel.
 */
function normaliserDate(valeur: unknown): string | null {
  if (valeur === null || valeur === undefined || valeur === '') return null;

  if (valeur instanceof Date) {
    if (Number.isNaN(valeur.getTime())) return null;
    // Excel a typé la cellule : on relit ses composantes UTC, qui sont celles qu'il a
    // écrites, sans repasser par le fuseau local.
    return valeur.toISOString().slice(0, 19);
  }

  const m = String(valeur)
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?$/);
  return m ? `${m[1]}T${m[2]}` : null;
}

/** Forme canonique d'une valeur, pour comparer le fichier et la base sans faux positifs. */
type Canonique = string | number | null;

/**
 * Fins de ligne ramenées à LF. Le format OOXML applique la normalisation XML des fins de
 * ligne : un CRLF écrit dans une cellule revient en LF à la relecture, et aucun réglage de
 * la bibliothèque n'y change quoi que ce soit. Or plusieurs centaines de valeurs en base
 * portent des CRLF héritées des classeurs sources. Sans cette normalisation à la
 * comparaison, chaque import verrait 622 lignes « modifiées » et les réécrirait alors que
 * rien n'a changé.
 *
 * Conséquence assumée : un import ne peut pas servir à changer *seulement* les fins de
 * ligne d'un texte. Si une ligne est réécrite pour une autre raison, sa colonne texte
 * repart en LF.
 */
function normaliserFinsDeLigne(texte: string): string {
  return texte.replace(/\r\n?/g, '\n');
}

function canoniser(valeur: unknown, colonne: ColonneClasseur): Canonique {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  switch (colonne.type) {
    case 'date':
      return normaliserDate(valeur);
    case 'decimal':
    case 'entier':
    case 'booleen': {
      const n = Number(valeur);
      return Number.isFinite(n) ? n : null;
    }
    default:
      return normaliserFinsDeLigne(String(valeur));
  }
}

interface Lue {
  valeur: unknown;
  anomalie?: string;
}

/** Convertit une cellule selon le type déclaré, ou explique pourquoi elle est refusée. */
function lireCellule(brut: unknown, colonne: ColonneClasseur): Lue {
  if (brut === null || brut === undefined || brut === '') {
    // Un booléen vide vaut « non » : ces colonnes sont NOT NULL en base et laisser
    // l'utilisateur écrire 0 partout n'apporterait rien.
    if (colonne.type === 'booleen') return { valeur: 0 };
    return { valeur: null };
  }

  switch (colonne.type) {
    case 'texte':
      // Aucun nettoyage : plus de 500 valeurs en base se terminent par un retour à la
      // ligne, et un `.trim()` les aurait silencieusement réécrites à chaque import. Un
      // aller-retour doit rendre le texte tel quel, espaces de bord compris.
      return { valeur: String(brut) };

    case 'enum': {
      const v = String(brut).trim();
      if (!colonne.valeurs?.includes(v)) {
        return {
          valeur: null,
          anomalie: `valeur « ${v} » hors des valeurs admises (${colonne.valeurs?.join(', ')})`,
        };
      }
      return { valeur: v };
    }

    case 'entier': {
      const n = Number(brut);
      if (!Number.isInteger(n)) return { valeur: null, anomalie: `« ${brut} » n'est pas un entier` };
      return { valeur: n };
    }

    case 'decimal': {
      // Tolère la virgule décimale, qu'Excel en locale française peut laisser en texte.
      const n = Number(String(brut).replace(',', '.'));
      if (!Number.isFinite(n)) return { valeur: null, anomalie: `« ${brut} » n'est pas un nombre` };
      return { valeur: n };
    }

    case 'booleen': {
      const v = String(brut).trim();
      if (v !== '0' && v !== '1') {
        return { valeur: null, anomalie: `« ${v} » n'est ni 0 ni 1` };
      }
      return { valeur: Number(v) };
    }

    case 'date': {
      const v = normaliserDate(brut);
      if (v === null) {
        return {
          valeur: null,
          anomalie: `« ${brut} » n'est pas une date au format AAAA-MM-JJThh:mm:ss`,
        };
      }
      return { valeur: v };
    }
  }
}

/** Identité d'une ligne, sous forme de chaîne comparable. */
function identite(ligne: LigneClasseur, table: TableClasseur): string {
  return table.identite
    .map((champ) => {
      const colonne = table.colonnes.find((c) => c.champ === champ)!;
      return String(canoniser(ligne[champ], colonne));
    })
    .join('');
}

/** Identité lisible, pour le rapport. */
function identiteLisible(ligne: LigneClasseur, table: TableClasseur): string {
  return table.identite.map((champ) => String(ligne[champ] ?? '—')).join(' / ');
}

// ---------------------------------------------------------------- lecture du fichier

interface Feuille {
  lignes: LigneClasseur[];
  /** Numéro de ligne dans le tableur, parallèle à `lignes`. */
  numeros: number[];
}

function lireFeuille(
  classeur: XLSX.WorkBook,
  table: TableClasseur,
  anomalies: AnomalieImport[],
  avertissements: string[],
): Feuille | null {
  const brute = classeur.Sheets[table.feuille];
  if (!brute) {
    anomalies.push({
      feuille: table.feuille,
      message: `feuille absente du classeur (feuilles trouvées : ${classeur.SheetNames.join(', ')})`,
    });
    return null;
  }

  // `header: 1` rend des tableaux : les en-têtes du fichier ne deviennent jamais des clés
  // d'objet, et l'appariement reste sous notre contrôle.
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(brute, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  });

  if (aoa.length === 0) {
    anomalies.push({ feuille: table.feuille, message: 'feuille vide, même pas d’en-têtes' });
    return null;
  }

  const entetes = (aoa[0] as unknown[]).map((e) => (e === null ? '' : String(e).trim()));
  const index = new Map<string, number>();
  for (const colonne of table.colonnes) {
    const i = entetes.indexOf(colonne.entete);
    if (i === -1) {
      anomalies.push({
        feuille: table.feuille,
        colonne: colonne.entete,
        message: 'colonne absente de la feuille',
      });
    } else {
      index.set(colonne.champ, i);
    }
  }
  if (index.size !== table.colonnes.length) return null;

  const inconnues = entetes.filter(
    (e) => e !== '' && !table.colonnes.some((c) => c.entete === e),
  );
  if (inconnues.length > 0) {
    avertissements.push(
      `« ${table.feuille} » : colonne(s) ignorée(s) car absente(s) du schéma — ${inconnues.join(', ')}`,
    );
  }

  const lignes: LigneClasseur[] = [];
  const numeros: number[] = [];
  const vues = new Map<string, number>();

  for (let i = 1; i < aoa.length; i++) {
    const cellules = aoa[i] as unknown[];
    const numero = i + 1;
    if (!cellules || cellules.every((c) => c === null || c === '')) continue;

    const ligne: LigneClasseur = {};
    let refusee = false;

    for (const colonne of table.colonnes) {
      const brutCellule = cellules[index.get(colonne.champ)!] ?? null;
      const { valeur, anomalie } = lireCellule(brutCellule, colonne);

      if (anomalie) {
        if (anomalies.length < MAX_ANOMALIES) {
          anomalies.push({ feuille: table.feuille, ligne: numero, colonne: colonne.entete, message: anomalie });
        }
        refusee = true;
      }
      if (colonne.obligatoire && (valeur === null || valeur === '')) {
        if (anomalies.length < MAX_ANOMALIES) {
          anomalies.push({
            feuille: table.feuille,
            ligne: numero,
            colonne: colonne.entete,
            message: 'cellule vide alors que la colonne est obligatoire',
          });
        }
        refusee = true;
      }
      ligne[colonne.champ] = valeur;
    }

    if (refusee) continue;

    const cle = identite(ligne, table);
    const deja = vues.get(cle);
    if (deja !== undefined) {
      if (anomalies.length < MAX_ANOMALIES) {
        anomalies.push({
          feuille: table.feuille,
          ligne: numero,
          message:
            `identité « ${identiteLisible(ligne, table)} » déjà présente ligne ${deja} ` +
            `(colonnes d'identité : ${table.identite.join(', ')})`,
        });
      }
      continue;
    }
    vues.set(cle, numero);
    lignes.push(ligne);
    numeros.push(numero);
  }

  return { lignes, numeros };
}

/** Relit les métadonnées du « Lisez-moi ». Absentes, l'import continue sans se situer. */
function lireMeta(classeur: XLSX.WorkBook): {
  exporteLe: string | null;
  versionSchema: string | null;
} {
  const feuille = classeur.Sheets['Lisez-moi'];
  if (!feuille) return { exporteLe: null, versionSchema: null };

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(feuille, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: false,
  });
  const valeur = (etiquette: string): string | null => {
    const ligne = aoa.find((l) => String((l as unknown[])[0] ?? '').trim() === etiquette);
    const v = ligne ? (ligne as unknown[])[1] : null;
    return v === null || v === undefined || v === '' ? null : String(v).trim();
  };

  return {
    exporteLe: valeur(ETIQUETTE_EXPORTE_LE),
    versionSchema: valeur(ETIQUETTE_VERSION_SCHEMA),
  };
}

// ---------------------------------------------------------------- validations

/**
 * Intégrité référentielle **dans le fichier**. C'est le bon périmètre : après
 * synchronisation la base est l'image du fichier, donc une référence qui ne se résout pas
 * ici ne se résoudra pas davantage en base.
 */
function validerReferences(contenu: ContenuClasseur, anomalies: AnomalieImport[]): void {
  for (const table of TABLES) {
    for (const reference of table.references ?? []) {
      const cible = PAR_CLE[reference.vers];
      const colonneCible = cible.colonnes.find((c) => c.champ === reference.champCible)!;
      const connues = new Set(
        (contenu[cible.cle] ?? []).map((l) => String(canoniser(l[reference.champCible], colonneCible))),
      );
      const colonne = table.colonnes.find((c) => c.champ === reference.champ)!;

      let manquantes = 0;
      const exemples: string[] = [];
      for (const ligne of contenu[table.cle] ?? []) {
        const v = canoniser(ligne[reference.champ], colonne);
        if (v === null) continue; // une référence facultative non renseignée est licite
        if (!connues.has(String(v))) {
          manquantes++;
          if (exemples.length < MAX_EXEMPLES) exemples.push(String(ligne[reference.champ]));
        }
      }
      if (manquantes > 0 && anomalies.length < MAX_ANOMALIES) {
        anomalies.push({
          feuille: table.feuille,
          colonne: colonne.entete,
          message:
            `${manquantes} valeur(s) introuvable(s) dans « ${cible.feuille} » ` +
            `(${exemples.join(', ')}${manquantes > exemples.length ? '…' : ''})`,
        });
      }
    }
  }
}

interface ColonneBase {
  nullable: boolean;
}

/**
 * Colonnes réellement présentes en base, avec leur nullabilité. Sert à deux choses :
 * vérifier que chaque colonne du schéma existe (un `sql` erroné se verrait ici plutôt
 * qu'au milieu d'une écriture), et savoir quand omettre une valeur vide plutôt que
 * d'écrire NULL dans une colonne qui le refuse.
 */
async function colonnesBase(): Promise<Map<string, ColonneBase>> {
  const lignes = await sequelize.query<{ t: string; c: string; nullable: string }>(
    `SELECT table_name AS t, column_name AS c, is_nullable AS nullable
       FROM information_schema.columns WHERE table_schema = DATABASE()`,
    { type: QueryTypes.SELECT },
  );
  return new Map(lignes.map((l) => [`${l.t}.${l.c}`, { nullable: l.nullable === 'YES' }]));
}

function validerSchemaContreBase(
  base: Map<string, ColonneBase>,
  anomalies: AnomalieImport[],
): void {
  for (const table of TABLES) {
    for (const colonne of colonnesEcrites(table)) {
      if (colonne.resolue) continue;
      if (!base.has(`${table.table}.${colonneSql(colonne)}`)) {
        anomalies.push({
          feuille: table.feuille,
          colonne: colonne.entete,
          message: `le schéma la rattache à ${table.table}.${colonneSql(colonne)}, qui n'existe pas en base`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------- diff

interface Plan {
  table: TableClasseur;
  ajouts: LigneClasseur[];
  modifications: LigneClasseur[];
  suppressions: LigneClasseur[];
  diff: DiffTable;
}

function comparer(table: TableClasseur, duFichier: LigneClasseur[], deLaBase: LigneClasseur[]): Plan {
  const aEcrire = colonnesEcrites(table);
  const parIdentiteBase = new Map(deLaBase.map((l) => [identite(l, table), l]));

  const ajouts: LigneClasseur[] = [];
  const modifications: LigneClasseur[] = [];
  const restantes = new Set(parIdentiteBase.keys());
  let inchangees = 0;
  const exemples = { ajouts: [] as string[], modifications: [] as string[], suppressions: [] as string[] };

  for (const ligne of duFichier) {
    const cle = identite(ligne, table);
    const enBase = parIdentiteBase.get(cle);
    if (!enBase) {
      ajouts.push(ligne);
      if (exemples.ajouts.length < MAX_EXEMPLES) exemples.ajouts.push(identiteLisible(ligne, table));
      continue;
    }
    restantes.delete(cle);

    const differe = aEcrire.some(
      (c) => canoniser(ligne[c.champ], c) !== canoniser(enBase[c.champ], c),
    );
    if (differe) {
      modifications.push(ligne);
      if (exemples.modifications.length < MAX_EXEMPLES) {
        exemples.modifications.push(identiteLisible(ligne, table));
      }
    } else {
      inchangees++;
    }
  }

  const suppressions = [...restantes].map((cle) => parIdentiteBase.get(cle)!);
  for (const ligne of suppressions.slice(0, MAX_EXEMPLES)) {
    exemples.suppressions.push(identiteLisible(ligne, table));
  }

  return {
    table,
    ajouts,
    modifications,
    suppressions,
    diff: {
      cle: table.cle,
      feuille: table.feuille,
      table: table.table,
      lues: duFichier.length,
      ajouts: ajouts.length,
      modifications: modifications.length,
      suppressions: suppressions.length,
      inchangees,
      exemples,
    },
  };
}

// ---------------------------------------------------------------- écriture

/** Valeur prête pour SQL : une `Date` reste une Date, le reste passe tel quel. */
function pourSql(valeur: unknown): unknown {
  return valeur === undefined ? null : valeur;
}

/**
 * `activite_mot_cle` ne porte pas le libellé mais un id : on résout chaque mot-clé du
 * fichier vers `mot_cle`, en créant les libellés absents. Les lignes devenues orphelines
 * sont retirées en fin d'import.
 */
async function resoudreMotsCles(
  libelles: string[],
  transaction: Transaction,
): Promise<Map<string, number>> {
  const uniques = [...new Set(libelles)];
  const resolus = new Map<string, number>();
  if (uniques.length === 0) return resolus;

  const existants = await sequelize.query<{ id: number; libelle: string }>(
    `SELECT id, libelle FROM mot_cle WHERE libelle IN (:libelles)`,
    { replacements: { libelles: uniques }, type: QueryTypes.SELECT, transaction },
  );
  for (const e of existants) resolus.set(e.libelle, e.id);

  const aCreer = uniques.filter((l) => !resolus.has(l));
  for (const libelle of aCreer) {
    const [id] = await sequelize.query(`INSERT INTO mot_cle (libelle) VALUES (:libelle)`, {
      replacements: { libelle },
      type: QueryTypes.INSERT,
      transaction,
    });
    resolus.set(libelle, Number(id));
  }
  return resolus;
}

/** Conditions `WHERE` de l'identité d'une ligne, et leurs valeurs. */
function clauseIdentite(
  table: TableClasseur,
  ligne: LigneClasseur,
  motsCles: Map<string, number>,
): { sql: string; valeurs: Record<string, unknown> } {
  const morceaux: string[] = [];
  const valeurs: Record<string, unknown> = {};
  table.identite.forEach((champ, i) => {
    const colonne = table.colonnes.find((c) => c.champ === champ)!;
    if (colonne.resolue) {
      morceaux.push(`mot_cle_id = :id${i}`);
      valeurs[`id${i}`] = motsCles.get(String(ligne[champ]));
      return;
    }
    morceaux.push(`${colonneSql(colonne)} = :id${i}`);
    valeurs[`id${i}`] = pourSql(ligne[champ]);
  });
  return { sql: morceaux.join(' AND '), valeurs };
}

async function supprimer(
  plan: Plan,
  motsCles: Map<string, number>,
  transaction: Transaction,
): Promise<void> {
  for (const ligne of plan.suppressions) {
    const { sql, valeurs } = clauseIdentite(plan.table, ligne, motsCles);
    await sequelize.query(`DELETE FROM ${plan.table.table} WHERE ${sql}`, {
      replacements: valeurs,
      type: QueryTypes.DELETE,
      transaction,
    });
  }
}

async function inserer(
  plan: Plan,
  base: Map<string, ColonneBase>,
  motsCles: Map<string, number>,
  transaction: Transaction,
): Promise<void> {
  for (const ligne of plan.ajouts) {
    const colonnes: string[] = [];
    const jetons: string[] = [];
    const valeurs: Record<string, unknown> = {};

    plan.table.colonnes.filter((c) => !c.informative).forEach((c, i) => {
      const nom = c.resolue ? 'mot_cle_id' : colonneSql(c);
      const valeur = c.resolue ? motsCles.get(String(ligne[c.champ])) : pourSql(ligne[c.champ]);
      // Une colonne NOT NULL laissée vide (les horodatages, surtout) est omise : la base
      // applique son défaut, là où écrire NULL serait refusé.
      const nullable = base.get(`${plan.table.table}.${nom}`)?.nullable ?? true;
      if (valeur === null && !nullable) return;
      colonnes.push(nom);
      jetons.push(`:v${i}`);
      valeurs[`v${i}`] = valeur;
    });

    await sequelize.query(
      `INSERT INTO ${plan.table.table} (${colonnes.join(', ')}) VALUES (${jetons.join(', ')})`,
      { replacements: valeurs, type: QueryTypes.INSERT, transaction },
    );
  }
}

async function modifier(
  plan: Plan,
  base: Map<string, ColonneBase>,
  motsCles: Map<string, number>,
  transaction: Transaction,
): Promise<void> {
  for (const ligne of plan.modifications) {
    const affectations: string[] = [];
    const valeurs: Record<string, unknown> = {};

    plan.table.colonnes
      .filter((c) => !c.informative && !plan.table.identite.includes(c.champ))
      .forEach((c, i) => {
        const nom = c.resolue ? 'mot_cle_id' : colonneSql(c);
        const valeur = c.resolue ? motsCles.get(String(ligne[c.champ])) : pourSql(ligne[c.champ]);
        const nullable = base.get(`${plan.table.table}.${nom}`)?.nullable ?? true;
        if (valeur === null && !nullable) return;
        affectations.push(`${nom} = :v${i}`);
        valeurs[`v${i}`] = valeur;
      });

    if (affectations.length === 0) continue;

    const { sql, valeurs: cles } = clauseIdentite(plan.table, ligne, motsCles);
    await sequelize.query(
      `UPDATE ${plan.table.table} SET ${affectations.join(', ')} WHERE ${sql}`,
      { replacements: { ...valeurs, ...cles }, type: QueryTypes.UPDATE, transaction },
    );
  }
}

/**
 * Les métiers dont une donnée entrant dans le calcul des passerelles a bougé. Le périmètre
 * est volontairement large (toute ligne touchée sur metier, ses ressources transverses,
 * ses couples ou leurs domaines de connaissance) : marquer un métier de trop coûte un
 * recalcul, en oublier un laisse une passerelle fausse.
 */
function metiersTouches(plans: Plan[], contenu: ContenuClasseur): Set<string> {
  const couples = new Map(
    (contenu.couples ?? []).map((c) => [String(c.coupleId), String(c.codeMetier)]),
  );
  const touches = new Set<string>();

  for (const plan of plans) {
    if (!['metiers', 'transversales', 'couples', 'connaissances'].includes(plan.table.cle)) continue;
    for (const ligne of [...plan.ajouts, ...plan.modifications, ...plan.suppressions]) {
      const code = ligne.codeMetier ?? couples.get(String(ligne.coupleId));
      if (code) touches.add(String(code));
    }
  }
  return touches;
}

// ---------------------------------------------------------------- points d'entrée

async function preparer(
  tampon: Buffer,
): Promise<{ rapport: RapportImport; plans: Plan[]; contenu: ContenuClasseur; base: Map<string, ColonneBase> }> {
  const anomalies: AnomalieImport[] = [];
  const avertissements: string[] = [];

  let classeur: XLSX.WorkBook;
  try {
    classeur = XLSX.read(tampon, { type: 'buffer', cellDates: true });
  } catch (e) {
    throw new Error(`Fichier illisible en tant que classeur .xlsx : ${(e as Error).message}`);
  }

  const meta = lireMeta(classeur);
  const [versionBase, base] = await Promise.all([versionSchema(), colonnesBase()]);
  validerSchemaContreBase(base, anomalies);

  // Un fichier produit sur un schéma plus récent décrirait des colonnes que cette base
  // n'a pas : on le signale sans bloquer, la validation colonne par colonne trancherait.
  if (meta.versionSchema && versionBase && meta.versionSchema > versionBase) {
    avertissements.push(
      `Le classeur a été produit sur un schéma plus récent que celui de cette base ` +
        `(${meta.versionSchema} contre ${versionBase}).`,
    );
  }

  const contenu: ContenuClasseur = {};
  for (const table of TABLES) {
    const feuille = lireFeuille(classeur, table, anomalies, avertissements);
    contenu[table.cle] = feuille?.lignes ?? [];
  }

  if (anomalies.length === 0) validerReferences(contenu, anomalies);

  const deLaBase = await lireBase();
  const plans = ordreEcriture().map((table) =>
    comparer(table, contenu[table.cle] ?? [], deLaBase[table.cle] ?? []),
  );

  // Les plans suivent l'ordre d'écriture ; le rapport suit l'ordre du schéma, plus proche
  // de l'ordre des feuilles dans le classeur.
  const parCle = new Map(plans.map((p) => [p.table.cle, p.diff]));
  const tables = TABLES.map((t) => parCle.get(t.cle)!);

  const totaux = tables.reduce(
    (acc, t) => ({
      lues: acc.lues + t.lues,
      ajouts: acc.ajouts + t.ajouts,
      modifications: acc.modifications + t.modifications,
      suppressions: acc.suppressions + t.suppressions,
    }),
    { lues: 0, ajouts: 0, modifications: 0, suppressions: 0 },
  );

  return {
    rapport: {
      meta: {
        exporteLe: meta.exporteLe,
        versionSchemaFichier: meta.versionSchema,
        versionSchemaBase: versionBase,
      },
      anomalies,
      avertissements,
      tables,
      totaux,
      applique: false,
      metiersARecalculer: metiersTouches(plans, contenu).size,
    },
    plans,
    contenu,
    base,
  };
}

/** Analyse à blanc : rend le détail de ce qui serait écrit, sans rien modifier. */
export async function analyserClasseur(tampon: Buffer): Promise<RapportImport> {
  const { rapport } = await preparer(tampon);
  return rapport;
}

/**
 * Applique le classeur. Tout se joue dans une transaction : un fichier qui échoue en cours
 * de route ne laisse rien derrière lui.
 */
export async function appliquerClasseur(tampon: Buffer): Promise<RapportImport> {
  const { rapport, plans, contenu, base } = await preparer(tampon);

  if (rapport.anomalies.length > 0) return rapport;

  const touches = metiersTouches(plans, contenu);

  await sequelize.transaction(async (transaction) => {
    const motsCles = await resoudreMotsCles(
      (contenu.motsClesCouple ?? []).map((l) => String(l.motCle)),
      transaction,
    );
    // Les mots-clés à supprimer peuvent avoir disparu du fichier : leurs id se lisent en
    // base, pas dans la table résolue ci-dessus.
    const planMotsCles = plans.find((p) => p.table.cle === 'motsClesCouple');
    if (planMotsCles) {
      const aRetirer = planMotsCles.suppressions.map((l) => String(l.motCle));
      for (const [libelle, id] of await resoudreMotsCles(aRetirer, transaction)) {
        motsCles.set(libelle, id);
      }
    }

    // Suppressions d'abord, dans l'ordre inverse des dépendances : jamais un parent avant
    // ses enfants.
    for (const plan of [...plans].reverse()) {
      await supprimer(plan, motsCles, transaction);
    }
    // Puis créations et mises à jour, dans l'ordre direct.
    for (const plan of plans) {
      await inserer(plan, base, motsCles, transaction);
      await modifier(plan, base, motsCles, transaction);
    }

    // `mot_cle` n'est pas exportée : elle se reconstitue, et ses lignes devenues
    // orphelines n'ont plus de raison d'être.
    await sequelize.query(
      `DELETE mc FROM mot_cle mc
        WHERE NOT EXISTS (SELECT 1 FROM activite_mot_cle a WHERE a.mot_cle_id = mc.id)`,
      { type: QueryTypes.DELETE, transaction },
    );

    // Les passerelles sont une table calculée : l'import ne la touche pas, il date les
    // fiches concernées pour que le front les signale comme périmées.
    if (touches.size > 0) {
      // `updated_at = updated_at` neutralise le ON UPDATE CURRENT_TIMESTAMP de la colonne :
      // ce marqueur est interne, il ne doit pas faire passer la fiche pour modifiée — même
      // raison que le `silent: true` de `marquerProximitePerimee()`.
      await sequelize.query(
        `UPDATE metier SET proximite_perimee_le = NOW(), updated_at = updated_at
          WHERE code_metier IN (:codes)`,
        { replacements: { codes: [...touches] }, type: QueryTypes.UPDATE, transaction },
      );
    }

    await journaliser(rapport, transaction);
  });

  return { ...rapport, applique: true };
}

/** Trace l'import dans `import_batch`, comme les importeurs de classeurs sources. */
async function journaliser(rapport: RapportImport, transaction: Transaction): Promise<void> {
  const { totaux } = rapport;
  await sequelize.query(
    `INSERT INTO import_batch
       (fichier, feuille, version, lignes_lues, lignes_ok, lignes_erreur, rapport, statut, termine_le)
     VALUES (:fichier, :feuille, :version, :lues, :ok, :erreur, :rapport, 'termine', NOW())`,
    {
      replacements: {
        fichier: 'classeur d’échange (import général)',
        feuille: `${rapport.tables.length} feuilles`,
        version: rapport.meta.versionSchemaFichier,
        lues: totaux.lues,
        ok: totaux.ajouts + totaux.modifications,
        erreur: 0,
        rapport: JSON.stringify({
          exporteLe: rapport.meta.exporteLe,
          totaux,
          avertissements: rapport.avertissements,
          tables: rapport.tables.map((t) => ({
            table: t.table,
            ajouts: t.ajouts,
            modifications: t.modifications,
            suppressions: t.suppressions,
          })),
        }),
      },
      type: QueryTypes.INSERT,
      transaction,
    },
  );
}
