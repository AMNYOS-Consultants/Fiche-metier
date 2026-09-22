/**
 * Applique un classeur d'échange (celui produit par « Exporter toute la base ») sur une
 * base déjà migrée — en synchronisation, comme la route HTTP.
 *
 *   npm run db:import-classeur -- chemin/vers/le-fichier.xlsx
 *
 * Deux usages :
 *
 * 1. **Peupler la base de test en CI**, à partir du fixture `tests/fixtures/base-complete.xlsx`
 *    — une image de la base réelle, corrigée. Nettement plus rapide et plus robuste qu'un
 *    réimport complet depuis les classeurs sources bruts (`npm run import:excel`, qui reste
 *    la seule voie de bootstrap depuis des données de branche jamais chargées, mais lit des
 *    feuilles à la mise en page irrégulière) : c'est aussi le chemin déjà couvert par les 18
 *    tests d'aller-retour de `tests/classeur.test.ts`.
 * 2. **Réinjecter localement** un export édité à la main, sans passer par l'écran d'import
 *    (utile en script, ou si le fichier dépasse ce que l'écran accepte).
 *
 * ⚠️ Comme la route HTTP, ceci **synchronise** : toute ligne absente du fichier est
 * supprimée en base. Sans intérêt sur une base fraîchement migrée (elle est vide, donc rien
 * à supprimer), mais dangereux sur une base qui contient déjà des données réelles.
 *
 * Le recalcul des passerelles (`npm run db:recalc-proximites`) n'est pas inclus : la table
 * calculée est volontairement hors du classeur (voir `services/classeur/lecture.ts`).
 */
import { readFileSync } from 'node:fs';
import '../models';
import { sequelize } from './connection';
import { appliquerClasseur } from '../services/classeur/import.service';

async function main(): Promise<void> {
  const chemin = process.argv[2];
  if (!chemin) {
    console.error('Usage : npm run db:import-classeur -- chemin/vers/le-fichier.xlsx');
    process.exit(1);
  }

  await sequelize.authenticate();
  console.log(`▶  Import du classeur ${chemin}…`);

  const tampon = readFileSync(chemin);
  const rapport = await appliquerClasseur(tampon);

  if (!rapport.applique) {
    console.error(`❌ ${rapport.anomalies.length} anomalie(s) — rien n'a été écrit :`);
    for (const a of rapport.anomalies.slice(0, 20)) {
      console.error(`   - ${a.feuille ?? ''} ${a.ligne ? `ligne ${a.ligne}` : ''} ${a.colonne ?? ''} : ${a.message}`);
    }
    await sequelize.close();
    process.exit(1);
  }

  const { ajouts, modifications, suppressions } = rapport.totaux;
  console.log(`✅ ${ajouts} ajout(s), ${modifications} modification(s), ${suppressions} suppression(s).`);
  if (rapport.metiersARecalculer > 0) {
    console.log(
      `   → ${rapport.metiersARecalculer} métier(s) à recalculer : npm run db:recalc-proximites`,
    );
  }
  await sequelize.close();
}

main().catch(async (err) => {
  console.error('❌ Import du classeur échoué :', err.message);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
