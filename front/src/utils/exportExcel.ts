import { apiGetFichier } from '@/api/client';

/**
 * Export général de la base : télécharge le classeur .xlsx produit par le back
 * (`back/src/controllers/export.controller.ts`, `services/classeur/ecriture.ts`) — 23
 * feuilles, une par table source, plus un « Lisez-moi ».
 *
 * Le classeur n'est plus généré ici. Il l'a été un temps (via SheetJS, `xlsx`), mais
 * l'import général doit relire exactement ce que l'export écrit : une seule définition de
 * colonnes (`services/classeur/schema.ts`, côté back) sert désormais aux deux sens. Un
 * export généré côté client aurait tôt ou tard divergé de ce que l'import sait lire. Ce
 * fichier ne fait donc plus que déclencher le téléchargement du fichier reçu tel quel —
 * aucune dépendance à `xlsx` côté front.
 */
export async function exporterBaseGeneraleExcel(): Promise<void> {
  const { blob, nomFichier } = await apiGetFichier(
    '/export/general',
    'export-base-fiches-metiers.xlsx',
  );

  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
  URL.revokeObjectURL(url);
}
