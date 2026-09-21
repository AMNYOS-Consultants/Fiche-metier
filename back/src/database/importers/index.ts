/**
 * Orchestrateur des imports Excel.
 *
 * ÉTAT : seul l'importeur des formacodes est écrit. Il sert de patron pour les suivants
 * (lecture → validation ligne à ligne → upsert transactionnel → journal `import_batch`).
 *
 * Reste à écrire, dans cet ordre — les dépendances de clés étrangères l'imposent :
 *
 *   1. referentiels.importer.ts   251230_base competences_V3.3.xlsm
 *                                 → nomencl_FAMMETIERS, nomencl_FAMACTIVITES,
 *                                   nomencl_COND, nomencl_TRANSV, nomencl_ACCES
 *                                 ⚠️ ces feuilles ont une mise en page irrégulière
 *                                    (blocs décalés, colonnes de calcul intercalées) :
 *                                    repérer les plages à la main avant de coder.
 *
 *   2. formacodesCompetences      feuille Formacode_niveau (origine 'base_competences')
 *
 *   3. activites.importer.ts      feuille data_ACT_COMP_CONN (1 360 lignes × 65 colonnes)
 *                                 → activite, activite_detail (ACT_DET_1..9),
 *                                   competence_detail (COMP_DET_1..9),
 *                                   niveau_maitrise (NIV_MATR_1..4),
 *                                   mot_cle + activite_mot_cle (MOT_CLE_ACT_1..3),
 *                                   activite_connaissance (5 blocs FORMACODE_n/CONN_*_n/NSF_n)
 *
 *   4. metiers.importer.ts        feuille Outil_collecte_fiche_metier
 *                                 (333 lignes × 439 colonnes) — et JAMAIS data_METIERS,
 *                                 qui n'en est qu'une projection appauvrie (docs/SCHEMA.md §1 bis)
 *                                 → metier (col. 0-45 + métadonnées de collecte 423-432),
 *                                   metier_appellation (APPELL_METIER_1..10, col. 5-14),
 *                                   metier_rome (ROME_1..3, col. 15-17),
 *                                   metier_condition (COND_1..15, col. 18-32),
 *                                   metier_acces (ACCES_METIER_1..7, col. 33-39),
 *                                   metier_transversale (TRANSV_1..17, col. 226-242)
 *
 *                                 ⚠️ Le code métier est en colonne 40, PAS en colonne 41
 *                                    (qui contient le libellé de la famille).
 *                                 ⚠️ `D314` apparaît deux fois (lignes 314 et 315), pour deux
 *                                    métiers distincts. Rien dans cette feuille ne permet de
 *                                    trancher, et data_METIERS est écartée par décision :
 *                                    consigner la collision dans import_batch et ignorer la
 *                                    seconde ligne. 332 métiers importés au lieu de 333,
 *                                    jusqu'à correction du classeur.
 *                                 ⚠️ Intitulés conservés en casse de saisie : aucune
 *                                    normalisation (décision, docs/SCHEMA.md §1 bis).
 *
 *   5. metiersActivites.importer  Outil_collecte_fiche_metier, col. 433-438 (CODE_ACT_1..6)
 *                                 → metier_activite
 *                                 Identique à data_METIERS_ACT pour 331 métiers sur 332 ;
 *                                 seul K325 diverge (ordre des deux premiers codes).
 *
 * Les tables calculées (metier_proximite, metier_connaissance_ecart) ne s'importent pas :
 * elles se recalculent — voir services/passerelle.service.ts.
 */
import { sequelize } from '../connection';
import { importerFormacodes } from './formacodes.importer';
import { importerReferentiels } from './referentiels.importer';
import { importerRome, afficherBilanRome } from './rome.importer';
import { importerMetiers } from './metiers.importer';
import { importerCouples } from './couples.importer';
import { importerFormacodeNiveau } from './formacodeNiveau.importer';
import { corrigerFormacodes, afficherBilan } from './correctionsFormacodes';

async function main(): Promise<void> {
  await sequelize.authenticate();

  // L'ordre est imposé par les clés étrangères : les référentiels d'abord.
  console.log('▶  Import des formacodes structurants…');
  await importerFormacodes();

  console.log('\n▶  Import de Formacode_niveau (libellés de référence)…');
  await importerFormacodeNiveau();

  console.log('\n▶  Import des référentiels…');
  await importerReferentiels();

  // Avant les fiches : leurs codes ROME se rattachent alors à un référentiel déjà chargé,
  // au lieu d'être créés à la volée sans rien qui les valide.
  console.log('\n▶  Import du référentiel ROME…');
  afficherBilanRome(await importerRome());

  console.log('\n▶  Import des fiches métier (Outil_collecte_fiche_metier)…');
  await importerMetiers();

  console.log('\n▶  Import des couples activité-compétence…');
  await importerCouples();

  // Les classeurs citent des codes erronés (voir correctionsFormacodes.ts) : on corrige
  // après coup plutôt que dans chacun des trois importeurs qui les rencontrent.
  console.log('\n▶  Correction des formacodes erronés…');
  afficherBilan(await corrigerFormacodes());

  console.log('\n✅ Import terminé.');
  await sequelize.close();
}

main().catch(async (err) => {
  console.error('❌ Import échoué :', err.message);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
