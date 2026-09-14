/**
 * Applique les corrections de formacodes (erreurs de saisie, doublons) sur une base déjà
 * importée — voir importers/correctionsFormacodes.ts pour la liste et la règle.
 *
 *   npm run db:corriger-formacodes
 *
 * L'import complet (`npm run import:excel`) l'enchaîne de lui-même en dernière étape ;
 * ce script sert à corriger une base existante sans tout réimporter. Les passerelles des
 * fiches touchées sont datées périmées : enchaîner avec `npm run db:recalc-proximites`.
 */
import '../models';
import { sequelize } from './connection';
import { corrigerFormacodes, afficherBilan } from './importers/correctionsFormacodes';

async function main(): Promise<void> {
  await sequelize.authenticate();
  console.log('▶  Correction des formacodes…');
  afficherBilan(await corrigerFormacodes());
  await sequelize.close();
}

main().catch(async (err) => {
  console.error('❌ Correction échouée :', err.message);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
