import { Router, raw } from 'express';
import { asyncHandler } from '../middlewares/asyncHandler';
import { verifierImport, appliquerImport } from '../controllers/import.controller';

export const importRoutes = Router();

/**
 * Le classeur arrive en corps brut : le type MIME .xlsx, mais aussi le generique
 * `application/octet-stream` que certains navigateurs posent sur un fichier glisse.
 *
 * 64 Mo : l'export de la base pese ~14 Mo aujourd'hui, la marge laisse de la place a une
 * base qui double sans ouvrir la porte a un corps arbitrairement gros.
 */
const fichierXlsx = raw({
  type: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
  ],
  limit: '64mb',
});

importRoutes.post('/general/verification', fichierXlsx, asyncHandler(verifierImport));
importRoutes.post('/general/application', fichierXlsx, asyncHandler(appliquerImport));
