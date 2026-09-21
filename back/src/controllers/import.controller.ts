import { Request, Response } from 'express';
import { HttpError } from '../types/api';
import { analyserClasseur, appliquerClasseur } from '../services/classeur/import.service';

/**
 * Import du classeur d'échange, en deux routes distinctes plutôt qu'un drapeau :
 *
 *   POST /api/import/general/verification — analyse à blanc, n'écrit rien
 *   POST /api/import/general/application  — applique, en une transaction
 *
 * Deux chemins séparés parce que l'import **synchronise** : il supprime en base ce qui
 * n'est pas dans le fichier. Un paramètre de requête mal recopié ne doit pas pouvoir
 * transformer une vérification en écriture.
 *
 * Le corps est le fichier lui-même (`Content-Type` .xlsx), reçu en brut : pas de
 * multipart, donc pas de second analyseur à sécuriser sur un chemin qui reçoit déjà un
 * fichier non fiable. La taille est plafonnée par `express.raw` dans app.ts.
 */

function tampon(req: Request): Buffer {
  const corps = req.body;
  if (!Buffer.isBuffer(corps) || corps.length === 0) {
    throw new HttpError(
      400,
      'Aucun fichier reçu dans le corps de la requête.',
      'FICHIER_MANQUANT',
    );
  }
  // Signature d'un ZIP : un .xlsx en est un. Écarte un fichier manifestement autre avant
  // de le donner à l'analyseur.
  if (corps[0] !== 0x50 || corps[1] !== 0x4b) {
    throw new HttpError(400, 'Le fichier reçu n’est pas un classeur .xlsx.', 'FICHIER_INVALIDE');
  }
  return corps;
}

export async function verifierImport(req: Request, res: Response): Promise<void> {
  res.json(await analyserClasseur(tampon(req)));
}

export async function appliquerImport(req: Request, res: Response): Promise<void> {
  const rapport = await appliquerClasseur(tampon(req));
  // Un fichier porteur d'anomalies n'est pas appliqué : le dire par un 422 plutôt que par
  // un 200 dont il faudrait inspecter le corps pour savoir si quelque chose a été écrit.
  res.status(rapport.applique ? 200 : 422).json(rapport);
}
