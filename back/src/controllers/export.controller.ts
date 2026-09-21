import { Request, Response } from 'express';
import { lireBase, versionSchema } from '../services/classeur/lecture';
import { ecrireClasseur, nomFichier } from '../services/classeur/ecriture';

/**
 * GET /api/export/general — la base entière en un classeur .xlsx, une feuille par table.
 *
 * Le classeur est produit ici et non côté front, parce que l'import le relit : une seule
 * définition de feuilles et de colonnes (`services/classeur/schema.ts`) sert aux deux
 * sens. Tant que l'écriture vivait dans le front et la lecture dans le back, deux listes
 * de colonnes coexistaient, et leur divergence aurait cassé l'aller-retour en silence.
 *
 * Ce que l'export ne contient pas, et pourquoi, est documenté par `HORS_CLASSEUR`
 * (`services/classeur/lecture.ts`) — et repris dans la feuille « Lisez-moi » du fichier.
 */
export async function exporterGeneral(_req: Request, res: Response): Promise<void> {
  const exporteLe = new Date().toISOString();
  const [contenu, version] = await Promise.all([lireBase(), versionSchema()]);
  const classeur = ecrireClasseur(contenu, { exporteLe, versionSchema: version });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${nomFichier(exporteLe)}"`);
  // Le front lit cet en-tête pour afficher la version du schéma sans rouvrir le fichier.
  res.setHeader('X-Version-Schema', version ?? '');
  res.send(classeur);
}
