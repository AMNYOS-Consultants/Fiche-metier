import { Request, Response } from 'express';
import { z } from 'zod';
import { Metier } from '../models';
import { HttpError } from '../types/api';
import {
  listerActivitesAjoutables,
  listerVariantes,
  ajouterCouple,
  supprimerCouple,
  creerCoupleActivite,
} from '../services/couple.service';
import { recalculerProximites, etatProximites } from '../services/passerelle.service';

async function exigerMetier(code: string): Promise<void> {
  const metier = await Metier.findByPk(code, { attributes: ['codeMetier'] });
  if (!metier) throw HttpError.notFound(`Métier ${code}`);
}

/**
 * GET /api/metiers/:code/couples-ajoutables?search=
 * Le catalogue des activités que cette fiche ne porte pas encore.
 */
export async function listerAjoutables(
  req: Request<{ code: string }>,
  res: Response,
): Promise<void> {
  await exigerMetier(req.params.code);
  const recherche = req.query.search ? String(req.query.search) : undefined;
  res.json({ data: await listerActivitesAjoutables(req.params.code, recherche) });
}

/**
 * GET /api/metiers/:code/couples-ajoutables/:codeActivite
 * Les rédactions existantes de ce code activité, avec leurs formacodes : l'ajout en recopie
 * une, et elles diffèrent d'une fiche à l'autre pour la moitié des codes partagés.
 */
export async function listerVariantesActivite(
  req: Request<{ code: string; codeActivite: string }>,
  res: Response,
): Promise<void> {
  await exigerMetier(req.params.code);
  const variantes = await listerVariantes(req.params.codeActivite, req.params.code);
  if (variantes.length === 0) {
    throw HttpError.notFound(`Aucune rédaction disponible pour ${req.params.codeActivite}`);
  }
  res.json({ data: variantes });
}

const schemaAjout = z.object({
  /** Le couple à recopier, choisi parmi les variantes proposées. */
  coupleSourceId: z.number().int().positive(),
});

/** POST /api/metiers/:code/couples — ajoute un couple en recopiant une rédaction existante. */
export async function ajouter(req: Request<{ code: string }>, res: Response): Promise<void> {
  await exigerMetier(req.params.code);
  const { coupleSourceId } = schemaAjout.parse(req.body);
  const couple = await ajouterCouple(req.params.code, coupleSourceId);
  res.status(201).json(couple);
}

const CODE_FAMILLE = /^[A-Z]\.\d{2}$/;
const CODE_HALO = /^[A-Z]\.\d{2}\.\d{2}$/;

const schemaCreation = z
  .object({
    codeMetier: z.string().trim().min(1).max(10),
    /** Un seul emplacement : famille -> nouvelle activité, halo -> nouvelle déclinaison. */
    famille: z.string().trim().regex(CODE_FAMILLE).optional(),
    halo: z.string().trim().regex(CODE_HALO).optional(),
    /** Crée le 2e segment, sous une lettre existante ou nouvelle. */
    nouvelleFamille: z
      .object({
        lettre: z.string().trim().regex(/^[A-Za-z]$/),
        domaine1: z.string().trim().min(1).max(255).optional(),
        domaine2: z.string().trim().min(1).max(255),
        domaine3: z.string().trim().max(2000).optional(),
      })
      .optional(),
    intituleActivite: z.string().trim().min(1).max(500),
    intituleCompetence: z.string().trim().max(500).nullable(),
    detailsActivite: z.array(z.string().trim().min(1).max(500)).max(9),
    detailsCompetence: z.array(z.string().trim().min(1).max(500)).max(9),
    niveauxMaitrise: z
      .array(
        z.object({
          niveau: z.number().int().min(1).max(4),
          description: z.string().trim().min(1).max(1000),
        }),
      )
      .max(4),
    connaissances: z
      .array(
        z.object({
          codeFormacode: z.string().trim().min(1).max(10),
          niveau: z.number().int().min(1).max(4).nullable(),
        }),
      )
      .max(20),
  })
  .refine(
    (d) =>
      [d.famille, d.halo, d.nouvelleFamille].filter((v) => v !== undefined).length === 1,
    {
      message: 'Indiquer un seul emplacement : une famille, un halo, ou une nouvelle famille.',
    },
  );

/**
 * POST /api/activites — crée un couple activité-compétence de toutes pièces : l'entrée de
 * catalogue et son rattachement à une fiche métier. Le code est attribué par le serveur.
 */
export async function creer(req: Request, res: Response): Promise<void> {
  const donnees = schemaCreation.parse(req.body);
  const resultat = await creerCoupleActivite(donnees);
  res.status(201).json(resultat);
}

/** DELETE /api/metiers/:code/couples/:id */
export async function supprimer(
  req: Request<{ code: string; id: string }>,
  res: Response,
): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw HttpError.badRequest('Identifiant de couple invalide');

  await exigerMetier(req.params.code);
  await supprimerCouple(req.params.code, id);
  res.status(204).end();
}

/** GET /api/metiers/:code/proximites/etat — les passerelles de la fiche sont-elles périmées ? */
export async function obtenirEtatProximites(
  req: Request<{ code: string }>,
  res: Response,
): Promise<void> {
  await exigerMetier(req.params.code);
  res.json(await etatProximites(req.params.code));
}

/**
 * POST /api/passerelles/recalculer — rejoue `recalculerProximites()` (~110 000 lignes).
 * Déclenché par l'utilisateur depuis le bandeau de la fiche : le calcul est trop lourd pour
 * être joué à chaque ajout ou suppression de couple.
 */
export async function recalculer(_req: Request, res: Response): Promise<void> {
  const { lignes } = await recalculerProximites();
  res.json({ lignes, calculeLe: new Date().toISOString() });
}
