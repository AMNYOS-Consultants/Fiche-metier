import { Router } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import {
  listerMetiers,
  listerMetiersOptions,
  creerMetier,
  supprimerMetier,
  obtenirMetier,
  modifierMetier,
  modifierAppellations,
  modifierCodesRome,
  obtenirActivitesMetier,
  obtenirConnaissancesMetier,
} from '../controllers/metier.controller';
import {
  listerAjoutables,
  listerVariantesActivite,
  ajouter,
  supprimer,
  obtenirEtatProximites,
} from '../controllers/couple.controller';
import { modifierTransversales } from '../controllers/transversale.controller';
import { modifierConditions, modifierAcces } from '../controllers/condition.controller';

export const metierRoutes = Router();

metierRoutes.get('/', asyncHandler(listerMetiers));
metierRoutes.post('/', asyncHandler(creerMetier));
// Avant `/:code` : sinon Express résout `options` comme un code métier.
metierRoutes.get('/options', asyncHandler(listerMetiersOptions));
metierRoutes.get('/:code', asyncHandler(obtenirMetier));
metierRoutes.patch('/:code', asyncHandler(modifierMetier));
metierRoutes.delete('/:code', asyncHandler(supprimerMetier));
metierRoutes.get('/:code/activites', asyncHandler(obtenirActivitesMetier));
metierRoutes.get('/:code/connaissances', asyncHandler(obtenirConnaissancesMetier));

// Édition des couples activité-compétence de la fiche.
metierRoutes.get('/:code/couples-ajoutables', asyncHandler(listerAjoutables));
metierRoutes.get('/:code/couples-ajoutables/:codeActivite', asyncHandler(listerVariantesActivite));
metierRoutes.post('/:code/couples', asyncHandler(ajouter));
metierRoutes.delete('/:code/couples/:id', asyncHandler(supprimer));
metierRoutes.get('/:code/proximites/etat', asyncHandler(obtenirEtatProximites));

// Niveaux des ressources transverses — enregistrés en bloc, voir le contrôleur.
metierRoutes.put('/:code/transversales', asyncHandler(modifierTransversales));

// Conditions d'exercice et d'accès — chacune enregistrée en bloc, voir le contrôleur.
metierRoutes.put('/:code/conditions', asyncHandler(modifierConditions));
metierRoutes.put('/:code/acces', asyncHandler(modifierAcces));

// Appellations et codes ROME — remplacement en bloc, voir le contrôleur.
metierRoutes.put('/:code/appellations', asyncHandler(modifierAppellations));
metierRoutes.put('/:code/rome', asyncHandler(modifierCodesRome));
