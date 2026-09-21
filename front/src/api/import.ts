import { apiPostFichier, ApiError } from './client';
import type { RapportImport } from '@/types/importGeneral';

/**
 * Analyse à blanc du classeur d'échange : n'écrit rien, rend le détail de ce qui serait
 * fait (ajouts/modifications/suppressions par table, anomalies bloquantes le cas échéant).
 */
export function verifierImportGeneral(fichier: File, signal?: AbortSignal) {
  return apiPostFichier<RapportImport>('/import/general/verification', fichier, signal);
}

/**
 * Applique le classeur, dans une transaction unique côté back. Répond 422 (et non une
 * erreur réseau) quand le fichier porte des anomalies : c'est un rapport valide à
 * afficher, pas un échec de la requête — d'où l'appel direct plutôt que
 * `apiPostFichier`, qui aurait levé sur ce statut. Cela ne devrait normalement pas
 * arriver dans ce flux (on n'applique qu'un fichier déjà vérifié sans anomalie), mais un
 * fichier resoumis après une modification de la base entre-temps peut en révéler.
 */
export async function appliquerImportGeneral(
  fichier: File,
  signal?: AbortSignal,
): Promise<RapportImport> {
  const reponse = await fetch('/api/import/general/application', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    credentials: 'include',
    body: fichier,
    signal,
  });

  const corps = await reponse.json().catch(() => null);

  if (reponse.status === 200 || reponse.status === 422) {
    if (!corps) throw new ApiError(reponse.status, 'Réponse illisible du serveur');
    return corps as RapportImport;
  }

  throw new ApiError(
    reponse.status,
    corps?.error?.message ?? `Erreur ${reponse.status}`,
    corps?.error?.code,
  );
}
