import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { listerReferentiels, listerRome } from '../controllers/referentiel.controller';

export const referentielRoutes = Router();

referentielRoutes.get('/', asyncHandler(listerReferentiels));
referentielRoutes.get('/rome', asyncHandler(listerRome));
