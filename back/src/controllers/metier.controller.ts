import { Request, Response } from 'express';
import { Op, WhereOptions, InferAttributes, QueryTypes } from 'sequelize';
import { z } from 'zod';
import { sequelize } from '../database/connection';
import {
  Metier,
  MetierAppellation,
  MetierRome,
  Rome,
  MetierCondition,
  MetierTransversale,
  MetierAcces,
  CritereCondition,
  CompetenceTransversale,
  CritereAcces,
  FamilleMetier,
  DossierSource,
  Activite,
  ActiviteConnaissance,
  Formacode,
  MetierActivite,
  ActiviteDetail,
  CompetenceDetail,
  NiveauMaitrise,
  MotCle,
} from '../models';
import { HttpError } from '../types/api';
import { lirePagination, construireReponsePaginee } from '../middlewares/pagination';

/** GET /api/metiers?search=&famille=&dossier=&rome=&page=&limit= */
export async function listerMetiers(req: Request, res: Response): Promise<void> {
  const pagination = lirePagination(req);
  const { search, famille, dossier, rome } = req.query;

  const where: WhereOptions<InferAttributes<Metier>> = {};
  if (famille) where.codeFamille = String(famille);
  if (dossier) where.dossierSourceId = Number(dossier);

  if (search) {
    const terme = `%${String(search)}%`;
    Object.assign(where, {
      // Le code métier est inclus : « D192 » doit trouver la fiche correspondante.
      [Op.or]: [
        { codeMetier: { [Op.like]: terme } },
        { intitule: { [Op.like]: terme } },
        { definition: { [Op.like]: terme } },
      ],
    });
  }

  // Un métier porte jusqu'à 3 codes ROME : une sous-requête évite la jointure, qui
  // dupliquerait les lignes et fausserait le compte de la pagination.
  if (rome) {
    where.codeMetier = {
      [Op.in]: sequelize.literal(
        `(SELECT code_metier FROM metier_rome WHERE code_rome = ${sequelize.escape(String(rome))})`,
      ),
    } as never;
  }

  const { rows, count } = await Metier.findAndCountAll({
    where,
    include: [
      { model: FamilleMetier, as: 'famille' },
      { model: DossierSource, as: 'dossierSource' },
      { model: MetierAppellation, as: 'appellations', separate: true, order: [['ordre', 'ASC']] },
    ],
    order: [['intitule', 'ASC']],
    limit: pagination.limit,
    offset: pagination.offset,
    distinct: true,
  });

  res.json(construireReponsePaginee(rows, count, pagination));
}

/**
 * Les seules valeurs réellement présentes en base pour INTERFACE (vérifié sur les 333
 * métiers) — un texte libre casserait silencieusement `recalculerProximites()`, qui
 * compare cette chaîne au mot près (services/passerelle.service.ts, `RANG_INTERFACE`).
 */
const VALEURS_INTERFACE = ['Non', 'Oui, en amont OU aval', 'Oui, en amont ET aval'] as const;

const schemaCreationMetier = z.object({
  codeFamille: z.string().trim().min(1).max(5),
  /** Nombre de métiers vu par le client à l'ouverture du formulaire — voir la vérification ci-dessous. */
  totalAttendu: z.number().int().min(0),
  intitule: z.string().trim().min(1).max(255),
  definition: z.string().trim().max(5000).nullable(),
  dossierSourceId: z.number().int().nullable(),
  dossierAutre: z.string().trim().max(255).nullable(),
  redacteur: z.string().trim().max(100).nullable(),
  responsTransverse: z.enum(['oui', 'non']).nullable(),
  interfaceAmontAval: z.enum(VALEURS_INTERFACE).nullable(),
});

/**
 * POST /api/metiers — crée une fiche métier vierge : le code est généré (lettre de la
 * famille choisie + numéro suivant le plus haut existant), les autres sections (couples,
 * conditions, ressources transverses…) se remplissent ensuite via les éditions déjà en
 * place sur la fiche, toutes pilotées par les référentiels et donc utilisables dès la
 * création (aucune ligne préexistante requise).
 *
 * Le numéro n'est PAS `COUNT(*) + 1` : la numérotation porte des trous historiques (332
 * métiers en base, mais le plus haut numéro déjà utilisé est 333) — seul MAX(numéro) + 1
 * garantit l'absence de collision.
 *
 * `totalAttendu` (le compte vu par le client à l'ouverture du formulaire) est revérifié
 * ici : si quelqu'un a créé une fiche entre-temps, mieux vaut le dire clairement à
 * l'utilisateur que de continuer sur une base déjà périmée.
 */
export async function creerMetier(req: Request, res: Response): Promise<void> {
  const donnees = schemaCreationMetier.parse(req.body);

  const famille = await FamilleMetier.findByPk(donnees.codeFamille, { attributes: ['codeFamille'] });
  if (!famille) throw HttpError.badRequest(`Famille inconnue : ${donnees.codeFamille}`);

  if (donnees.dossierSourceId !== null) {
    const dossier = await DossierSource.findByPk(donnees.dossierSourceId, { attributes: ['id'] });
    if (!dossier) throw HttpError.badRequest(`Dossier source inconnu : ${donnees.dossierSourceId}`);
  }

  const totalActuel = await Metier.count();
  if (totalActuel !== donnees.totalAttendu) {
    throw HttpError.conflict(
      `Le catalogue a changé entre-temps (${totalActuel} métiers en base au lieu de ${donnees.totalAttendu} attendus) : rechargez la page et réessayez.`,
    );
  }

  const [{ maxNumero }] = await sequelize.query<{ maxNumero: number | null }>(
    `SELECT MAX(CAST(SUBSTRING(code_metier, 2) AS UNSIGNED)) AS maxNumero FROM metier`,
    { type: QueryTypes.SELECT },
  );

  const NB_TENTATIVES = 5;
  let numero = (maxNumero ?? 0) + 1;
  for (let tentative = 0; tentative < NB_TENTATIVES; tentative++) {
    const codeMetier = `${donnees.codeFamille}${numero}`;
    try {
      const metier = await Metier.create({
        codeMetier,
        intitule: donnees.intitule,
        definition: donnees.definition,
        codeFamille: donnees.codeFamille,
        dossierSourceId: donnees.dossierSourceId,
        dossierAutre: donnees.dossierAutre,
        redacteur: donnees.redacteur,
        responsTransverse: donnees.responsTransverse,
        interfaceAmontAval: donnees.interfaceAmontAval,
      });
      res.status(201).json(metier);
      return;
    } catch (err) {
      const estDoublon =
        err instanceof Error && err.name === 'SequelizeUniqueConstraintError';
      if (!estDoublon || tentative === NB_TENTATIVES - 1) throw err;
      numero += 1;
    }
  }
}

/**
 * DELETE /api/metiers/:code — supprime la fiche et tout ce qui lui appartient en propre :
 * couples activité-compétence (et leurs détails/mots-clés/domaines de connaissance),
 * conditions d'exercice et d'accès, ressources transverses, appellations, codes ROME, et
 * ses lignes de `metier_proximite` (source ou cible) — tout est en CASCADE en base, une
 * seule suppression suffit. Contrairement à un formacode, un métier n'est référencé par
 * rien d'autre : pas de vérification d'usage à faire avant de supprimer.
 */
export async function supprimerMetier(req: Request<{ code: string }>, res: Response): Promise<void> {
  const metier = await Metier.findByPk(req.params.code, { attributes: ['codeMetier'] });
  if (!metier) throw HttpError.notFound(`Métier ${req.params.code}`);

  await metier.destroy();
  res.status(204).send();
}

/**
 * GET /api/metiers/options — la totalité des métiers, champs minimaux.
 * Pour un sélecteur (ex. « métier de départ » de l'écran passerelles) : pas de pagination,
 * la table ne fait que 333 lignes, contrairement à `listerMetiers` prévue pour un catalogue paginé.
 */
export async function listerMetiersOptions(_req: Request, res: Response): Promise<void> {
  const metiers = await Metier.findAll({
    attributes: ['codeMetier', 'intitule', 'codeFamille'],
    order: [['intitule', 'ASC']],
  });
  res.json({ data: metiers });
}

/** GET /api/metiers/:code — fiche métier complète. */
export async function obtenirMetier(
  req: Request<{ code: string }>,
  res: Response,
): Promise<void> {
  const metier = await Metier.findByPk(req.params.code, {
    include: [
      { model: FamilleMetier, as: 'famille' },
      { model: DossierSource, as: 'dossierSource' },
      { model: MetierAppellation, as: 'appellations', separate: true, order: [['ordre', 'ASC']] },
      { model: MetierRome, as: 'codesRome', separate: true, order: [['ordre', 'ASC']] },
      {
        model: MetierCondition,
        as: 'conditions',
        include: [{ model: CritereCondition, as: 'critere' }],
      },
      {
        model: MetierTransversale,
        as: 'transversales',
        include: [{ model: CompetenceTransversale, as: 'competence' }],
      },
      { model: MetierAcces, as: 'acces', include: [{ model: CritereAcces, as: 'critere' }] },
    ],
  });

  if (!metier) throw HttpError.notFound(`Métier ${req.params.code}`);
  res.json(metier);
}

const schemaModificationMetier = z.object({
  definition: z.string().trim().max(5000).nullable().optional(),
  remarque: z.string().trim().max(5000).nullable().optional(),
  responsTransverse: z.enum(['oui', 'non']).nullable().optional(),
  interfaceAmontAval: z.enum(VALEURS_INTERFACE).nullable().optional(),
});

/**
 * PATCH /api/metiers/:code — champs simples uniquement (définition, remarque,
 * responsabilité transverse, interface amont/aval). Les listes (appellations, ROME,
 * conditions, couples…) ne sont pas éditables par cette route.
 *
 * `responsTransverse` et `interfaceAmontAval` alimentent `recalculerProximites()` : les
 * modifier ne recalcule pas `metier_proximite`, qui reste basé sur l'ancienne valeur
 * jusqu'au prochain recalcul. La fiche est donc marquée « passerelles périmées » quand
 * l'un des deux change — et seulement dans ce cas : corriger une définition n'a aucun
 * effet sur le calcul.
 */
export async function modifierMetier(
  req: Request<{ code: string }>,
  res: Response,
): Promise<void> {
  const metier = await Metier.findByPk(req.params.code);
  if (!metier) throw HttpError.notFound(`Métier ${req.params.code}`);

  const donnees = schemaModificationMetier.parse(req.body);

  if ('definition' in donnees) metier.definition = donnees.definition || null;
  if ('remarque' in donnees) metier.remarque = donnees.remarque || null;
  if ('responsTransverse' in donnees) metier.responsTransverse = donnees.responsTransverse ?? null;
  if ('interfaceAmontAval' in donnees) metier.interfaceAmontAval = donnees.interfaceAmontAval ?? null;

  const proximiteTouchee =
    metier.changed('responsTransverse') || metier.changed('interfaceAmontAval');
  if (proximiteTouchee) metier.proximitePerimeeLe = new Date();

  await metier.save();
  res.json(metier);
}

const schemaModificationAppellations = z.object({
  appellations: z.array(z.string().trim().min(1).max(255)).max(10),
});

/**
 * PUT /api/metiers/:code/appellations — remplace en bloc la liste (ordre = position dans
 * le tableau), comme les niveaux d'un formacode ou les conditions d'exercice : suppression
 * et recréation plutôt qu'un diff ligne à ligne, la liste ne dépasse jamais dix éléments.
 * N'entre pas dans le calcul des passerelles : jamais de `marquerProximitePerimee` ici.
 */
export async function modifierAppellations(req: Request<{ code: string }>, res: Response): Promise<void> {
  const codeMetier = req.params.code;
  const metier = await Metier.findByPk(codeMetier, { attributes: ['codeMetier'] });
  if (!metier) throw HttpError.notFound(`Métier ${codeMetier}`);

  const { appellations } = schemaModificationAppellations.parse(req.body);
  const doublons = new Set(appellations.map((a) => a.toLowerCase()));
  if (doublons.size !== appellations.length) {
    throw HttpError.badRequest('Une même appellation est envoyée deux fois');
  }

  await sequelize.transaction(async (transaction) => {
    await MetierAppellation.destroy({ where: { codeMetier }, transaction });
    if (appellations.length > 0) {
      await MetierAppellation.bulkCreate(
        appellations.map((appellation, i) => ({ codeMetier, appellation, ordre: i + 1 })),
        { transaction },
      );
    }
  });

  const apres = await MetierAppellation.findAll({ where: { codeMetier }, order: [['ordre', 'ASC']] });
  res.json({ data: apres });
}

const schemaModificationRome = z.object({
  codesRome: z.array(z.string().trim().min(1).max(10)).max(5),
});

/**
 * PUT /api/metiers/:code/rome — même principe que les appellations (remplacement en bloc),
 * avec en plus une vérification contre le référentiel ROME : un code mal saisi casserait
 * silencieusement le filtre « Fiche ROME » de la page Métiers.
 */
export async function modifierCodesRome(req: Request<{ code: string }>, res: Response): Promise<void> {
  const codeMetier = req.params.code;
  const metier = await Metier.findByPk(codeMetier, { attributes: ['codeMetier'] });
  if (!metier) throw HttpError.notFound(`Métier ${codeMetier}`);

  const { codesRome } = schemaModificationRome.parse(req.body);
  if (new Set(codesRome).size !== codesRome.length) {
    throw HttpError.badRequest('Un même code ROME est envoyé deux fois');
  }

  if (codesRome.length > 0) {
    const connus = await Rome.findAll({ where: { codeRome: codesRome }, attributes: ['codeRome'] });
    const codesConnus = new Set(connus.map((r) => r.codeRome));
    const inconnus = codesRome.filter((c) => !codesConnus.has(c));
    if (inconnus.length > 0) throw HttpError.badRequest(`Code(s) ROME inconnu(s) : ${inconnus.join(', ')}`);
  }

  await sequelize.transaction(async (transaction) => {
    await MetierRome.destroy({ where: { codeMetier }, transaction });
    if (codesRome.length > 0) {
      await MetierRome.bulkCreate(
        codesRome.map((codeRome, i) => ({ codeMetier, codeRome, ordre: i + 1 })),
        { transaction },
      );
    }
  });

  const apres = await MetierRome.findAll({ where: { codeMetier }, order: [['ordre', 'ASC']] });
  res.json({ data: apres });
}

/**
 * GET /api/metiers/:code/activites — les couples activité-compétence de la fiche.
 *
 * On interroge `MetierActivite` et non `Activite` : les intitulés et les détails sont
 * contextualisés par métier, ils pendent du couple (docs/SCHEMA.md §4).
 */
export async function obtenirActivitesMetier(
  req: Request<{ code: string }>,
  res: Response,
): Promise<void> {
  const metier = await Metier.findByPk(req.params.code, { attributes: ['codeMetier'] });
  if (!metier) throw HttpError.notFound(`Métier ${req.params.code}`);

  const couples = await MetierActivite.findAll({
    where: { codeMetier: req.params.code },
    include: [
      { model: ActiviteDetail, as: 'detailsActivite', separate: true, order: [['ordre', 'ASC']] },
      {
        model: CompetenceDetail,
        as: 'detailsCompetence',
        separate: true,
        order: [['ordre', 'ASC']],
      },
      { model: NiveauMaitrise, as: 'niveauxMaitrise', separate: true, order: [['niveau', 'ASC']] },
      { model: MotCle, as: 'motsCles', through: { attributes: ['ordre'] } },
      // Les connaissances pendent du couple depuis la migration 008, plus du catalogue.
      {
        model: ActiviteConnaissance,
        as: 'connaissances',
        separate: true,
        order: [['ordre', 'ASC']],
        include: [{ model: Formacode, as: 'formacode' }],
      },
      { model: Activite, as: 'activite' },
    ],
    order: [['ordre', 'ASC']],
  });

  res.json({ data: couples });
}

/**
 * GET /api/metiers/:code/connaissances — domaines structurants du métier.
 *
 * Un même formacode revient sur plusieurs couples : la fiche Excel n'en affiche qu'une
 * ligne. On dédoublonne en retenant le niveau le plus élevé — c'est l'exigence qui
 * s'impose au métier dans son ensemble.
 *
 * Le libellé et le NSF viennent en priorité de `formacode` : la collecte saisit les
 * intitulés en capitales, et laisse le NSF vide sur plus de la moitié des lignes —
 * la fiche D194 « Superviseur de production » ne renseigne ni l'un ni l'autre. Le
 * référentiel `Formacode_niveau` les connaît, on retombe donc dessus.
 */
export async function obtenirConnaissancesMetier(
  req: Request<{ code: string }>,
  res: Response,
): Promise<void> {
  const metier = await Metier.findByPk(req.params.code, { attributes: ['codeMetier'] });
  if (!metier) throw HttpError.notFound(`Métier ${req.params.code}`);

  const domaines = await sequelize.query(
    `SELECT ac.code_formacode                       AS codeFormacode,
            COALESCE(f.intitule, MIN(ac.intitule))  AS intitule,
            MAX(ac.niveau)                          AS niveau,
            MAX(ac.duree_heures)                    AS dureeHeures,
            COALESCE(f.code_nsf, MIN(ac.code_nsf))  AS codeNsf
       FROM metier_activite ma
       JOIN activite_connaissance ac ON ac.metier_activite_id = ma.id
       LEFT JOIN formacode f ON f.code_formacode = ac.code_formacode
      WHERE ma.code_metier = :code
      GROUP BY ac.code_formacode, f.intitule, f.code_nsf
      ORDER BY intitule`,
    { replacements: { code: req.params.code }, type: QueryTypes.SELECT },
  );

  res.json({ data: domaines });
}
