// ---------- Import général de la base (POST /import/general/verification|application) ----------
//
// Miroir de `back/src/services/classeur/import.service.ts` — voir ce fichier pour le
// détail de chaque champ. Les deux routes rendent la même forme : la vérification ne
// fait que remplir `applique: false`, l'application le bascule à `true` une fois écrit.

export interface AnomalieImport {
  feuille?: string;
  /** Numéro de ligne dans le tableur (1 = en-têtes). */
  ligne?: number;
  colonne?: string;
  message: string;
}

export interface DiffTable {
  cle: string;
  feuille: string;
  table: string;
  lues: number;
  ajouts: number;
  modifications: number;
  suppressions: number;
  inchangees: number;
  exemples: { ajouts: string[]; modifications: string[]; suppressions: string[] };
}

export interface RapportImport {
  meta: {
    exporteLe: string | null;
    versionSchemaFichier: string | null;
    versionSchemaBase: string | null;
  };
  anomalies: AnomalieImport[];
  avertissements: string[];
  tables: DiffTable[];
  totaux: { lues: number; ajouts: number; modifications: number; suppressions: number };
  applique: boolean;
  /** Métiers dont les passerelles seront à recalculer une fois l'import appliqué. */
  metiersARecalculer: number;
}
