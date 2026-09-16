/**
 * Backfill ponctuel : peuple `famille_activite` depuis nomencl_FAMACTIVITES (feuille
 * jamais importée jusqu'ici, voir referentiels.importer.ts) puis relie chaque `activite`
 * existante à sa famille via `code_famille_activite`, resté NULL depuis l'import initial
 * (couples.importer.ts créait les activités sans cette table à peupler).
 *
 * Les imports complets (`npm run import:excel`) n'ont plus besoin de ce script : les deux
 * importeurs concernés font désormais ce travail eux-mêmes. À ne rejouer que si la base
 * a été peuplée avant ce correctif.
 *
 *   npm run db:backfill-familles-activite
 */
import path from 'node:path';
import '../models';
import { sequelize, Activite, FamilleActivite } from '../models';
import { env } from '../config/env';
import { lireFeuilleBrute } from './importers/xlsxReader';
import { importerFamillesActivite } from './importers/referentiels.importer';
import { deriverCodeFamille } from './importers/couples.importer';

async function main(): Promise<void> {
  await sequelize.authenticate();

  const fichier = path.resolve(__dirname, '..', '..', env.xlsx.competences);
  const lignes = lireFeuilleBrute(fichier, 'nomencl_FAMACTIVITES');

  const transaction = await sequelize.transaction();
  try {
    const nbFamilles = await importerFamillesActivite(lignes, transaction);
    console.log(`▶  ${nbFamilles} familles d'activité importées.`);

    const famillesConnues = new Set(
      (await FamilleActivite.findAll({ attributes: ['codeFamilleActivite'], transaction })).map(
        (f) => f.codeFamilleActivite,
      ),
    );

    const activites = await Activite.findAll({ transaction });
    let maj = 0;
    for (const activite of activites) {
      const code = deriverCodeFamille(activite.codeActivite, famillesConnues);
      if (code && activite.codeFamilleActivite !== code) {
        activite.codeFamilleActivite = code;
        await activite.save({ transaction });
        maj += 1;
      }
    }

    await transaction.commit();
    console.log(`✅ ${maj} / ${activites.length} activités reliées à leur famille.`);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  await sequelize.close();
}

main().catch(async (err) => {
  console.error('❌ Backfill échoué :', err.message);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
