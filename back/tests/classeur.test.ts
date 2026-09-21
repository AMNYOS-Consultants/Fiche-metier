import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import * as XLSX from 'xlsx';
import { QueryTypes } from 'sequelize';
import { agentAuthentifie } from './helpers/client';
import { sequelize } from '../src/models';
import { TABLES, colonneSql, colonnesEcrites, ordreEcriture } from '../src/services/classeur/schema';
import { HORS_CLASSEUR, requete } from '../src/services/classeur/lecture';

/**
 * Le classeur d'échange, dans les deux sens.
 *
 * Le test central est l'aller-retour : exporter, réimporter en vérification, et n'obtenir
 * aucune différence. C'est la seule façon de prouver que l'export et l'import partagent
 * bien la même définition de colonnes — l'enjeu de `services/classeur/schema.ts`. Tous les
 * autres tests de ce fichier sont là pour que, si l'aller-retour casse, on sache où.
 *
 * Un seul test écrit, et il applique le classeur **non modifié** : l'import est alors un
 * no-op, ce qui exerce tout le chemin d'écriture sans changer une seule donnée — vérifié
 * par empreinte avant/après. Les tests de refus, eux, soumettent des classeurs abîmés aux
 * routes de vérification, qui n'écrivent rien par construction.
 *
 * Ce fichier ne teste volontairement pas une application avec modifications : sur une base
 * de travail, la synchronisation supprimerait ce qui manque au fichier soumis, et un échec
 * en cours de route laisserait des données réelles altérées. C'est le rôle du mode
 * vérification, testé ici, de couvrir ce cas sans rien risquer.
 */

const FEUILLES_INTERDITES = /[[\]:*?/\\]/;

/** Le classeur, relu en tableau de tableaux par feuille. */
type Classeur = Record<string, unknown[][]>;

function relire(tampon: Buffer): { classeur: XLSX.WorkBook; feuilles: Classeur } {
  const classeur = XLSX.read(tampon, { type: 'buffer', cellDates: true });
  const feuilles: Classeur = {};
  for (const nom of classeur.SheetNames) {
    feuilles[nom] = XLSX.utils.sheet_to_json<unknown[]>(classeur.Sheets[nom], {
      header: 1,
      defval: null,
      raw: true,
      blankrows: false,
    });
  }
  return { classeur, feuilles };
}

/** Réécrit un classeur depuis ses feuilles en tableaux, pour le resoumettre modifié. */
function reecrire(feuilles: Classeur, ordre: string[]): Buffer {
  const classeur = XLSX.utils.book_new();
  for (const nom of ordre) {
    XLSX.utils.book_append_sheet(classeur, XLSX.utils.aoa_to_sheet(feuilles[nom]), nom);
  }
  return XLSX.write(classeur, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function colonne(feuille: unknown[][], entete: string): number {
  const i = (feuille[0] as unknown[]).indexOf(entete);
  if (i === -1) throw new Error(`Colonne « ${entete} » absente`);
  return i;
}

async function exporter(agent: request.Agent): Promise<Buffer> {
  const res = await agent.get('/api/export/general').buffer().parse(binaire).expect(200);
  return res.body as Buffer;
}

/**
 * supertest décode le corps en texte par défaut, ce qui détruirait un .xlsx : cet
 * analyseur le garde en binaire. La signature de `parse` est typée pour du texte, d'où
 * la conversion.
 */
const binaire = ((
  res: NodeJS.ReadableStream,
  callback: (err: Error | null, body: Buffer) => void,
) => {
  const morceaux: Buffer[] = [];
  res.on('data', (c: Buffer) => morceaux.push(c));
  res.on('end', () => callback(null, Buffer.concat(morceaux)));
}) as unknown as (str: string) => unknown;

function soumettre(agent: request.Agent, chemin: string, tampon: Buffer) {
  return agent
    .post(chemin)
    .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .send(tampon);
}

// ---------------------------------------------------------------- schéma

describe('Classeur — cohérence du schéma', () => {
  it('donne à chaque feuille un nom qu’Excel accepte, et distinct', async () => {
    const noms = TABLES.map((t) => t.feuille);
    for (const nom of noms) {
      // Au-delà de 31 caractères, ou avec l'un de ces caractères, Excel refuse le
      // classeur entier à l'ouverture — pas seulement la feuille.
      expect(nom.length, nom).toBeLessThanOrEqual(31);
      expect(FEUILLES_INTERDITES.test(nom), nom).toBe(false);
    }
    expect(new Set(noms).size).toBe(noms.length);
  });

  it('rattache chaque colonne à une colonne qui existe vraiment en base', async () => {
    const enBase = await sequelize.query<{ t: string; c: string }>(
      `SELECT table_name AS t, column_name AS c
         FROM information_schema.columns WHERE table_schema = DATABASE()`,
      { type: QueryTypes.SELECT },
    );
    const connues = new Set(enBase.map((l) => `${l.t}.${l.c}`));

    // C'est ce test qui rattrape une exception `sql:` oubliée dans le schéma : sans lui,
    // `snake('creeLe')` donnerait `cree_le`, colonne inexistante, et l'erreur ne
    // surgirait qu'au milieu d'une écriture.
    const orphelines: string[] = [];
    for (const table of TABLES) {
      for (const c of colonnesEcrites(table)) {
        if (c.resolue) continue;
        const cible = `${table.table}.${colonneSql(c)}`;
        if (!connues.has(cible)) orphelines.push(`${table.feuille} / ${c.entete} -> ${cible}`);
      }
    }
    expect(orphelines).toEqual([]);
  });

  it('lit exactement les champs déclarés, ni plus ni moins', async () => {
    const ecarts: string[] = [];
    for (const table of TABLES) {
      const lignes = await sequelize.query<Record<string, unknown>>(
        `SELECT * FROM (${requete(table.cle)}) t LIMIT 1`,
        // Les requetes formatent leurs dates via un parametre : il faut le fournir ici aussi.
        { replacements: { fmt: '%Y-%m-%dT%H:%i:%s' }, type: QueryTypes.SELECT },
      );
      if (lignes.length === 0) continue;
      const renvoyes = Object.keys(lignes[0]).sort();
      const declares = table.colonnes.map((c) => c.champ).sort();
      if (renvoyes.join(',') !== declares.join(',')) {
        ecarts.push(`${table.feuille} : lus [${renvoyes}] vs déclarés [${declares}]`);
      }
    }
    expect(ecarts).toEqual([]);
  });

  it('couvre toutes les tables du schéma, ou les exclut explicitement', async () => {
    const lignes = await sequelize.query<{ nom: string }>(
      `SELECT table_name AS nom FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`,
      { type: QueryTypes.SELECT },
    );
    const couvertes = new Set(TABLES.map((t) => t.table));
    const oubliees = lignes
      .map((l) => l.nom)
      .filter((nom) => !couvertes.has(nom) && !(nom in HORS_CLASSEUR));

    // Une migration qui ajoute une table fera échouer ce test : c'est le rappel voulu,
    // l'aller-retour n'ayant de sens que s'il est complet.
    expect(oubliees).toEqual([]);
  });

  it('ordonne les tables après celles qu’elles référencent', () => {
    const rang = new Map(ordreEcriture().map((t, i) => [t.cle, i]));
    for (const table of TABLES) {
      for (const reference of table.references ?? []) {
        if (reference.vers === table.cle) continue;
        expect(rang.get(reference.vers)!, `${table.cle} -> ${reference.vers}`).toBeLessThan(
          rang.get(table.cle)!,
        );
      }
    }
  });
});

// ---------------------------------------------------------------- aller-retour

describe('Classeur — aller-retour', () => {
  let agent: request.Agent;
  let tampon: Buffer;
  let feuilles: Classeur;
  let ordre: string[];

  beforeAll(async () => {
    agent = await agentAuthentifie();
    tampon = await exporter(agent);
    const relu = relire(tampon);
    feuilles = relu.feuilles;
    ordre = relu.classeur.SheetNames;
  });

  it('exporte un classeur lisible, une feuille par table plus le Lisez-moi', () => {
    expect(ordre).toEqual(['Lisez-moi', ...TABLES.map((t) => t.feuille)]);
    for (const table of TABLES) {
      const feuille = feuilles[table.feuille];
      expect(feuille[0], table.feuille).toEqual(table.colonnes.map((c) => c.entete));
    }
  });

  it('réimporté tel quel, ne produit aucune différence', async () => {
    const res = await soumettre(agent, '/api/import/general/verification', tampon).expect(200);

    expect(res.body.anomalies).toEqual([]);
    // Le cœur du test : ce qui a été écrit se relit à l'identique. Tout écart ici signale
    // une conversion asymétrique entre l'écriture et la lecture (date, décimal, booléen).
    expect(res.body.totaux).toMatchObject({ ajouts: 0, modifications: 0, suppressions: 0 });
    expect(res.body.applique).toBe(false);
    expect(res.body.meta.versionSchemaFichier).toBe(res.body.meta.versionSchemaBase);
  });

  it('compte, feuille par feuille, autant de lignes que la base', async () => {
    const res = await soumettre(agent, '/api/import/general/verification', tampon).expect(200);
    const comptes = await Promise.all(
      TABLES.map((t) =>
        sequelize.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t.table}`, {
          type: QueryTypes.SELECT,
          plain: true,
        }),
      ),
    );
    const attendu = Object.fromEntries(TABLES.map((t, i) => [t.table, Number(comptes[i]?.n)]));
    const obtenu = Object.fromEntries(
      (res.body.tables as Array<{ table: string; lues: number }>).map((t) => [t.table, t.lues]),
    );
    expect(obtenu).toEqual(attendu);
  });

  it('appliqué sans modification, n’écrit rien', async () => {
    const empreinte = () =>
      sequelize.query<{ x: string }>(
        `SELECT CONCAT_WS('|',
                  (SELECT COUNT(*) FROM metier), (SELECT COUNT(*) FROM metier_activite),
                  (SELECT COUNT(*) FROM activite_connaissance), (SELECT COUNT(*) FROM mot_cle),
                  (SELECT BIT_XOR(CRC32(CONCAT_WS('~',code_metier,intitule,COALESCE(remarque,'')))) FROM metier),
                  (SELECT BIT_XOR(CRC32(CONCAT_WS('~',id,code_metier,code_activite,ordre))) FROM metier_activite)
                ) AS x`,
        { type: QueryTypes.SELECT, plain: true },
      );

    // On vérifie AVANT d'appliquer, et l'assertion qui suit arrête le test en cas d'écart :
    // une asymétrie de conversion ne peut donc pas être écrite en base par ce test. C'est
    // l'ordre inverse qui avait laissé un import décaler 646 lignes de données réelles.
    const controle = await soumettre(agent, '/api/import/general/verification', tampon).expect(200);
    expect(controle.body.anomalies).toEqual([]);
    expect(controle.body.totaux).toMatchObject({ ajouts: 0, modifications: 0, suppressions: 0 });

    const avant = await empreinte();
    const res = await soumettre(agent, '/api/import/general/application', tampon).expect(200);
    const apres = await empreinte();

    // La ligne de journal est retirée tout de suite, avant les assertions : un échec ne
    // doit pas la laisser traîner en base.
    await sequelize.query(
      `DELETE FROM import_batch WHERE fichier LIKE '%import général%' AND lignes_erreur = 0`,
      { type: QueryTypes.DELETE },
    );

    expect(res.body.applique).toBe(true);
    expect(res.body.totaux).toMatchObject({ ajouts: 0, modifications: 0, suppressions: 0 });
    // Rien à recalculer : aucune donnée entrant dans les passerelles n'a bougé.
    expect(res.body.metiersARecalculer).toBe(0);
    expect(apres?.x).toBe(avant?.x);
  });

  it('refuse un corps qui n’est pas un classeur', async () => {
    const res = await soumettre(agent, '/api/import/general/verification', Buffer.from('pas un zip'))
      .expect(400);
    expect(res.body.error.code).toBe('FICHIER_INVALIDE');
  });

  it('refuse un corps vide', async () => {
    const res = await agent
      .post('/api/import/general/verification')
      .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .expect(400);
    expect(res.body.error.code).toBe('FICHIER_MANQUANT');
  });
});

// ---------------------------------------------------------------- refus

describe('Classeur — ce que l’import refuse', () => {
  let agent: request.Agent;
  let feuilles: Classeur;
  let ordre: string[];

  beforeAll(async () => {
    agent = await agentAuthentifie();
    const relu = relire(await exporter(agent));
    feuilles = relu.feuilles;
    ordre = relu.classeur.SheetNames;
  });

  /** Copie des feuilles, pour qu'un test n'altère pas le classeur des suivants. */
  const copie = (): Classeur =>
    Object.fromEntries(Object.entries(feuilles).map(([k, v]) => [k, v.map((l) => [...l])]));

  it('une feuille manquante', async () => {
    const c = copie();
    delete c['Réf - NSF'];
    const res = await soumettre(
      agent,
      '/api/import/general/verification',
      reecrire(c, ordre.filter((n) => n !== 'Réf - NSF')),
    ).expect(200);

    expect(
      res.body.anomalies.some(
        (a: { feuille: string; message: string }) =>
          a.feuille === 'Réf - NSF' && /absente du classeur/.test(a.message),
      ),
    ).toBe(true);
  });

  it('une colonne renommée', async () => {
    const c = copie();
    c['Réf - ROME'][0][1] = 'Intitulé';
    const rapport = await soumettre(
      agent,
      '/api/import/general/verification',
      reecrire(c, ordre),
    ).expect(200);

    expect(
      rapport.body.anomalies.some(
        (a: { feuille: string; colonne: string }) =>
          a.feuille === 'Réf - ROME' && a.colonne === 'Libellé',
      ),
    ).toBe(true);
  });

  it('une énumération hors valeurs admises', async () => {
    const c = copie();
    const f = c['Conditions exercice'];
    f[1][colonne(f, 'Valeur')] = 'peut-être';
    const res = await soumettre(agent, '/api/import/general/verification', reecrire(c, ordre)).expect(
      200,
    );

    expect(
      res.body.anomalies.some((a: { message: string }) => /hors des valeurs admises/.test(a.message)),
    ).toBe(true);
  });

  it('une référence qui ne se résout pas dans le fichier', async () => {
    const c = copie();
    const f = c['Codes ROME des métiers'];
    f[1][colonne(f, 'Code ROME')] = 'Z9999';
    const res = await soumettre(agent, '/api/import/general/verification', reecrire(c, ordre)).expect(
      200,
    );

    // Le bon périmètre est le fichier : après synchronisation la base est son image, donc
    // une référence absente du fichier ne se résoudrait pas davantage en base.
    expect(
      res.body.anomalies.some(
        (a: { feuille: string; message: string }) =>
          a.feuille === 'Codes ROME des métiers' && /introuvable/.test(a.message),
      ),
    ).toBe(true);
  });

  it('deux lignes de même identité', async () => {
    const c = copie();
    const f = c['Réf - NSF'];
    f.push([...(f[1] as unknown[])]);
    const res = await soumettre(agent, '/api/import/general/verification', reecrire(c, ordre)).expect(
      200,
    );

    expect(
      res.body.anomalies.some((a: { message: string }) => /déjà présente ligne/.test(a.message)),
    ).toBe(true);
  });

  it('une cellule obligatoire vide', async () => {
    const c = copie();
    const f = c['Métiers'];
    f[1][colonne(f, 'Intitulé')] = null;
    const res = await soumettre(agent, '/api/import/general/verification', reecrire(c, ordre)).expect(
      200,
    );

    expect(
      res.body.anomalies.some((a: { message: string }) => /obligatoire/.test(a.message)),
    ).toBe(true);
  });

  it('n’applique jamais un fichier porteur d’anomalies', async () => {
    const c = copie();
    const f = c['Métiers'];
    f[1][colonne(f, 'Intitulé')] = null;
    const res = await soumettre(agent, '/api/import/general/application', reecrire(c, ordre)).expect(
      422,
    );

    expect(res.body.applique).toBe(false);
    expect(res.body.anomalies.length).toBeGreaterThan(0);
  });
});
