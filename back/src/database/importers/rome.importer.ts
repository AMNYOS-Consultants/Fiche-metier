import path from 'node:path';
import { env } from '../../config/env';
import { sequelize, Rome, ImportBatch } from '../../models';
import { lireFeuilleBrute, nomsFeuilles, texte } from './xlsxReader';

/**
 * Référentiel ROME (France Travail) — « Arborescence principale » : 14 grands domaines,
 * 110 domaines professionnels, 1 911 fiches ROME et leurs 14 301 appellations, tous dans
 * une seule feuille de 16 336 lignes.
 *
 * Avant cet importeur, la table `rome` n'était pas un référentiel : elle se remplissait à
 * la volée depuis les codes cités par les fiches (`Rome.findOrCreate`, metiers.importer.ts),
 * sans rien qui les valide. C'est ainsi qu'un `I130` tronqué avait pu y entrer.
 */

/** Le nom de la feuille porte sa date de livraison : on la retrouve par préfixe. */
const PREFIXE_FEUILLE = 'Arbo Principale';

/** Colonnes (index 0) : A grand domaine, B domaine pro, C fiche, D code, E intitulé, F code OGR. */
const COL = { code: 3, intitule: 4 } as const;

/** Une fiche ROME : lettre + 4 chiffres. Les autres lignes sont des domaines ou des appellations. */
const CODE_FICHE = /^[A-Z]\d{4}$/;

export interface BilanImportRome {
  lignesLues: number;
  fiches: number;
  ajoutes: number;
  libellesRemplaces: number;
  /** Codes présents en base mais absents du référentiel livré — jamais supprimés, voir plus bas. */
  absentsDuReferentiel: string[];
}

/**
 * Charge les 1 911 fiches et écrase les libellés existants.
 *
 * L'intitulé retenu est celui de la **première ligne** de chaque code : c'est l'intitulé
 * principal de la fiche, les lignes suivantes étant ses appellations. Vérifié sur la
 * totalité du classeur — cette première ligne est aussi la seule en gras, pour les
 * 1 911 codes sans exception.
 *
 * Aucun code n'est supprimé, même absent du référentiel livré : `metier_rome` référence
 * `rome` en `ON DELETE CASCADE` (migration 009), une purge retirerait donc silencieusement
 * des codes ROME de fiches métier. Les absents sont signalés dans le bilan, à traiter à la
 * main.
 */
export async function importerRome(): Promise<BilanImportRome> {
  const fichier = path.resolve(__dirname, '../../..', env.xlsx.rome);

  const feuille =
    nomsFeuilles(fichier).find((n) => n.startsWith(PREFIXE_FEUILLE)) ?? PREFIXE_FEUILLE;
  const lignes = lireFeuilleBrute(fichier, feuille);

  const batch = await ImportBatch.create({
    fichier: path.basename(fichier),
    feuille,
    version: null,
    lignesLues: lignes.length - 1,
    rapport: null,
    termineLe: null,
  });

  try {
    // Première ligne gagnante : c'est l'intitulé de la fiche, pas une de ses appellations.
    const principaux = new Map<string, string>();
    for (const ligne of lignes.slice(1)) {
      const code = texte(ligne[COL.code]);
      if (!code || !CODE_FICHE.test(code)) continue;
      if (principaux.has(code)) continue;
      const intitule = texte(ligne[COL.intitule]);
      if (intitule) principaux.set(code, intitule);
    }

    const bilan: BilanImportRome = {
      lignesLues: lignes.length - 1,
      fiches: principaux.size,
      ajoutes: 0,
      libellesRemplaces: 0,
      absentsDuReferentiel: [],
    };

    await sequelize.transaction(async (transaction) => {
      const existants = new Map(
        (await Rome.findAll({ transaction })).map((r) => [r.codeRome, r.libelle]),
      );

      for (const [codeRome, libelle] of principaux) {
        const avant = existants.get(codeRome);
        if (avant === undefined) bilan.ajoutes += 1;
        else if (avant !== libelle) bilan.libellesRemplaces += 1;

        await Rome.upsert({ codeRome, libelle }, { transaction });
      }

      for (const code of existants.keys()) {
        if (!principaux.has(code)) bilan.absentsDuReferentiel.push(code);
      }
    });

    await batch.update({
      lignesOk: bilan.fiches,
      lignesErreur: bilan.absentsDuReferentiel.length,
      rapport: bilan,
      statut: 'termine',
      termineLe: new Date(),
    });

    return bilan;
  } catch (err) {
    await batch.update({ statut: 'echec', termineLe: new Date() });
    throw err;
  }
}

export function afficherBilanRome(bilan: BilanImportRome): void {
  console.log(`   ${bilan.lignesLues} lignes lues -> ${bilan.fiches} fiches ROME`);
  console.log(`   ${bilan.ajoutes} code(s) ajouté(s), ${bilan.libellesRemplaces} libellé(s) remplacé(s)`);
  if (bilan.absentsDuReferentiel.length > 0) {
    console.log(
      `   ⚠️  ${bilan.absentsDuReferentiel.length} code(s) en base absent(s) du référentiel, conservé(s) : ` +
        bilan.absentsDuReferentiel.join(', '),
    );
  }
}
