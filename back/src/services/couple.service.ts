import { Op, QueryTypes, Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../database/connection';
import {
  Activite,
  FamilleActivite,
  Metier,
  MetierActivite,
  ActiviteConnaissance,
  ActiviteDetail,
  CompetenceDetail,
  NiveauMaitrise,
  ActiviteMotCle,
  MotCle,
  Formacode,
} from '../models';
import { HttpError } from '../types/api';
import { marquerProximitePerimee } from './passerelle.service';

/**
 * Ajout et suppression de couples activité-compétence sur une fiche métier.
 *
 * Point de vigilance central : depuis la migration 008, les formacodes pendent du COUPLE et
 * non du code activité. Deux métiers qui emploient le même code activité peuvent donc porter
 * des domaines de connaissance différents — c'est le cas de 138 des 279 codes partagés.
 * Il n'existe par conséquent aucun jeu de formacodes déductible d'un code activité seul :
 * un ajout recopie toujours un couple existant, désigné explicitement par l'appelant.
 */

/** Réaligne `metier.nb_couple` sur le nombre réel de couples de la fiche. */
async function resynchroniserNbCouple(codeMetier: string, transaction: Transaction): Promise<void> {
  const total = await MetierActivite.count({ where: { codeMetier }, transaction });
  await Metier.update({ nbCouple: total }, { where: { codeMetier }, transaction, silent: true });
}

export interface VarianteCouple {
  coupleId: number;
  codeMetier: string;
  intituleMetier: string;
  intituleActivite: string | null;
  intituleCompetence: string | null;
  /** Domaines portés par CE couple : ce qui sera recopié sur la fiche. */
  formacodes: Array<{ codeFormacode: string; intitule: string | null; niveau: number | null }>;
}

/**
 * Les couples déjà rédigés pour un code activité, chacun avec ses formacodes — de quoi
 * choisir lequel recopier. Le métier `exclure` (la fiche de destination) est retiré : il ne
 * peut pas se servir de modèle à lui-même.
 */
export async function listerVariantes(
  codeActivite: string,
  exclure?: string,
): Promise<VarianteCouple[]> {
  const couples = await MetierActivite.findAll({
    where: { codeActivite },
    include: [
      { model: Metier, as: 'metier', attributes: ['codeMetier', 'intitule'] },
      {
        model: ActiviteConnaissance,
        as: 'connaissances',
        separate: true,
        order: [['ordre', 'ASC']],
      },
    ],
    order: [['codeMetier', 'ASC']],
  });

  return couples
    .filter((c) => c.codeMetier !== exclure)
    .map((c) => {
      const brut = c.toJSON() as typeof c & {
        metier?: { intitule: string };
        connaissances?: ActiviteConnaissance[];
      };
      return {
        coupleId: c.id,
        codeMetier: c.codeMetier,
        intituleMetier: brut.metier?.intitule ?? c.codeMetier,
        intituleActivite: c.intituleActivite,
        intituleCompetence: c.intituleCompetence,
        formacodes: (brut.connaissances ?? []).map((k) => ({
          codeFormacode: k.codeFormacode,
          intitule: k.intitule,
          niveau: k.niveau,
        })),
      };
    });
}

/**
 * Les codes activité ajoutables à une fiche : tout le catalogue sauf ceux qu'elle porte déjà,
 * avec le nombre de rédactions disponibles. `recherche` filtre sur le code et les intitulés.
 */
export async function listerActivitesAjoutables(
  codeMetier: string,
  recherche: string | undefined,
  limite = 50,
): Promise<
  Array<{
    codeActivite: string;
    intituleActivite: string;
    intituleCompetence: string | null;
    nbVariantes: number;
  }>
> {
  const filtre = recherche?.trim()
    ? `AND (a.code_activite LIKE :terme OR a.intitule_activite LIKE :terme
            OR a.intitule_competence LIKE :terme)`
    : '';

  return sequelize.query(
    `SELECT a.code_activite       AS codeActivite,
            a.intitule_activite   AS intituleActivite,
            a.intitule_competence AS intituleCompetence,
            COUNT(ma.id)          AS nbVariantes
       FROM activite a
       JOIN metier_activite ma ON ma.code_activite = a.code_activite
      WHERE a.code_activite NOT IN (
              SELECT code_activite FROM metier_activite WHERE code_metier = :codeMetier)
        ${filtre}
      GROUP BY a.code_activite, a.intitule_activite, a.intitule_competence
      ORDER BY a.intitule_activite
      LIMIT :limite`,
    {
      replacements: { codeMetier, limite, ...(filtre ? { terme: `%${recherche!.trim()}%` } : {}) },
      type: QueryTypes.SELECT,
    },
  );
}

/**
 * Ajoute un couple à une fiche en recopiant intégralement `coupleSourceId` : intitulés
 * contextualisés, détails activité et compétence, niveaux de maîtrise, mots-clés et
 * domaines de connaissance. Le couple copié est ensuite modifiable indépendamment — les
 * deux fiches ne partagent aucune ligne.
 */
export async function ajouterCouple(
  codeMetier: string,
  coupleSourceId: number,
): Promise<MetierActivite> {
  const source = await MetierActivite.findByPk(coupleSourceId);
  if (!source) throw HttpError.notFound(`Couple ${coupleSourceId}`);
  if (source.codeMetier === codeMetier) {
    throw HttpError.badRequest('Ce couple appartient déjà à cette fiche');
  }

  const dejaPresent = await MetierActivite.findOne({
    where: { codeMetier, codeActivite: source.codeActivite },
  });
  if (dejaPresent) {
    throw HttpError.badRequest(
      `L'activité ${source.codeActivite} figure déjà sur cette fiche`,
    );
  }

  return sequelize.transaction(async (transaction) => {
    // `ordre` est unique par (code_metier, ordre) : le nouveau couple se place en fin de
    // fiche. MAX + 1 plutôt que COUNT + 1 — les suppressions laissent des trous.
    const [{ maxOrdre }] = await sequelize.query<{ maxOrdre: number | null }>(
      `SELECT MAX(ordre) AS maxOrdre FROM metier_activite WHERE code_metier = :codeMetier`,
      { replacements: { codeMetier }, type: QueryTypes.SELECT, transaction },
    );

    const couple = await MetierActivite.create(
      {
        codeMetier,
        codeActivite: source.codeActivite,
        ordre: (maxOrdre ?? 0) + 1,
        intituleActivite: source.intituleActivite,
        intituleCompetence: source.intituleCompetence,
      },
      { transaction },
    );

    const [details, competences, niveaux, motsCles, connaissances] = await Promise.all([
      ActiviteDetail.findAll({ where: { metierActiviteId: source.id }, transaction }),
      CompetenceDetail.findAll({ where: { metierActiviteId: source.id }, transaction }),
      NiveauMaitrise.findAll({ where: { metierActiviteId: source.id }, transaction }),
      ActiviteMotCle.findAll({ where: { metierActiviteId: source.id }, transaction }),
      ActiviteConnaissance.findAll({ where: { metierActiviteId: source.id }, transaction }),
    ]);

    await Promise.all([
      ActiviteDetail.bulkCreate(
        details.map((d) => ({ metierActiviteId: couple.id, libelle: d.libelle, ordre: d.ordre })),
        { transaction },
      ),
      CompetenceDetail.bulkCreate(
        competences.map((d) => ({
          metierActiviteId: couple.id,
          libelle: d.libelle,
          ordre: d.ordre,
        })),
        { transaction },
      ),
      NiveauMaitrise.bulkCreate(
        niveaux.map((n) => ({
          metierActiviteId: couple.id,
          niveau: n.niveau,
          description: n.description,
        })),
        { transaction },
      ),
      ActiviteMotCle.bulkCreate(
        motsCles.map((m) => ({
          metierActiviteId: couple.id,
          motCleId: m.motCleId,
          ordre: m.ordre,
        })),
        { transaction },
      ),
      ActiviteConnaissance.bulkCreate(
        connaissances.map((k) => ({
          metierActiviteId: couple.id,
          codeFormacode: k.codeFormacode,
          intitule: k.intitule,
          niveau: k.niveau,
          dureeHeures: k.dureeHeures,
          justificationDuree: k.justificationDuree,
          codeNsf: k.codeNsf,
          estFondamental: k.estFondamental,
          ordre: k.ordre,
        })),
        { transaction },
      ),
    ]);

    await resynchroniserNbCouple(codeMetier, transaction);
    await marquerProximitePerimee(codeMetier, transaction);
    return couple;
  });
}

/**
 * Retire un couple de la fiche. Les détails, niveaux, mots-clés et domaines de connaissance
 * partent avec lui : les cinq tables filles sont en `ON DELETE CASCADE` (migration 001).
 * Le tableau des domaines structurants étant recalculé à la volée par un `GROUP BY` sur les
 * couples restants, il n'y a rien d'autre à synchroniser.
 */
export async function supprimerCouple(codeMetier: string, coupleId: number): Promise<void> {
  const couple = await MetierActivite.findOne({ where: { id: coupleId, codeMetier } });
  if (!couple) throw HttpError.notFound(`Couple ${coupleId} sur la fiche ${codeMetier}`);

  await sequelize.transaction(async (transaction) => {
    await couple.destroy({ transaction });
    await resynchroniserNbCouple(codeMetier, transaction);
    await marquerProximitePerimee(codeMetier, transaction);
  });
}

export interface LigneConnaissance {
  codeFormacode: string;
  niveau: number | null;
}

/**
 * Remplace les domaines de connaissance d'UN couple — ils pendent du couple, pas du code
 * activité : deux métiers qui partagent un code portent chacun les leurs (voir l'en-tête
 * de ce fichier).
 *
 * Les lignes conservées ne sont pas détruites puis recréées mais mises à jour : elles
 * portent une durée, une justification et un NSF venus des classeurs, que la page d'édition
 * ne saisit pas et qui seraient perdus par un remplacement sec. Seules les lignes retirées
 * disparaissent, et les nouvelles héritent leur durée de `formacode_niveau` pour le niveau
 * choisi (comme à l'import) plutôt que de rester vides sur la fiche métier.
 *
 * Périme les passerelles du métier : `comparerMetiers()` lit le couple (formacode, niveau)
 * de `activite_connaissance` — le modifier change le degré d'élargissement.
 */
export async function modifierConnaissancesCouple(
  codeActivite: string,
  coupleId: number,
  lignes: LigneConnaissance[],
): Promise<ActiviteConnaissance[]> {
  const couple = await MetierActivite.findOne({ where: { id: coupleId, codeActivite } });
  if (!couple) throw HttpError.notFound(`Couple ${coupleId} sur l’activité ${codeActivite}`);

  await sequelize.transaction(async (transaction) => {
    await ecrireConnaissances(coupleId, lignes, transaction);
    await marquerProximitePerimee(couple.codeMetier, transaction);
  });

  return ActiviteConnaissance.findAll({
    where: { metierActiviteId: coupleId },
    order: [['ordre', 'ASC']],
  });
}

/**
 * Écrit le jeu de domaines d'un couple dans une transaction en cours — partagé par
 * l'édition et la création d'un couple. N'appelle pas `marquerProximitePerimee` :
 * c'est à l'appelant de le faire, une seule fois pour son métier.
 */
async function ecrireConnaissances(
  coupleId: number,
  lignes: LigneConnaissance[],
  transaction: Transaction,
): Promise<void> {
  const codes = lignes.map((l) => l.codeFormacode);
  if (new Set(codes).size !== codes.length) {
    throw HttpError.badRequest('Un même formacode est envoyé deux fois');
  }

  // Un code inconnu violerait la clé étrangère : le refuser ici donne un message utile.
  const connus = await Formacode.findAll({
    where: { codeFormacode: codes },
    attributes: ['codeFormacode', 'intitule', 'codeNsf'],
    transaction,
  });
  const parCode = new Map(connus.map((f) => [f.codeFormacode, f]));
  const inconnus = codes.filter((c) => !parCode.has(c));
  if (inconnus.length > 0) {
    throw HttpError.badRequest(`Formacode(s) inconnu(s) : ${inconnus.join(', ')}`);
  }

  const existantes = await ActiviteConnaissance.findAll({
    where: { metierActiviteId: coupleId },
    transaction,
  });
  const existantesParCode = new Map(existantes.map((c) => [c.codeFormacode, c]));

  for (const [index, ligne] of lignes.entries()) {
    const ordre = index + 1;
    const existante = existantesParCode.get(ligne.codeFormacode);

    if (existante) {
      await existante.update({ niveau: ligne.niveau, ordre }, { transaction });
      continue;
    }

    const formacode = parCode.get(ligne.codeFormacode)!;
    await ActiviteConnaissance.create(
      {
        metierActiviteId: coupleId,
        codeFormacode: ligne.codeFormacode,
        intitule: formacode.intitule,
        niveau: ligne.niveau,
        dureeHeures: await dureeDeReference(ligne.codeFormacode, ligne.niveau, transaction),
        justificationDuree: null,
        codeNsf: formacode.codeNsf,
        estFondamental: false,
        ordre,
      },
      { transaction },
    );
  }

  const gardes = new Set(codes);
  for (const existante of existantes) {
    if (!gardes.has(existante.codeFormacode)) await existante.destroy({ transaction });
  }
}

/**
 * Durée de référence d'un (formacode, niveau) : la ligne `formacode_niveau` de l'origine la
 * plus fiable, même priorité que `comparerMetiers()` et `chargerDureesParFormacodeNiveau()`.
 */
async function dureeDeReference(
  codeFormacode: string,
  niveau: number | null,
  transaction: Transaction,
): Promise<number | null> {
  if (niveau === null) return null;

  const [ligne] = await sequelize.query<{ dureeHeures: string | null }>(
    `SELECT duree_heures AS dureeHeures
       FROM formacode_niveau
      WHERE code_formacode = :codeFormacode AND niveau = :niveau
      ORDER BY CASE origine
                 WHEN 'outil_fiche_metier' THEN 3
                 WHEN 'base_formacodes' THEN 2
                 WHEN 'base_competences' THEN 1
                 ELSE 0
               END DESC
      LIMIT 1`,
    { replacements: { codeFormacode, niveau }, type: QueryTypes.SELECT, transaction },
  );

  return ligne?.dureeHeures !== null && ligne?.dureeHeures !== undefined
    ? Number(ligne.dureeHeures)
    : null;
}

/** Trois mots-clés au maximum dans les classeurs sources ; on laisse une marge pour la saisie manuelle. */
export const MAX_MOTS_CLES = 10;

/**
 * Réécrit les mots-clés d'UN couple. Comme les domaines de connaissance, portée limitée à
 * un couple : deux métiers qui partagent un code activité peuvent avoir des mots-clés
 * différents (constaté sur le catalogue — voir `incoherence.service.ts`, qui les exclut
 * volontairement de la comparaison des rédactions).
 */
export async function modifierMotsClesCouple(
  codeActivite: string,
  coupleId: number,
  libelles: string[],
): Promise<string[]> {
  const couple = await MetierActivite.findOne({ where: { id: coupleId, codeActivite } });
  if (!couple) throw HttpError.notFound(`Couple ${coupleId} sur l’activité ${codeActivite}`);

  await sequelize.transaction(async (transaction) => {
    await ecrireMotsCles(coupleId, libelles, transaction);
  });

  // Pas d'association directe ActiviteMotCle → MotCle (c'est un belongsToMany porté par
  // MetierActivite) : requête brute plutôt qu'un include à deux niveaux pour ce seul besoin.
  const lignes = await sequelize.query<{ libelle: string }>(
    `SELECT mc.libelle
       FROM activite_mot_cle amc
       JOIN mot_cle mc ON mc.id = amc.mot_cle_id
      WHERE amc.metier_activite_id = :coupleId
      ORDER BY amc.ordre`,
    { replacements: { coupleId }, type: QueryTypes.SELECT },
  );
  return lignes.map((l) => l.libelle);
}

/**
 * Écrit le jeu de mots-clés d'un couple dans une transaction en cours — partagé par
 * l'édition et la création d'un couple (`creerCoupleActivite`, qui recopie ceux du modèle).
 *
 * Les libellés sont résolus vers `mot_cle` (créés s'ils n'existent pas encore, dédupliqués
 * globalement par leur contrainte `UNIQUE`), et les lignes `mot_cle` devenues orphelines
 * après retrait sont purgées — même logique que l'import général du classeur
 * (`services/classeur/import.service.ts`), qui ne définit pas cette table comme un
 * référentiel à part mais comme une simple reconstitution des libellés employés.
 */
async function ecrireMotsCles(
  coupleId: number,
  libellesBruts: string[],
  transaction: Transaction,
): Promise<void> {
  const libelles = libellesBruts.map((l) => l.trim()).filter((l) => l !== '');
  if (new Set(libelles).size !== libelles.length) {
    throw HttpError.badRequest('Un même mot-clé est envoyé deux fois');
  }

  const motsCles = new Map<string, MotCle>();
  if (libelles.length > 0) {
    const existants = await MotCle.findAll({ where: { libelle: libelles }, transaction });
    for (const m of existants) motsCles.set(m.libelle, m);

    const manquants = libelles.filter((l) => !motsCles.has(l));
    for (const libelle of manquants) {
      motsCles.set(libelle, await MotCle.create({ libelle }, { transaction }));
    }
  }

  const existantes = await ActiviteMotCle.findAll({ where: { metierActiviteId: coupleId }, transaction });
  const idsAvant = existantes.map((e) => e.motCleId);

  await ActiviteMotCle.destroy({ where: { metierActiviteId: coupleId }, transaction });
  if (libelles.length > 0) {
    await ActiviteMotCle.bulkCreate(
      libelles.map((libelle, index) => ({
        metierActiviteId: coupleId,
        motCleId: motsCles.get(libelle)!.id,
        ordre: index + 1,
      })),
      { transaction },
    );
  }

  // Un mot-clé retiré ici peut être resté employé par d'autres couples : ne purger que
  // ceux qu'aucun couple ne cite plus. Requête brute plutôt qu'un `Op` Sequelize pour la
  // sous-clause NOT EXISTS — même approche que la purge de l'import général du classeur.
  const idsAPurger = idsAvant.filter((id) => !libelles.some((l) => motsCles.get(l)?.id === id));
  if (idsAPurger.length > 0) {
    await sequelize.query(
      `DELETE FROM mot_cle
        WHERE id IN (:ids)
          AND NOT EXISTS (SELECT 1 FROM activite_mot_cle amc WHERE amc.mot_cle_id = mot_cle.id)`,
      { replacements: { ids: idsAPurger }, type: QueryTypes.DELETE, transaction },
    );
  }
}

/**
 * Où placer le nouveau couple dans la nomenclature `A.00.00.00`. Exactement une des trois
 * formes, de la plus précise à la plus large :
 *   - `halo` : le 3e segment existe, on ajoute une déclinaison (4e segment).
 *   - `famille` : le 2e segment existe, on ajoute une activité (3e segment, déclinaison 01).
 *   - `nouvelleFamille` : on crée le 2e segment, sous une lettre existante ou nouvelle.
 */
export interface EmplacementCouple {
  famille?: string;
  halo?: string;
  nouvelleFamille?: {
    lettre: string;
    /** Requis seulement si la lettre est nouvelle : sinon il est repris de ses familles. */
    domaine1?: string;
    domaine2: string;
    domaine3?: string;
  };
}

export interface CreationCouple extends EmplacementCouple {
  codeMetier: string;
  intituleActivite: string;
  intituleCompetence: string | null;
  detailsActivite: string[];
  detailsCompetence: string[];
  niveauxMaitrise: Array<{ niveau: number; description: string }>;
  connaissances: LigneConnaissance[];
}

/**
 * Prochain numéro libre d'un segment : `MAX + 1`, jamais `COUNT + 1`.
 * La numérotation porte des trous à tous les niveaux — la famille K.02 compte 71 activités
 * mais son 3e segment va jusqu'à 77, et le halo K.01.03 compte 26 déclinaisons pour un 4e
 * segment jusqu'à 29. Compter les lignes proposerait un code déjà pris.
 */
async function prochainSegment(
  prefixe: string,
  rang: 3 | 4,
  transaction: Transaction,
): Promise<string> {
  const expression =
    rang === 3
      ? `SUBSTRING_INDEX(SUBSTRING_INDEX(code_activite, '.', 3), '.', -1)`
      : `SUBSTRING_INDEX(code_activite, '.', -1)`;

  const [{ maxSegment }] = await sequelize.query<{ maxSegment: number | null }>(
    `SELECT MAX(CAST(${expression} AS UNSIGNED)) AS maxSegment
       FROM activite
      WHERE code_activite LIKE :prefixe`,
    { replacements: { prefixe: `${prefixe}.%` }, type: QueryTypes.SELECT, transaction },
  );

  const suivant = (maxSegment ?? 0) + 1;
  if (suivant > 99) {
    throw HttpError.badRequest(
      `${prefixe} est saturé (dernier numéro ${maxSegment}) : la nomenclature ne prévoit que deux chiffres par segment.`,
    );
  }
  return String(suivant).padStart(2, '0');
}

/**
 * Crée un couple activité-compétence de toutes pièces : une entrée de catalogue (`activite`)
 * ET son rattachement à une fiche métier (`metier_activite`).
 *
 * Les deux vont ensemble par nécessité : `listerActivitesAjoutables()` ne propose que des
 * codes déjà rédigés quelque part (jointure interne sur `metier_activite`), et
 * `ajouterCouple()` recopie un couple existant. Une entrée de catalogue sans métier serait
 * donc impossible à rattacher ensuite par l'interface.
 *
 * Le code est attribué, jamais saisi : `famille` donne une nouvelle activité
 * (`I.02` -> `I.02.24.01`), `halo` une nouvelle déclinaison (`I.02.08` -> `I.02.08.24`).
 */
/**
 * Crée la famille demandée et renvoie son code. Le 2e segment est attribué (`MAX + 1` parmi
 * les familles de la lettre), jamais saisi — comme les autres segments.
 *
 * `domaine_1` est une donnée de la lettre, pas de la famille : il est constant sur toutes
 * les familles d'une même lettre (vérifié sur les 39 entrées). On le reprend donc des
 * familles existantes de la lettre, et on ne l'exige de l'appelant que pour une lettre neuve.
 */
async function creerFamille(
  nouvelle: NonNullable<EmplacementCouple['nouvelleFamille']>,
  transaction: Transaction,
): Promise<string> {
  const lettre = nouvelle.lettre.toUpperCase();
  if (!/^[A-Z]$/.test(lettre)) {
    throw HttpError.badRequest(`Lettre de domaine invalide : ${nouvelle.lettre} (A à Z attendu)`);
  }

  const soeurs = await FamilleActivite.findAll({
    where: { codeFamilleActivite: { [Op.like]: `${lettre}.%` } },
    transaction,
  });

  const domaine1 = soeurs.length > 0 ? soeurs[0].domaine1 : (nouvelle.domaine1?.trim() ?? '');
  if (!domaine1) {
    throw HttpError.badRequest(
      `La lettre ${lettre} est nouvelle : son libellé de domaine d’activité 1 est requis.`,
    );
  }

  const maxSegment = Math.max(
    0,
    ...soeurs.map((f) => Number(f.codeFamilleActivite.split('.')[1])),
  );
  if (maxSegment + 1 > 99) {
    throw HttpError.badRequest(
      `La lettre ${lettre} est saturée (dernière famille ${lettre}.${maxSegment}).`,
    );
  }

  const code = `${lettre}.${String(maxSegment + 1).padStart(2, '0')}`;
  await FamilleActivite.create(
    {
      codeFamilleActivite: code,
      domaine1,
      domaine2: nouvelle.domaine2,
      domaine3: nouvelle.domaine3?.trim() || null,
      // Aucun exemple de compétence contextualisée : la colonne ne vient que du classeur.
      exempleCompetence: null,
    },
    { transaction },
  );

  return code;
}

export async function creerCoupleActivite(
  donnees: CreationCouple,
): Promise<{ codeActivite: string; coupleId: number }> {
  const emplacements = [donnees.famille, donnees.halo, donnees.nouvelleFamille].filter(
    (v) => v !== undefined,
  );
  if (emplacements.length !== 1) {
    throw HttpError.badRequest(
      'Indiquer un seul emplacement : une famille, un halo, ou une nouvelle famille.',
    );
  }

  const metier = await Metier.findByPk(donnees.codeMetier, { attributes: ['codeMetier'] });
  if (!metier) throw HttpError.notFound(`Métier ${donnees.codeMetier}`);

  if (donnees.famille || donnees.halo) {
    const codeFamille = donnees.famille ?? donnees.halo!.split('.').slice(0, 2).join('.');
    const famille = await FamilleActivite.findByPk(codeFamille, {
      attributes: ['codeFamilleActivite'],
    });
    if (!famille) throw HttpError.badRequest(`Famille d’activité inconnue : ${codeFamille}`);
  }

  if (donnees.halo) {
    // Un halo n'existe que par les activités qui le portent : refuser d'en inventer un ici,
    // c'est le rôle de `famille` (qui, lui, attribue un 3e segment neuf).
    const existe = await MetierActivite.count({
      where: { codeActivite: { [Op.like]: `${donnees.halo}.%` } },
    });
    if (existe === 0) {
      throw HttpError.badRequest(
        `Le halo ${donnees.halo} n’existe pas : créez plutôt une nouvelle activité dans sa famille.`,
      );
    }
  }

  try {
    return await sequelize.transaction(async (transaction) => {
      const codeFamille = donnees.nouvelleFamille
        ? await creerFamille(donnees.nouvelleFamille, transaction)
        : (donnees.famille ?? donnees.halo!.split('.').slice(0, 2).join('.'));

      // Une famille neuve ne porte encore aucune activité : `prochainSegment` y renvoie 01.
      const codeActivite = donnees.halo
        ? `${donnees.halo}.${await prochainSegment(donnees.halo, 4, transaction)}`
        : `${codeFamille}.${await prochainSegment(codeFamille, 3, transaction)}.01`;

      await Activite.create(
        {
          codeActivite,
          codeFamilleActivite: codeFamille,
          intituleActivite: donnees.intituleActivite,
          intituleCompetence: donnees.intituleCompetence,
          // Aucun dossier source : ce couple ne vient d'aucun classeur de collecte.
          dossierSourceId: null,
        },
        { transaction },
      );

      const [{ maxOrdre }] = await sequelize.query<{ maxOrdre: number | null }>(
        `SELECT MAX(ordre) AS maxOrdre FROM metier_activite WHERE code_metier = :codeMetier`,
        { replacements: { codeMetier: donnees.codeMetier }, type: QueryTypes.SELECT, transaction },
      );

      const couple = await MetierActivite.create(
        {
          codeMetier: donnees.codeMetier,
          codeActivite,
          ordre: (maxOrdre ?? 0) + 1,
          intituleActivite: donnees.intituleActivite,
          intituleCompetence: donnees.intituleCompetence,
        },
        { transaction },
      );

      await Promise.all([
        ActiviteDetail.bulkCreate(
          donnees.detailsActivite.map((libelle, i) => ({
            metierActiviteId: couple.id,
            libelle,
            ordre: i + 1,
          })),
          { transaction },
        ),
        CompetenceDetail.bulkCreate(
          donnees.detailsCompetence.map((libelle, i) => ({
            metierActiviteId: couple.id,
            libelle,
            ordre: i + 1,
          })),
          { transaction },
        ),
        NiveauMaitrise.bulkCreate(
          donnees.niveauxMaitrise.map((n) => ({
            metierActiviteId: couple.id,
            niveau: n.niveau,
            description: n.description,
          })),
          { transaction },
        ),
      ]);

      if (donnees.connaissances.length > 0) {
        await ecrireConnaissances(couple.id, donnees.connaissances, transaction);
      }

      await resynchroniserNbCouple(donnees.codeMetier, transaction);
      await marquerProximitePerimee(donnees.codeMetier, transaction);

      return { codeActivite, coupleId: couple.id };
    });
  } catch (err) {
    // Deux créations simultanées sur la même famille viseraient le même numéro.
    if (err instanceof UniqueConstraintError) {
      throw HttpError.conflict(
        'Un autre code vient d’être créé au même emplacement : relancez l’opération.',
      );
    }
    throw err;
  }
}

