import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import {
  listerActivites,
  listerFamillesActivite,
  obtenirActivite,
} from '../controllers/activite.controller';
import {
  lister,
  obtenir,
  harmoniser,
  scinder,
  modifierRedaction,
  modifierConnaissances,
  modifierMotsCles,
} from '../controllers/incoherence.controller';
import { creer as creerCouple } from '../controllers/couple.controller';

export const activiteRoutes = Router();

activiteRoutes.get('/', asyncHandler(listerActivites));
// Création d'un couple de toutes pièces : entrée de catalogue + rattachement à une fiche.
activiteRoutes.post('/', asyncHandler(creerCouple));
// Avant `/:code` : sinon Express résout `incoherences`/`familles` comme un code activité.
activiteRoutes.get('/incoherences', asyncHandler(lister));
activiteRoutes.get('/familles', asyncHandler(listerFamillesActivite));
activiteRoutes.get('/:code', asyncHandler(obtenirActivite));

// Correction des rédactions divergentes d'un même code activité entre métiers.
activiteRoutes.get('/:codeActivite/variantes', asyncHandler(obtenir));
activiteRoutes.put('/:codeActivite/harmoniser', asyncHandler(harmoniser));
// L'autre issue : détacher la rédaction divergente vers un nouveau code du même halo.
activiteRoutes.post('/:codeActivite/scinder', asyncHandler(scinder));

// Édition depuis la page d'une activité : la rédaction d'une variante (sans toucher aux
// autres), et les domaines de connaissance d'un couple (ils pendent du couple, pas du code).
activiteRoutes.put('/:codeActivite/redaction', asyncHandler(modifierRedaction));
activiteRoutes.put('/:codeActivite/couples/:id/connaissances', asyncHandler(modifierConnaissances));
activiteRoutes.put('/:codeActivite/couples/:id/mots-cles', asyncHandler(modifierMotsCles));
