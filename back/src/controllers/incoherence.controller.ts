import { Request, Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../types/api';
import {
  listerIncoherences,
  obtenirVariantes,
  harmoniserCouple,
  scinderVariante,
  modifierRedactionVariante,
} from '../services/incoherence.service';
import { modifierConnaissancesCouple } from '../services/couple.service';

/** GET /api/activites/incoherences */
export async function lister(_req: Request, res: Response): Promise<void> {
  res.json({ data: await listerIncoherences() });
}

/** GET /api/activites/:codeActivite/variantes */
export async function obtenir(
  req: Request<{ codeActivite: string }>,
  res: Response,
): Promise<void> {
  res.json({ data: await obtenirVariantes(req.params.codeActivite) });
}

const schemaEdition = z.object({
  intituleActivite: z.string().trim().max(500).nullable(),
  intituleCompetence: z.string().trim().max(500).nullable(),
  // ACT_DET_1..9 / COMP_DET_1..9 : neuf blocs au maximum dans la source.
  detailsActivite: z.array(z.string().trim().min(1).max(500)).max(9),
  detailsCompetence: z.array(z.string().trim().min(1).max(500)).max(9),
  // NIV_MATR_1..4 : quatre paliers au maximum.
  niveauxMaitrise: z
    .array(z.object({ niveau: z.number().int().min(1).max(4), description: z.string().trim().min(1).max(1000) }))
    .max(4),
});

const schemaHarmonisation = z.object({
  coupleModeleId: z.number().int().positive(),
  /** Si fourni, réécrit le couple modèle avant de le propager — voir le service. */
  edition: schemaEdition.optional(),
});

/** PUT /api/activites/:codeActivite/harmoniser */
export async function harmoniser(
  req: Request<{ codeActivite: string }>,
  res: Response,
): Promise<void> {
  const { coupleModeleId, edition } = schemaHarmonisation.parse(req.body);
  const resultat = await harmoniserCouple(req.params.codeActivite, coupleModeleId, edition);
  res.json(resultat);
}

const schemaRedaction = z.object({
  coupleModeleId: z.number().int().positive(),
  edition: schemaEdition,
});

/**
 * PUT /api/activites/:codeActivite/redaction — réécrit une rédaction sur les seuls couples
 * qui la portent, sans toucher aux autres rédactions du même code.
 */
export async function modifierRedaction(
  req: Request<{ codeActivite: string }>,
  res: Response,
): Promise<void> {
  const { coupleModeleId, edition } = schemaRedaction.parse(req.body);
  const resultat = await modifierRedactionVariante(req.params.codeActivite, coupleModeleId, edition);
  res.json(resultat);
}

const schemaConnaissances = z.object({
  connaissances: z
    .array(
      z.object({
        codeFormacode: z.string().trim().min(1).max(10),
        niveau: z.number().int().min(1).max(4).nullable(),
      }),
    )
    .max(20),
});

/**
 * PUT /api/activites/:codeActivite/couples/:id/connaissances — les domaines de connaissance
 * d'un couple. Portée volontairement limitée à un couple : ils diffèrent d'un métier à
 * l'autre pour un même code activité (voir couple.service.ts).
 */
export async function modifierConnaissances(
  req: Request<{ codeActivite: string; id: string }>,
  res: Response,
): Promise<void> {
  const coupleId = Number(req.params.id);
  if (!Number.isInteger(coupleId) || coupleId <= 0) {
    throw HttpError.badRequest('Identifiant de couple invalide');
  }

  const { connaissances } = schemaConnaissances.parse(req.body);
  const apres = await modifierConnaissancesCouple(req.params.codeActivite, coupleId, connaissances);
  res.json({ data: apres });
}

/**
 * POST /api/activites/:codeActivite/scinder — l'autre issue à une incohérence : détacher
 * la rédaction divergente vers un nouveau code du même halo, au lieu de l'aligner.
 */
export async function scinder(
  req: Request<{ codeActivite: string }>,
  res: Response,
): Promise<void> {
  const { coupleModeleId, edition } = schemaHarmonisation.parse(req.body);
  const resultat = await scinderVariante(req.params.codeActivite, coupleModeleId, edition);
  res.status(201).json(resultat);
}
