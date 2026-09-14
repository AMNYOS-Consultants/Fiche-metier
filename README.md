# Fiches Métiers

Application de consultation des cartographies métiers de branche, construite à partir de deux
classeurs Excel : `Base formacodes_DC structurants.xlsx` et `251230_base competences_V3.3.xlsm`.

**Node + React + Express + Sequelize + MariaDB**, en TypeScript de bout en bout.

## Arborescence

```
fiche-metiers/
├── docs/
│   └── SCHEMA.md                  ← architecture des 26 tables, justifiée table par table
├── back/
│   ├── Dockerfile              multi-stage : build TS → image de production
│   ├── docker-entrypoint.sh    applique les migrations puis démarre le serveur
│   └── src/
│       ├── config/                configuration (env)
│       ├── controllers/           logique des endpoints
│       ├── routes/                déclaration des routes Express
│       ├── models/                modèles Sequelize + associations (index.ts)
│       ├── database/
│       │   ├── connection.ts      instance Sequelize
│       │   ├── migrate.ts         runner de migrations SQL
│       │   ├── sync.ts            synchro des modèles (dev uniquement)
│       │   ├── migrations/        *.sql appliqués dans l'ordre
│       │   └── importers/         lecture des classeurs Excel
│       ├── middlewares/           erreurs, pagination, asyncHandler
│       ├── services/              logique métier (calcul des passerelles)
│       └── types/                 contrats d'API
├── front/
│   ├── Dockerfile              multi-stage : build Vite → nginx
│   ├── nginx.conf              sert le statique, proxifie /api, fallback SPA
│   └── src/
│       ├── pages/                 une page par écran
│       ├── components/            composants réutilisables
│       ├── api/                   client HTTP typé
│       ├── hooks/                 useFetch
│       └── types/                 miroir des types de l'API
└── docker-compose.yml             db + adminer, et back + front sous le profil `app`
```

## Pile complète en Docker

Tout est conteneurisé. Une seule commande, rien à installer en local :

```bash
docker compose --profile app up -d --build
```

Tout rebuild si nécessaire, puis démarre les 4 services :

```bash
docker compose --profile app down -v      # -v supprime le volume de la base
docker compose --profile app up -d --build
docker compose exec back node dist/database/importers/index.js
docker compose exec back node dist/database/recalculerProximites.js
```

| Service     | URL                                           | Détail                                                 |
| ----------- | --------------------------------------------- | ------------------------------------------------------- |
| `front`   |                                               | nginx, sert le build Vite et route`/api` vers le back |
| `back`    | [http://localhost:4000](http://localhost:4000) | exposé pour le débogage uniquement                    |
| `db`      | `localhost:3306`                            | MariaDB 11                                              |
| `adminer` | [http://localhost:8081](http://localhost:8081) | inspection de la base                                   |

Le front appelle l'API en chemins relatifs ([client.ts](front/src/api/client.ts)) : `/api`
doit donc être servi sur la même origine que le front. C'est déjà le cas partout — le proxy
de Vite en développement ([vite.config.ts](front/vite.config.ts)), nginx dans le conteneur.
Aucun CORS à configurer.

Au moment de l'hébergement sur un domaine, le reverse proxy en frontal (TLS) n'aura rien à
savoir de `/api` : il transmet tout à `front:80`, qui continue de router.

Le back applique les migrations à son démarrage (`docker-entrypoint.sh`). Le runner étant
idempotent, un redémarrage ne rejoue rien. Passer `RUN_MIGRATIONS=false` si le déploiement
les applique lui-même — indispensable le jour où plusieurs instances tourneront en parallèle.

Les classeurs Excel sont **montés** en lecture seule dans `/data`, pas copiés dans l'image
(3 Mo de données qui changent indépendamment du code). Pour lancer un import :

```bash
docker compose exec back node dist/database/importers/index.js
docker compose exec back node dist/database/recalculerProximites.js
```

Le recalcul des proximités est une étape **distincte de l'import**, à ne pas oublier :
`metier_proximite` est une table matérialisée (les matrices 333 × 333 du classeur), remplie
uniquement par ce script. Ni les migrations ni l'import ne la peuplent — tant qu'elle est
vide, l'écran « Métiers passerelles » ne renvoie aucun résultat, quel que soit le métier de
départ. À rejouer après tout import qui touche `metier`, `metier_acces`,
`metier_transversale` ou `activite_connaissance`.

Arrêt : `docker compose --profile app down` (ajouter `-v` pour effacer aussi la base).

Les variables de la compose sont surchargeables via un `.env` à la racine — voir
[.env.example](.env.example). À ne pas confondre avec `back/.env`, qui ne sert qu'au
back lancé en `npm run dev`.

## Démarrage en développement

Le profil `app` isole `back` et `front` : `docker compose up -d` sans profil ne démarre
que la base et Adminer, et n'écrase pas un back lancé à la main.

### 1. Base de données

Deux options, au choix.

**a. MariaDB de XAMPP** (celle utilisée en développement ici)

Démarrer MySQL depuis le panneau XAMPP, puis créer la base et l'utilisateur applicatif —
ne pas faire tourner l'application en `root` :

```bash
"c:/xampp/mysql/bin/mysql.exe" -u root -e "
CREATE DATABASE IF NOT EXISTS fiche_metiers CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'fiche'@'localhost'  IDENTIFIED BY 'fichepwd';
CREATE USER IF NOT EXISTS 'fiche'@'127.0.0.1'  IDENTIFIED BY 'fichepwd';
GRANT ALL PRIVILEGES ON fiche_metiers.* TO 'fiche'@'localhost';
GRANT ALL PRIVILEGES ON fiche_metiers.* TO 'fiche'@'127.0.0.1';
FLUSH PRIVILEGES;"
```

Les deux hôtes sont nécessaires : Node se connecte à `127.0.0.1`, que MariaDB ne considère
pas comme équivalent à `localhost`.

**b. Docker**

```bash
docker compose up -d
```

MariaDB sur `localhost:3306`, Adminer sur [http://localhost:8081](http://localhost:8081). La base et l'utilisateur
sont créés automatiquement. Ne pas lancer les deux en même temps : le port 3306 entrerait
en conflit.

### 2. Back

```bash
cd back
cp .env.example .env            # ajuster si besoin
npm install
npm run db:migrate              # crée les 26 tables
npm run import:excel            # importe les formacodes (voir « Reste à faire »)
npm run db:recalc-proximites    # remplit metier_proximite (écran « Passerelles »)
npm run dev                     # http://localhost:4000/api
```

L'import consigne systématiquement son bilan dans la table `import_batch` : lignes rejetées
avec leur motif, et couples `(formacode, niveau)` définis plusieurs fois dans la source avec
la valeur retenue et celle ignorée.

```sql
SELECT lignes_lues, lignes_ok, lignes_erreur, rapport FROM import_batch ORDER BY id DESC LIMIT 1;
```

Les classeurs citent des formacodes erronés (codes inexistants, doublons d'un même
domaine). La liste et le code retenu pour chacun sont dans
`back/src/database/importers/correctionsFormacodes.ts` ; l'import les applique en
dernière étape. Pour corriger une base déjà importée sans tout rejouer :

```bash
npm run db:corriger-formacodes   # idempotent, bilan dans import_batch
npm run db:recalc-proximites     # les fiches touchées sont datées périmées
```

En Docker : `docker compose exec back node dist/database/corrigerFormacodes.js`.

### 3. Front

```bash
cd front
npm install
npm run dev                # http://localhost:5173
```

Le serveur Vite proxifie `/api` vers `http://localhost:4000` — pas de configuration CORS en dev.

## API

| Méthode | Route                                                        | Description                                  |
| -------- | ------------------------------------------------------------ | -------------------------------------------- |
| GET      | `/api/health`                                              | ping                                         |
| GET      | `/api/metiers?search=&famille=&dossier=&page=&limit=`      | liste paginée                               |
| GET      | `/api/metiers/:code`                                       | fiche métier complète                      |
| GET      | `/api/metiers/:code/activites`                             | activités et leurs domaines de connaissance |
| GET      | `/api/activites?search=&famille=&formacode=`               | liste paginée                               |
| GET      | `/api/activites/:code`                                     | couple activité-compétence complet         |
| GET      | `/api/formacodes?search=&nsf=&fondamental=`                | liste paginée                               |
| GET      | `/api/formacodes/:code`                                    | formacode et durées par niveau              |
| GET      | `/api/referentiels`                                        | toutes les nomenclatures en un appel         |
| GET      | `/api/passerelles/:code/proches?heuresMax=&dcMin=&limite=` | métiers proches                             |
| GET      | `/api/passerelles/:source/vers/:cible`                     | écart détaillé entre deux métiers        |

## Base de données

26 tables — voir **[docs/SCHEMA.md](docs/SCHEMA.md)** pour le détail et les arbitrages.

En résumé : les classeurs sont « à plat » (`COND_1`…`COND_15`, `FORMACODE_1`…`FORMACODE_5`) ;
le modèle les normalise en tables de liaison avec une colonne `ordre` qui préserve la position
d'origine. Les matrices 333 × 333 du classeur (`Degre_Elargissement`, `Table_durée_différence_*`)
ne sont pas des données mais des calculs : elles deviennent des tables matérialisées.

### Migrations

Les migrations sont des fichiers `.sql` numérotés dans `back/src/database/migrations/`,
appliqués dans l'ordre alphabétique et journalisés dans `schema_migrations`.

```bash
npm run db:status    # ce qui est appliqué / en attente
npm run db:migrate   # applique les migrations en attente
```

En développement, `npm run db:sync` régénère le schéma depuis les modèles Sequelize
(refusé si `NODE_ENV=production`).

## Reste à faire

- **Domaines non codés dans la source** — 19 domaines du fichier formacodes (Ferraillage,
  Coffrage, Béton, Menuiserie, Lecture plan BTP…) portent une durée mais aucun Formacode.
  Ils ne peuvent pas être importés : le code EST la clé primaire. À compléter dans le classeur.
- **Calcul des passerelles** — `recalculerProximites()` est implémenté (formule reconstituée
  depuis `Outil_passerelles_062026.xlsx`, fourni hors dépôt — voir `services/passerelle.service.ts`
  et `docs/SCHEMA.md` §5). Le recalcul reste **manuel** : rien ne le déclenche au démarrage
  ni en fin d'import — voir « Pile complète en Docker » et « Démarrage en développement ».
- **Authentification** — un seul compte, pas de table utilisateur : identifiant/mot de passe
  dans `AUTH_USERNAME`/`AUTH_PASSWORD` (`.env`), session par cookie signé HMAC (voir
  `back/src/services/session.service.ts`). `/api/health` reste public (healthcheck Docker),
  tout le reste de `/api` exige la session. Si plusieurs comptes distincts sont nécessaires un
  jour, une vraie table `utilisateur` remplacera ce compte unique.
- **Déploiement VPS** — la conteneurisation est faite, la même compose tourne telle quelle.
  Restent trois points côté serveur : un reverse proxy en frontal pour le domaine et le TLS
  (il transmet tout à `front:80`, sans configuration particulière pour `/api`), de vrais mots
  de passe dans un `.env` racine — les valeurs par défaut sont des valeurs de développement —,
  et la sauvegarde du volume `db_data`.
