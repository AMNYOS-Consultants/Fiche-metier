import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import {
  FamilleMetier,
  FamilleActivite,
  CritereCondition,
  CompetenceTransversale,
  CritereAcces,
  DossierSource,
  Nsf,
  Rome,
  sequelize,
} from '../models';

/**
 * GET /api/referentiels — toutes les nomenclatures en un appel.
 * Ces tables sont petites (< 100 lignes au total) et alimentent tous les filtres du front :
 * un seul aller-retour au démarrage évite 7 requêtes.
 */
export async function listerReferentiels(_req: Request, res: Response): Promise<void> {
  const [familles, famillesActivite, conditions, transversales, acces, dossiers, nsf, rome, usages] =
    await Promise.all([
      FamilleMetier.findAll({ order: [['codeFamille', 'ASC']] }),
      FamilleActivite.findAll({ order: [['codeFamilleActivite', 'ASC']] }),
      CritereCondition.findAll({ order: [['ordre', 'ASC']] }),
      CompetenceTransversale.findAll({ order: [['ordre', 'ASC']] }),
      CritereAcces.findAll({ order: [['ordre', 'ASC']] }),
      DossierSource.findAll({ order: [['libelle', 'ASC']] }),
      Nsf.findAll({ order: [['codeNsf', 'ASC']] }),
      Rome.findAll({ order: [['codeRome', 'ASC']] }),
      // Le référentiel ROME compte 1 911 fiches, dont une centaine seulement est citée par
      // une fiche métier. `nbMetiers` permet au filtre de la page Métiers de ne proposer que
      // les codes qui ramèneraient un résultat, là où le sélecteur d'une fiche doit garder
      // le référentiel entier.
      sequelize.query<{ codeRome: string; nbMetiers: number }>(
        `SELECT code_rome AS codeRome, COUNT(*) AS nbMetiers
           FROM metier_rome GROUP BY code_rome`,
        { type: QueryTypes.SELECT },
      ),
    ]);

  const nbParCode = new Map(usages.map((u) => [u.codeRome, Number(u.nbMetiers)]));

  res.json({
    famillesMetier: familles,
    famillesActivite,
    conditions,
    transversales,
    acces,
    dossiersSource: dossiers,
    nsf,
    rome: rome.map((r) => ({ ...r.toJSON(), nbMetiers: nbParCode.get(r.codeRome) ?? 0 })),
  });
}

/**
 * GET /api/referentiels/rome — les codes ROME et les fiches qui les citent.
 *
 * Le référentiel entier (1 911 codes, dont 136 cités par une fiche) tient dans une réponse
 * — deux colonnes courtes par ligne : la page filtre côté client. Une jointure à plat
 * plutôt qu'un `include` sur deux niveaux, puis regroupement par code ici.
 */
export async function listerRome(_req: Request, res: Response): Promise<void> {
  const [codes, liens] = await Promise.all([
    Rome.findAll({ order: [['codeRome', 'ASC']] }),
    sequelize.query<{ codeRome: string; codeMetier: string; intitule: string }>(
      `SELECT mr.code_rome AS codeRome, m.code_metier AS codeMetier, m.intitule
         FROM metier_rome mr
         JOIN metier m ON m.code_metier = mr.code_metier
        ORDER BY mr.code_rome, m.code_metier`,
      { type: QueryTypes.SELECT },
    ),
  ]);

  const metiersParCode = new Map<string, Array<{ codeMetier: string; intitule: string }>>();
  for (const { codeRome, codeMetier, intitule } of liens) {
    const liste = metiersParCode.get(codeRome) ?? [];
    liste.push({ codeMetier, intitule });
    metiersParCode.set(codeRome, liste);
  }

  res.json({
    data: codes.map((c) => ({
      codeRome: c.codeRome,
      libelle: c.libelle,
      metiers: metiersParCode.get(c.codeRome) ?? [],
    })),
  });
}

