# Tests backend

Tests d'intégration HTTP (vitest + supertest) contre l'application Express assemblée par
`createApp()` — pas de serveur réellement démarré, mais une vraie connexion à la base
MariaDB configurée dans `back/.env`.

## Lancer les tests

Il faut que la base soit up (stack Docker `db`, ou toute MariaDB déjà migrée/importée
accessible avec les identifiants de `back/.env`) :

```bash
docker compose --profile app up -d db
cd back
npm test          # une passe, CI-friendly (vitest run)
npm run test:watch  # mode watch, pour le développement
```

## Organisation

- `helpers/client.ts` — l'instance Express partagée (`app`) et `agentAuthentifie()`, qui
  pose un cookie de session valide (identifiants lus dans `back/.env`).
- `setup.ts` — ferme le pool Sequelize après la suite (`fileParallelism: false` dans
  `vitest.config.ts` : les tests tournent en série, une seule connexion à la fois).
- Un fichier par domaine, aligné sur `src/routes/*.routes.ts` : `auth`, `metiers`,
  `activites`, `formacodes`, `passerelles`, `referentiels` (dont `/referentiels/rome` et
  l'intégrité du référentiel ROME importé : 1 911 fiches, aucun libellé manquant,
  `nbMetiers` concordant avec les codes réellement portés), `export`.
- `export.test.ts` ne vérifie pas que l'export répond, mais qu'il est **complet** : il
  compare le compte de chaque clé au `COUNT(*)` de sa table, et **découvre le schéma**
  via `information_schema` pour échouer si une table n'est ni exportée ni inscrite dans
  la liste des exclusions assumées. Une migration qui ajoute une table fera donc tomber
  ce test — c'est le rappel voulu, l'export étant destiné à être réimporté. Il verrouille
  aussi la forme brute des valeurs (énumérations en base, booléens 0/1, dates ISO 8601)
  et la présence de `metier_activite.id`, sans lequel les cinq tables filles d'un couple
  ne se rattachent à rien.
- `correctionsFormacodes.test.ts` — le seul test hors HTTP : il appelle directement
  `corrigerFormacodes()` (src/database/importers) avec des listes de substitution, sur des
  formacodes et une fiche ZZTEST montés pour l'occasion. Il vérifie le re-pointage des
  domaines de couple et des durées, la règle de collision, la suppression de l'ancien code,
  la péremption des passerelles, l'idempotence et le journal `import_batch` (les lignes
  écrites par le test sont retirées à la fin).

## Principes suivis

- **Aucune donnée réelle n'est modifiée ni supprimée.** Les tests qui créent des données
  (fiche métier, formacode) utilisent un marqueur explicite (`ZZTEST…`), les suppriment
  dans un bloc `afterAll` — y compris si une assertion échoue en cours de route — et
  suppriment aussi en amont (`beforeAll`) au cas où un run précédent aurait été interrompu.
- **Rien n'est codé en dur.** Les codes (famille, ROME, condition, formacode, métier…)
  utilisés par les tests de lecture sont récupérés dynamiquement via `/api/referentiels` ou
  le premier élément d'une liste, pas hardcodés : la suite reste valide même si le contenu
  de la base évolue. Seule exception assumée : `referentiels.test.ts` fige le couple
  `A1202` → « Ouvrier / Ouvrière d'entretien des espaces naturels ». C'est précisément
  l'oracle de l'import ROME — cette fiche porte 11 appellations, et retenir l'intitulé
  principal plutôt que l'une d'elles est la règle que le test doit verrouiller.
- Le test de `comparerMetiers()` (passerelles) vérifie explicitement l'absence de doublons
  de formacode dans les écarts — c'est la régression corrigée dans
  `services/passerelle.service.ts` (fan-out sur `formacode_niveau` quand plusieurs origines
  existent pour un même niveau).

## Ce qui n'est pas couvert (pour l'instant)

- `POST /metiers/:code/couples` n'est exercé qu'en montage du test des corrections de
  formacodes, pas pour lui-même ; `DELETE /metiers/:code/couples/:id` et
  `POST /passerelles/recalculer` (recalcule ~110 000 lignes, trop coûteux pour un test à
  chaque run) ne le sont pas.
- Aucun test frontend (composants React) ni end-to-end navigateur : cette suite s'arrête à
  l'API. Un smoke test Playwright serait la suite logique si besoin.

## Intégration CI/CD

`.github/workflows/ci.yml` — deux jobs indépendants sur push et pull request vers `main` :

- **back** : `typecheck`, `test:typecheck`, puis une base MariaDB jetable (service
  container) peuplée via le fixture `tests/fixtures/base-complete.xlsx`
  (`db:migrate` + `db:import-classeur` + `db:recalc-proximites`, ~20 s au total — voir
  `tests/fixtures/README.md`), puis `npm test`.
- **front** : `typecheck` puis `build`.

Aucun step de lint : ni `back/` ni `front/` n'ont eslint installé aujourd'hui (le script
`lint` de `back/package.json` référence un paquet absent).
