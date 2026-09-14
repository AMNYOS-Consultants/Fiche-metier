import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import {
  listerFormacodes,
  obtenirFormacode,
  creerFormacode,
  supprimerFormacode,
  modifierFormacodeNiveaux,
} from '../controllers/formacode.controller';

export const formacodeRoutes = Router();

formacodeRoutes.get('/', asyncHandler(listerFormacodes));
formacodeRoutes.post('/', asyncHandler(creerFormacode));
formacodeRoutes.get('/:code', asyncHandler(obtenirFormacode));
formacodeRoutes.delete('/:code', asyncHandler(supprimerFormacode));
formacodeRoutes.put('/:code/niveaux', asyncHandler(modifierFormacodeNiveaux));
