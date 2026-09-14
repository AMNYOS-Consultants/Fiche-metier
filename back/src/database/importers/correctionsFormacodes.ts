import { QueryTypes, Transaction } from 'sequelize';
import { sequelize, Formacode, ImportBatch } from '../../models';
import { marquerProximitePerimee } from '../../services/passerelle.service';

/**
 * Codes formacode erronés dans les classeurs sources, et le code à retenir à la place.
 *
 * Relevé par le métier sur l'export « Domaines de connaissance » (colonne « Commentaire »)
 * du 11/09/2026. Deux familles :
 *   - erreur de saisie : le code n'existe pas dans le thésaurus Formacode, l'intitulé
 *     importé est le code lui-même (aucun référentiel ne le connaissait) ;
 *   - doublon : le code existe mais désigne un domaine déjà présent sous son bon code.
 *
 * La correction s'applique APRÈS import (les trois classeurs citent ces codes) et reste
 * idempotente : un code déjà absent est simplement ignoré. Pour ajouter une correction,
 * une ligne ici suffit — puis `npm run db:corriger-formacodes`.
 */
export const CORRECTIONS_FORMACODES: ReadonlyArray<{
  ancien: string;
  nouveau: string;
  motif: string;
}> = [
  { ancien: '21407', nouveau: '31407', motif: 'Erreur de saisie' },
  { ancien: '31572', nouveau: '21572', motif: 'Erreur de saisie' },
  { ancien: '33652', nouveau: '32652', motif: 'Erreur de saisie' },
  { ancien: '34957', nouveau: '34597', motif: 'Erreur de saisie' },
  { ancien: '43619', nouveau: '46319', motif: 'Erreur de saisie' },
  { ancien: '46031', nouveau: '46301', motif: 'Erreur de saisie' },
  { ancien: '31661', nouveau: '31660', motif: 'Doublon (Approvisionnement)' },
  { ancien: '46311', nouveau: '46301', motif: 'Doublon (Communication entreprise)' },
  { ancien: '44780', nouveau: '44517', motif: 'Doublon (Conception action formation)' },
  { ancien: '21577', nouveau: '21755', motif: 'Doublon (Viande)' },
  // Saisi « Electricité » sous un code inexistant : le métier indique que le domaine
  // visé est Electromécanique, déjà présent sous 24052.
  { ancien: '25052', nouveau: '24052', motif: 'Erreur de saisie (Electromécanique)' },
];

export interface BilanCorrection {
  ancien: string;
  nouveau: string;
  motif: string;
  statut: 'corrige' | 'deja_corrige' | 'cible_absente';
  /** Domaines de couples re-pointés vers le nouveau code. */
  connaissancesDeplacees: number;
  /** Domaines supprimés : le couple citait déjà le nouveau code. */
  connaissancesDoublons: number;
  /** Durées par niveau re-pointées vers le nouveau code. */
  niveauxDeplaces: number;
  /** Durées supprimées : (nouveau code, niveau, origine) existait déjà. */
  niveauxDoublons: number;
  /** Fiches dont les passerelles sont datées comme périmées. */
  metiersTouches: number;
}

/**
 * Applique `CORRECTIONS_FORMACODES` : re-pointe les références vers le bon code, puis
 * supprime l'ancien (`metier_connaissance_ecart` suit par `ON DELETE CASCADE`).
 *
 * En cas de collision — le couple cite déjà le bon code, ou la durée existe déjà pour
 * (nouveau, niveau, origine) — c'est la ligne portant le bon code qui est conservée :
 * elle vient d'un référentiel, l'autre d'une saisie erronée.
 *
 * Les fiches concernées sont datées périmées (`marquerProximitePerimee`) : le calcul des
 * passerelles dépend des formacodes des couples. Le recalcul reste à lancer ensuite.
 */
export async function corrigerFormacodes(): Promise<BilanCorrection[]> {
  const batch = await ImportBatch.create({
    fichier: 'corrections formacodes',
    feuille: null,
    lignesLues: CORRECTIONS_FORMACODES.length,
    rapport: null,
    termineLe: null,
  });

  const transaction = await sequelize.transaction();
  try {
    const bilans: BilanCorrection[] = [];
    for (const correction of CORRECTIONS_FORMACODES) {
      bilans.push(await corriger(correction, transaction));
    }

    const corriges = bilans.filter((b) => b.statut === 'corrige').length;
    const absentes = bilans.filter((b) => b.statut === 'cible_absente').length;
    await batch.update(
      {
        lignesOk: corriges,
        lignesErreur: absentes,
        rapport: bilans,
        statut: 'termine',
        termineLe: new Date(),
      },
      { transaction },
    );

    await transaction.commit();
    return bilans;
  } catch (err) {
    await transaction.rollback();
    await batch.update({ statut: 'echec', termineLe: new Date() });
    throw err;
  }
}

async function corriger(
  { ancien, nouveau, motif }: { ancien: string; nouveau: string; motif: string },
  transaction: Transaction,
): Promise<BilanCorrection> {
  const bilan: BilanCorrection = {
    ancien,
    nouveau,
    motif,
    statut: 'corrige',
    connaissancesDeplacees: 0,
    connaissancesDoublons: 0,
    niveauxDeplaces: 0,
    niveauxDoublons: 0,
    metiersTouches: 0,
  };

  const [cible, source] = await Promise.all([
    Formacode.findByPk(nouveau, { transaction }),
    Formacode.findByPk(ancien, { transaction }),
  ]);
  if (!cible) return { ...bilan, statut: 'cible_absente' };
  if (!source) return { ...bilan, statut: 'deja_corrige' };

  const opts = { replacements: { ancien, nouveau }, transaction };

  // Fiches à dater périmées : à lire AVANT de déplacer les références.
  const metiers = await sequelize.query<{ codeMetier: string }>(
    `SELECT DISTINCT ma.code_metier AS codeMetier
       FROM metier_activite ma
       JOIN activite_connaissance ac ON ac.metier_activite_id = ma.id
      WHERE ac.code_formacode = :ancien`,
    { ...opts, type: QueryTypes.SELECT },
  );

  // uk_couple_conn (couple, formacode) : si le couple cite déjà le bon code, l'ancien
  // n'apporte rien.
  const [, doublonsConn] = await sequelize.query(
    `DELETE a FROM activite_connaissance a
       JOIN activite_connaissance b
         ON b.metier_activite_id = a.metier_activite_id AND b.code_formacode = :nouveau
      WHERE a.code_formacode = :ancien`,
    opts,
  );
  const [, deplacesConn] = await sequelize.query(
    `UPDATE activite_connaissance SET code_formacode = :nouveau WHERE code_formacode = :ancien`,
    opts,
  );

  // uk_formacode_niveau (formacode, niveau, origine) : même règle pour les durées.
  const [, doublonsNiv] = await sequelize.query(
    `DELETE a FROM formacode_niveau a
       JOIN formacode_niveau b
         ON b.code_formacode = :nouveau AND b.niveau = a.niveau AND b.origine = a.origine
      WHERE a.code_formacode = :ancien`,
    opts,
  );
  const [, deplacesNiv] = await sequelize.query(
    `UPDATE formacode_niveau SET code_formacode = :nouveau WHERE code_formacode = :ancien`,
    opts,
  );

  await source.destroy({ transaction });

  for (const m of metiers) await marquerProximitePerimee(m.codeMetier, transaction);

  return {
    ...bilan,
    connaissancesDeplacees: nombreLignes(deplacesConn),
    connaissancesDoublons: nombreLignes(doublonsConn),
    niveauxDeplaces: nombreLignes(deplacesNiv),
    niveauxDoublons: nombreLignes(doublonsNiv),
    metiersTouches: metiers.length,
  };
}

/** Bilan lisible en console, une ligne par correction. */
export function afficherBilan(bilans: BilanCorrection[]): void {
  for (const b of bilans) {
    const fleche = `${b.ancien} → ${b.nouveau}`;
    if (b.statut === 'cible_absente') {
      console.log(`   ⚠️  ${fleche} ignoré : le code ${b.nouveau} n'existe pas en base`);
    } else if (b.statut === 'deja_corrige') {
      console.log(`   ·  ${fleche} déjà corrigé`);
    } else {
      const details = [
        `${b.connaissancesDeplacees} domaine(s) de couple re-pointé(s)`,
        b.connaissancesDoublons ? `${b.connaissancesDoublons} doublon(s) supprimé(s)` : null,
        `${b.niveauxDeplaces} durée(s) par niveau re-pointée(s)`,
        b.niveauxDoublons ? `${b.niveauxDoublons} durée(s) en double supprimée(s)` : null,
        `${b.metiersTouches} fiche(s) touchée(s)`,
      ].filter(Boolean);
      console.log(`   ✔  ${fleche} (${b.motif}) : ${details.join(', ')}`);
    }
  }
  const touches = bilans.reduce((n, b) => n + b.metiersTouches, 0);
  if (touches > 0) {
    console.log(`   → ${touches} fiche(s) touchée(s) : relancer le recalcul des proximités`);
  }
}

/** Le pilote mysql renvoie `affectedRows` dans les métadonnées d'un UPDATE/DELETE. */
function nombreLignes(meta: unknown): number {
  const m = meta as { affectedRows?: number } | number | undefined;
  if (typeof m === 'number') return m;
  return m?.affectedRows ?? 0;
}
