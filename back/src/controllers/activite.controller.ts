import { Request, Response } from 'express';
import { Op, WhereOptions, InferAttributes, QueryTypes } from 'sequelize';
import { sequelize } from '../database/connection';
import {
  Activite,
  ActiviteDetail,
  CompetenceDetail,
  NiveauMaitrise,
  ActiviteConnaissance,
  FamilleActivite,
  DossierSource,
  Formacode,
  MotCle,
  Metier,
  MetierActivite,
} from '../models';
import { HttpError } from '../types/api';
import { lirePagination, construireReponsePaginee } from '../middlewares/pagination';

/**
 * GET /api/activites/familles — l'arborescence de la page « Activités & compétences » :
 * les familles de la nomenclature, avec le nombre d'activités que chacune porte.
 *
 * Jointure interne volontaire : 5 des 39 familles de `nomencl_FAMACTIVITES` ne sont citées
 * par aucune activité (A.02 « Investigation », B.03 « Modelage », D.06, D.07, F.03). Les
 * lister donnerait des sections vides à déplier.
 */
export async function listerFamillesActivite(_req: Request, res: Response): Promise<void> {
  const familles = await sequelize.query<{
    codeFamilleActivite: string;
    domaine1: string | null;
    domaine2: string | null;
    domaine3: string | null;
    nbActivites: number;
  }>(
    `SELECT fa.code_famille_activite AS codeFamilleActivite,
            fa.domaine_1             AS domaine1,
            fa.domaine_2             AS domaine2,
            fa.domaine_3             AS domaine3,
            COUNT(*)                 AS nbActivites
       FROM famille_activite fa
       JOIN activite a ON a.code_famille_activite = fa.code_famille_activite
      GROUP BY fa.code_famille_activite, fa.domaine_1, fa.domaine_2, fa.domaine_3
      ORDER BY fa.code_famille_activite ASC`,
    { type: QueryTypes.SELECT },
  );

  res.json({ data: familles });
}

/** GET /api/activites?search=&famille=&formacode=&page=&limit= */
export async function listerActivites(req: Request, res: Response): Promise<void> {
  const pagination = lirePagination(req);
  const { search, famille, formacode } = req.query;

  const where: WhereOptions<InferAttributes<Activite>> = {};
  if (famille) where.codeFamilleActivite = String(famille);
  if (search) {
    const terme = `%${String(search)}%`;
    Object.assign(where, {
      [Op.or]: [
        { intituleActivite: { [Op.like]: terme } },
        { intituleCompetence: { [Op.like]: terme } },
      ],
    });
  }

  // Les connaissances pendent du couple, plus du catalogue (migration 008) : le filtre
  // par formacode passe donc par une sous-requête, une jointure directe n'étant plus
  // possible depuis `activite`.
  if (formacode) {
    where.codeActivite = {
      [Op.in]: sequelize.literal(
        `(SELECT DISTINCT ma.code_activite
            FROM metier_activite ma
            JOIN activite_connaissance ac ON ac.metier_activite_id = ma.id
           WHERE ac.code_formacode = ${sequelize.escape(String(formacode))})`,
      ),
    } as never;
  }

  const { rows, count } = await Activite.findAndCountAll({
    where,
    include: [
      { model: FamilleActivite, as: 'famille' },
      { model: DossierSource, as: 'dossierSource' },
    ],
    order: [['codeActivite', 'ASC']],
    limit: pagination.limit,
    offset: pagination.offset,
    distinct: true,
  });

  res.json(construireReponsePaginee(rows, count, pagination));
}

/**
 * GET /api/activites/:code — l'entrée de catalogue et ses emplois.
 *
 * Depuis la migration 006, le contenu rédactionnel (intitulés, tâches, mots-clés) ne
 * pend plus du code activité mais du couple : 121 codes sont formulés différemment
 * selon le métier. On renvoie donc le catalogue d'un côté, et de l'autre la liste des
 * couples qui emploient ce code, chacun avec sa rédaction propre.
 */
export async function obtenirActivite(
  req: Request<{ code: string }>,
  res: Response,
): Promise<void> {
  const activite = await Activite.findByPk(req.params.code, {
    include: [
      { model: FamilleActivite, as: 'famille' },
      { model: DossierSource, as: 'dossierSource' },
    ],
  });

  if (!activite) throw HttpError.notFound(`Activité ${req.params.code}`);

  const couples = await MetierActivite.findAll({
    where: { codeActivite: req.params.code },
    include: [
      { model: Metier, as: 'metier', attributes: ['codeMetier', 'intitule', 'codeFamille'] },
      { model: ActiviteDetail, as: 'detailsActivite', separate: true, order: [['ordre', 'ASC']] },
      {
        model: CompetenceDetail,
        as: 'detailsCompetence',
        separate: true,
        order: [['ordre', 'ASC']],
      },
      { model: NiveauMaitrise, as: 'niveauxMaitrise', separate: true, order: [['niveau', 'ASC']] },
      { model: MotCle, as: 'motsCles', through: { attributes: ['ordre'] } },
      {
        model: ActiviteConnaissance,
        as: 'connaissances',
        separate: true,
        order: [['ordre', 'ASC']],
        include: [{ model: Formacode, as: 'formacode' }],
      },
    ],
    order: [['codeMetier', 'ASC']],
  });

  res.json({ ...activite.toJSON(), couples });
}
