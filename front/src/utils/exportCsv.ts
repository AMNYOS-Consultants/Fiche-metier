import { listerFormacodes } from '@/api/activites';
import type { FiltresFormacodes } from '@/api/activites';
import type { Formacode } from '@/types/api';

// Point-virgule et non virgule : c'est le séparateur que le Excel français reconnaît
// d'office à l'ouverture d'un .csv (la virgule y est déjà le séparateur décimal).
const SEPARATEUR = ';';

function echapper(valeur: string): string {
  if (/[";\n]/.test(valeur)) return `"${valeur.replace(/"/g, '""')}"`;
  return valeur;
}

function ligneCsv(champs: string[]): string {
  return champs.map(echapper).join(SEPARATEUR);
}

/** En-tête + lignes -> texte CSV complet, BOM inclus (sans lui Excel lit les accents en Latin-1). */
function construireCsv(entete: string[], lignes: string[][]): string {
  const contenu = [ligneCsv(entete), ...lignes.map(ligneCsv)].join('\r\n');
  return '﻿' + contenu;
}

function telechargerBlob(blob: Blob, nomFichier: string): void {
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
  URL.revokeObjectURL(url);
}

/** Toutes les pages, dans la limite du filtre donné — la pagination reste un détail d'affichage. */
async function chargerTousLesFormacodes(filtres: FiltresFormacodes): Promise<Formacode[]> {
  const limit = 200;
  const premiere = await listerFormacodes({ ...filtres, page: 1, limit });
  const donnees = [...premiere.data];

  for (let page = 2; page <= premiere.pagination.totalPages; page++) {
    const suite = await listerFormacodes({ ...filtres, page, limit });
    donnees.push(...suite.data);
  }

  return donnees;
}

/**
 * Export simple de la page Domaines de connaissance : formacode, intitulé, NSF, fondamental.
 * Respecte la recherche/le filtre NSF actifs sur la page — pas de filtre revient à tout exporter.
 */
export async function exporterFormacodesCsv(filtres: FiltresFormacodes): Promise<void> {
  const formacodes = await chargerTousLesFormacodes(filtres);

  const csv = construireCsv(
    ['Formacode', 'Intitulé', 'NSF', 'Fondamental'],
    formacodes.map((f) => [f.codeFormacode, f.intitule, f.codeNsf ?? '', f.estFondamental ? 'Oui' : 'Non']),
  );

  telechargerBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'domaines-de-connaissance.csv');
}
