# Fixtures

## `base-complete.xlsx`

Le classeur d'échange (`services/classeur/`) exporté depuis une base réelle et
correctement peuplée — 23 feuilles, une par table source, ~49 000 lignes. La CI
l'importe pour peupler sa base de test :

```bash
npm run db:migrate
npm run db:import-classeur -- tests/fixtures/base-complete.xlsx
npm run db:recalc-proximites   # metier_proximite est hors classeur (table calculée)
```

## Pourquoi un fixture plutôt qu'un réimport depuis les classeurs sources

`npm run import:excel` (les classeurs bruts des branches professionnelles —
`XLSX_FORMACODES`, `XLSX_COMPETENCES`…) reste la seule voie pour peupler une base
**jamais chargée**, ou pour la recharger si les branches livrent une nouvelle version de
leurs données. Mais c'est lent (~2 min 30 : lecture de feuilles à la mise en page
irrégulière, transformation, upserts) et pas ce dont la CI a besoin à chaque run —
peupler une base de test avec des données déjà connues et déjà correctes.

Ce fixture prend le chemin inverse : il *sort* d'une base déjà peuplée par
`import:excel`, au format pivot normalisé du classeur d'échange. Le réimporter
(`db:import-classeur`) prend ~10 s, contre ~2 min 30 pour `import:excel` — et c'est
le même chemin de code que couvre `tests/classeur.test.ts` (18 tests, dont
l'aller-retour export → import qui garantit qu'aucune ligne n'y est perdue ou déformée).

## Le régénérer

Quand la base source a changé (nouvelles fiches, corrections) ou qu'une migration a
modifié le schéma (le fixture porte sa propre version de schéma dans sa feuille
« Lisez-moi », et `tests/classeur.test.ts` détecterait un schéma désormais incomplet) :

```bash
# .env doit pointer vers la base dont le fixture doit être l'image — jamais une base
# de démonstration ou de test.
npm run db:export-fixture
git add tests/fixtures/base-complete.xlsx
```

Rejouer ensuite la suite de tests localement contre une base fraîche (migrations +
`db:import-classeur` + `db:recalc-proximites`, comme ci-dessus) avant de committer, pour
s'assurer que le nouveau fixture est complet et cohérent.
