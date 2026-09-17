import type { FamilleMetier } from '@/types/api';

/**
 * Libellé d'une famille métier préfixé de sa lettre : « A Conception, études, R&D… ».
 *
 * La lettre n'est pas stockée dans `intitule` — c'est déjà la clé primaire de la table.
 * La composer à l'affichage évite de la dupliquer en base, où elle finirait par diverger
 * du code au premier renommage.
 */
export function libelleFamille(
  famille: Pick<FamilleMetier, 'codeFamille' | 'intitule'> | null | undefined,
): string {
  if (!famille) return '';
  return `${famille.codeFamille} - ${famille.intitule}`;
}

/**
 * Date de dernière modification, en français court : « 17 sept. 2026, 15:05 ».
 *
 * Renvoie « date inconnue » plutôt qu'un vide ou un « non daté » : la formule doit se
 * suffire à elle-même quel que soit le libellé qui la précède, sans accord à faire.
 *
 * L'absence de date est un cas courant et non une anomalie : les tables n'ont été
 * horodatées qu'à la migration 012, et les lignes antérieures n'ont pas été datées
 * rétroactivement — les dater du jour de la migration aurait laissé croire que tout le
 * catalogue avait été modifié ce jour-là.
 */
export function dateModification(valeur: string | null | undefined): string {
  if (!valeur) return 'date inconnue';
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return 'date inconnue';
  return d.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
