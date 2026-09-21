/**
 * Importe le référentiel ROME (arborescence principale France Travail) sur une base déjà
 * en place : ajoute les codes manquants et remplace les libellés existants.
 *
 *   npm run db:import-rome
 *
 * L'import complet (`npm run import:excel`) l'enchaîne de lui-même, avant les fiches
 * métier — ainsi les codes cités par les fiches se rattachent à un référentiel déjà chargé
 * au lieu d'être créés à la volée.
 */
import '../models';
import { sequelize } from './connection';
import { importerRome, afficherBilanRome } from './importers/rome.importer';

async function main(): Promise<void> {
  await sequelize.authenticate();
  console.log('▶  Import du référentiel ROME…');
  afficherBilanRome(await importerRome());
  await sequelize.close();
}

main().catch(async (err) => {
  console.error('❌ Import ROME échoué :', err.message);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
