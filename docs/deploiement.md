# Déploiement sur le VPS

Ce que fait `.github/workflows/ci.yml` (jobs `build-and-push` et `deploy`) sur chaque
push vers `main`, une fois les tests passés : publie les images `back` et `front` sur
`ghcr.io`, puis se connecte en SSH au VPS pour les tirer et redémarrer la pile.

Ce que la CI **ne fait jamais**, et qui doit donc être en place avant le premier
déploiement automatique :

## 1. Cloner le projet sur le VPS

```bash
git clone git@github.com:carlbrgs/Fiche-metier.git /opt/fiche-metier
```

Le dépôt étant privé, l'accès en lecture se fait par une [deploy
key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
(Settings → Deploy keys du repo, clé publique générée sur le VPS) plutôt qu'un compte
personnel — c'est elle que `git pull origin main` réutilise à chaque déploiement.

## 2. Déposer le `.env` de production

À la racine du clone (`/opt/fiche-metier/.env`) — **jamais dans le dépôt, jamais transporté
par la CI**. C'est le fichier que Docker Compose charge automatiquement pour résoudre les
`${VARIABLE}` de `docker-compose.yml` et `docker-compose.prod.yml`.

Le VPS héberge la même instance que celle utilisée en local : copier le `.env` déjà présent
à la racine du projet local (`scp .env <utilisateur>@<vps>:/opt/fiche-metier/.env`), plutôt
que d'en écrire un nouveau avec des identifiants différents.

`docker-compose.prod.yml` rend obligatoires les variables sensibles
(`DB_PASSWORD`, `DB_ROOT_PASSWORD`, `AUTH_USERNAME`, `AUTH_PASSWORD`,
`AUTH_SESSION_SECRET`) : un `.env` qui en oublierait une fait échouer `docker compose`
avec un message explicite, plutôt que de démarrer silencieusement avec la valeur par
défaut de `docker-compose.yml` — publique, puisque visible dans le dépôt. Penser aussi à
fixer `CORS_ORIGIN` sur l'URL publique réelle du front, différente de
`http://localhost:8080`.

## 3. Autoriser l'utilisateur de déploiement à lancer Docker sans mot de passe

Le script de déploiement appelle `docker` directement, sans `sudo` :

```bash
sudo usermod -aG docker <utilisateur-de-déploiement>
```

(déconnexion/reconnexion nécessaire pour que ça prenne effet). C'est plus simple à
maintenir qu'une règle `sudoers` dédiée, mais l'un ou l'autre convient — si `sudo -n
docker` est déjà configuré sur ce VPS pour un autre projet, adapter le script SSH du job
`deploy` en conséquence.

## 4. Générer la clé SSH de déploiement

```bash
ssh-keygen -t ed25519 -f deploy_key -N ""
```

- La clé **publique** (`deploy_key.pub`) va dans `~/.ssh/authorized_keys` de l'utilisateur
  de déploiement, sur le VPS.
- La clé **privée** (`deploy_key`) devient le secret GitHub `VPS_SSH_KEY_B64`, encodée en
  base64 sur une seule ligne (un secret GitHub Actions ne porte pas de saut de ligne, qu'une
  clé PEM contient forcément) :

  ```bash
  base64 -w0 deploy_key   # Linux/macOS — -w0 : pas de retour à la ligne inséré
  certutil -encode deploy_key deploy_key.b64   # Windows, puis retirer les lignes d'en-tête/pied
  ```

## 5. Créer les trois secrets GitHub Actions

`Settings → Secrets and variables → Actions` sur le repo :

| Secret | Valeur |
|---|---|
| `VPS_HOST` | IP ou nom d'hôte du VPS |
| `VPS_USER` | l'utilisateur de déploiement (celui du groupe `docker`, étape 3) |
| `VPS_SSH_KEY_B64` | la clé privée encodée en base64 (étape 4) |

`GITHUB_TOKEN` n'est **pas** à créer : GitHub Actions le fournit automatiquement à chaque
run, avec la portée `packages: write` déjà déclarée en tête du workflow — il sert à la
fois à publier les images (`build-and-push`) et à les tirer depuis le VPS (`deploy`).

## 6. Premier déploiement, à la main

La toute première fois, avant de laisser la CI s'en charger — le temps de vérifier que
tout est en place :

```bash
cd /opt/fiche-metier
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile app pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile app up -d
```

Un déploiement (automatique ou manuel) ne peuple jamais la base : `docker-entrypoint.sh`
n'applique que les migrations de schéma au démarrage, jamais un import de données (voir ce
fichier). Sur une base neuve, il faut la peupler une fois, depuis un shell dans le
conteneur `back` :

```bash
docker compose exec back npm run db:import-classeur -- tests/fixtures/base-complete.xlsx
docker compose exec back npm run db:recalc-proximites
```

(ou `npm run import:excel` pour repartir des classeurs sources bruts plutôt que du
fixture — voir `back/tests/fixtures/README.md` pour le choix entre les deux).

## 7. Pare-feu

Avec `docker-compose.prod.yml`, seul `front` (port `8080` par défaut, `FRONT_PORT` dans le
`.env`) doit être joignable depuis l'extérieur — `db`, `adminer` et `back` ne sont plus
exposés que sur `127.0.0.1`. S'assurer que le pare-feu du VPS (ufw, groupe de sécurité du
fournisseur…) n'ouvre que ce port-là vers l'extérieur.

---

Une fois ces sept points en place, chaque push sur `main` qui passe les tests se déploie de
lui-même.
