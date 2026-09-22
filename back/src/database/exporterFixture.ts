/**
 * Régénère `tests/fixtures/base-complete.xlsx` depuis la base pointée par `.env` — le
 * classeur d'échange que la CI réimporte pour peupler sa base de test.
 *
 *   npm run db:export-fixture
 *
 * À rejouer chaque fois que le fixture doit refléter l'état courant de la base (nouvelles
 * fiches, corrections de données) ou une migration de schéma qui l'aurait rendu périmé —
 * `tests/classeur.test.ts` (« couvre toutes les tables du schéma ») le détecterait de
 * toute façon en CI, faute de quoi, mais autant le voir ici d'abord.
 *
 * Ne PAS pointer `.env` sur une base de démonstration ou de test au moment de lancer ce
 * script : le fixture doit rester une image fidèle de données réelles, pas d'un jeu de
 * données jetable.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import '../models';
import { sequelize } from './connection';
import { lireBase, versionSchema } from '../services/classeur/lecture';
import { ecrireClasseur } from '../services/classeur/ecriture';

const CHEMIN_FIXTURE = path.resolve(__dirname, '../../tests/fixtures/base-complete.xlsx');

async function main(): Promise<void> {
  await sequelize.authenticate();
  console.log('▶  Export du fixture…');

  const exporteLe = new Date().toISOString();
  const [contenu, version] = await Promise.all([lireBase(), versionSchema()]);
  const classeur = ecrireClasseur(contenu, { exporteLe, versionSchema: version });

  writeFileSync(CHEMIN_FIXTURE, classeur);
  console.log(
    `✅ ${CHEMIN_FIXTURE} (${(classeur.length / 1024 / 1024).toFixed(2)} Mo, schéma ${version}).`,
  );
  console.log("   Pensez à le committer si c'est bien ce que vous vouliez régénérer.");
  await sequelize.close();
}

main().catch(async (err) => {
  console.error('❌ Export du fixture échoué :', err.message);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
