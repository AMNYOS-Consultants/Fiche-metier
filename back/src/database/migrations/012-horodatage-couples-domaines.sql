-- ============================================================
-- 012 — Horodatage des couples et des domaines de connaissance
--
-- `metier` et `activite` portaient déjà created_at/updated_at ; les tables réellement
-- éditées au quotidien, non. Impossible, du coup, de savoir quand un couple ou un domaine
-- a été touché — ni même de distinguer après coup une modification volontaire d'une avarie.
--
-- Tables retenues : celles qui ont une existence propre à l'écran.
--   - metier_activite       : le couple activité-compétence
--   - activite_connaissance : les domaines portés par un couple
--   - formacode             : le catalogue des domaines de connaissance
--   - formacode_niveau      : les durées par niveau, saisissables depuis l'outil
--
-- `activite_detail`, `competence_detail` et `niveau_maitrise` en sont volontairement
-- exclues : elles sont toujours réécrites en bloc avec leur couple (voir
-- incoherence.service.ts, appliquerEdition), leur date serait celle du couple. C'est donc
-- `metier_activite.updated_at` qui fait foi pour une rédaction, et le service le touche
-- explicitement même quand seuls les détails changent.
--
-- NULL et non CURRENT_TIMESTAMP par défaut sur les lignes existantes : les dater du jour
-- de la migration laisserait croire que tout le catalogue a été modifié aujourd'hui. Une
-- ligne non datée est affichée comme telle, et se datera à sa première modification.
-- ============================================================

ALTER TABLE metier_activite
  ADD COLUMN created_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN updated_at TIMESTAMP NULL DEFAULT NULL;

ALTER TABLE activite_connaissance
  ADD COLUMN created_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN updated_at TIMESTAMP NULL DEFAULT NULL;

ALTER TABLE formacode
  ADD COLUMN created_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN updated_at TIMESTAMP NULL DEFAULT NULL;

ALTER TABLE formacode_niveau
  ADD COLUMN created_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN updated_at TIMESTAMP NULL DEFAULT NULL;
