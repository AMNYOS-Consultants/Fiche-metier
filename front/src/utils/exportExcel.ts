import { obtenirExportGeneral } from '@/api/export';
import type { WorkSheet } from 'xlsx';

// ---------- Export général de la base — un seul fichier .xlsx ----------
//
// `xlsx` (SheetJS) est chargé à la demande (il ne pèse que sur ce clic, jamais sur le
// bundle principal — même logique que `docx` pour l'export Word). Le fichier généré via
// `exceljs` s'est révélé illisible pour Excel malgré une structure OOXML rigoureusement
// valide (ZIP CRC-clean, XML bien formé, Content_Types/rels cohérents) — SheetJS est le
// standard de facto côté navigateur, éprouvé en production pour sa fidélité à l'ouverture
// dans Excel. Ce paquet porte une vulnérabilité haute non corrigée (prototype pollution /
// ReDoS à l'analyse d'un classeur non fiable, voir GHSA-4r6h-8v6p-xvw6) : sans objet ici,
// cet écran ne fait qu'écrire un classeur, jamais en lire un.

type ValeurCellule = string | number | null;

interface ColonneFeuille {
  entete: string;
  largeur: number;
}

/** `dureeHeures` arrive en chaîne (DECIMAL Sequelize sérialisé en JSON) — voir metier.controller.ts. */
function versNombre(valeur: string | number | null): number | null {
  if (valeur === null) return null;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
}

async function ajouterFeuille(
  XLSX: typeof import('xlsx'),
  classeur: import('xlsx').WorkBook,
  nom: string,
  colonnes: ColonneFeuille[],
  lignes: ValeurCellule[][],
): Promise<WorkSheet> {
  const feuille = XLSX.utils.aoa_to_sheet([colonnes.map((c) => c.entete), ...lignes]);
  feuille['!cols'] = colonnes.map((c) => ({ wch: c.largeur }));
  // Feuille au nom > 31 caractères ou avec des caractères interdits ([]:*?/\) : Excel refuse
  // le classeur entier à l'ouverture — aucun des noms utilisés ici n'en comporte, mais la
  // limite de longueur est ce qui a fait échouer le format XML SpreadsheetML précédent sur
  // un nom trop long, gardée ici en commentaire pour mémoire.
  XLSX.utils.book_append_sheet(classeur, feuille, nom.slice(0, 31));
  return feuille;
}

/**
 * Export général de la base, en un seul fichier .xlsx : métiers, couples
 * activité-compétence, domaines de connaissance, ressources transverses, conditions
 * d'exercice et conditions d'accès — les tables sources de l'app, pas les tables
 * calculées (passerelles).
 */
export async function exporterBaseGeneraleExcel(): Promise<void> {
  const donnees = await obtenirExportGeneral();
  const XLSX = await import('xlsx');
  const classeur = XLSX.utils.book_new();

  await ajouterFeuille(
    XLSX,
    classeur,
    'Métiers',
    [
      { entete: 'Code métier', largeur: 12 },
      { entete: 'Intitulé', largeur: 40 },
      { entete: 'Famille', largeur: 30 },
      { entete: 'Définition', largeur: 60 },
      { entete: 'Responsabilités transversales', largeur: 16 },
      { entete: 'Interface amont/aval', largeur: 20 },
      { entete: 'Dossier source', largeur: 30 },
      { entete: 'Dossier (autre)', largeur: 20 },
      { entete: 'Rédacteur', largeur: 20 },
      { entete: 'Nb couples', largeur: 10 },
    ],
    donnees.metiers.map((m) => [
      m.codeMetier,
      m.intitule,
      m.famille?.intitule ?? null,
      m.definition,
      m.responsTransverse,
      m.interfaceAmontAval,
      m.dossierSource?.libelle ?? null,
      m.dossierAutre,
      m.redacteur,
      m.nbCouple,
    ]),
  );

  await ajouterFeuille(
    XLSX,
    classeur,
    'Couples activité-compétence',
    [
      { entete: 'Code métier', largeur: 12 },
      { entete: 'Ordre', largeur: 8 },
      { entete: 'Code activité', largeur: 14 },
      { entete: 'Intitulé activité', largeur: 40 },
      { entete: 'Intitulé compétence', largeur: 40 },
    ],
    donnees.couples.map((c) => [c.codeMetier, c.ordre, c.codeActivite, c.intituleActivite, c.intituleCompetence]),
  );

  await ajouterFeuille(
    XLSX,
    classeur,
    'Domaines de connaissance',
    [
      { entete: 'Code métier', largeur: 12 },
      { entete: 'Code activité (couple)', largeur: 14 },
      { entete: 'Ordre couple', largeur: 10 },
      { entete: 'Formacode', largeur: 10 },
      { entete: 'Intitulé', largeur: 40 },
      { entete: 'Niveau', largeur: 8 },
      { entete: 'Durée (h)', largeur: 10 },
      { entete: 'NSF', largeur: 8 },
      { entete: 'Fondamental', largeur: 10 },
    ],
    donnees.connaissances.map((c) => [
      c.couple?.codeMetier ?? null,
      c.couple?.codeActivite ?? null,
      c.couple?.ordre ?? null,
      c.codeFormacode,
      c.intitule,
      c.niveau,
      versNombre(c.dureeHeures),
      c.codeNsf,
      c.estFondamental ? 'Oui' : 'Non',
    ]),
  );

  await ajouterFeuille(
    XLSX,
    classeur,
    'Ressources transverses',
    [
      { entete: 'Code métier', largeur: 12 },
      { entete: 'Ressource', largeur: 40 },
      { entete: 'Groupe', largeur: 25 },
      { entete: 'Niveau', largeur: 8 },
      { entete: 'Non concerné', largeur: 12 },
    ],
    donnees.transversales.map((t) => [
      t.codeMetier,
      t.competence?.libelle ?? t.codeTransversale,
      t.competence?.groupe ?? null,
      t.niveau,
      t.nonConcerne ? 'Oui' : 'Non',
    ]),
  );

  await ajouterFeuille(
    XLSX,
    classeur,
    'Conditions exercice',
    [
      { entete: 'Code métier', largeur: 12 },
      { entete: 'Condition', largeur: 45 },
      { entete: 'Valeur', largeur: 16 },
    ],
    donnees.conditions.map((c) => [
      c.codeMetier,
      c.critere?.libelle ?? c.codeCondition,
      c.valeur === 'significatif' ? 'Significatif' : 'Non significatif',
    ]),
  );

  await ajouterFeuille(
    XLSX,
    classeur,
    'Conditions accès',
    [
      { entete: 'Code métier', largeur: 12 },
      { entete: 'Condition d’accès', largeur: 60 },
      { entete: 'Valeur', largeur: 40 },
    ],
    donnees.acces.map((a) => [a.codeMetier, a.critere?.libelle ?? a.codeAcces, a.valeur]),
  );

  const tampon = XLSX.write(classeur, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([tampon], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = 'export-base-fiches-metiers.xlsx';
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
  URL.revokeObjectURL(url);
}
