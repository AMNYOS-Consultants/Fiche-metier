import { Op, QueryTypes, Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../database/connection';
import {
  Activite,
  Metier,
  MetierActivite,
  ActiviteDetail,
  CompetenceDetail,
  NiveauMaitrise,
  ActiviteConnaissance,
} from '../models';
import { HttpError } from '../types/api';
import { marquerProximitePerimee } from './passerelle.service';

/**
 * Incohérences entre rédactions d'un même couple activité-compétence.
 *
 * Depuis la migration 008, les intitulés, détails, niveaux de maîtrise et domaines de
 * connaissance pendent du COUPLE (`metier_activite`) et non du code activité seul : rien
 * n'empêche deux métiers qui partagent un code de diverger sur leur contenu — c'est le cas
 * pour une partie du catalogue (voir couple.service.ts, « 138 des 279 codes partagés »).
 *
 * Les mots-clés sont volontairement exclus de la comparaison et de l'harmonisation :
 * décision explicite, ils ne sont pas considérés comme faisant partie du « contenu » du
 * couple pour cet usage.
 */

interface ContenuComparable {
  intituleActivite: string | null;
  intituleCompetence: string | null;
  detailsActivite: string[];
  detailsCompetence: string[];
  niveauxMaitrise: Array<{ niveau: number; description: string }>;
  connaissances: Array<{
    codeFormacode: string;
    niveau: number | null;
    dureeHeures: number | null;
    justificationDuree: string | null;
    codeNsf: string | null;
    estFondamental: boolean;
  }>;
}

/** Une ligne `metier_activite` telle que chargée avec tout ce qui compte pour la comparaison. */
interface CoupleCharge {
  id: number;
  codeMetier: string;
  codeActivite: string;
  intituleMetier: string;
  /** `null` pour les couples antérieurs à la migration 012. */
  modifieLe: Date | null;
  contenu: ContenuComparable;
  /** Domaines de connaissance avec leur intitulé — utile à l'affichage, pas à la comparaison. */
  connaissancesAffichage: Array<{ codeFormacode: string; intitule: string | null; niveau: number | null }>;
}

async function chargerCouples(codeActivite?: string): Promise<CoupleCharge[]> {
  const couples = await MetierActivite.findAll({
    where: codeActivite ? { codeActivite } : undefined,
    include: [
      { model: Metier, as: 'metier', attributes: ['codeMetier', 'intitule'] },
      { model: ActiviteDetail, as: 'detailsActivite', separate: true, order: [['ordre', 'ASC']] },
      { model: CompetenceDetail, as: 'detailsCompetence', separate: true, order: [['ordre', 'ASC']] },
      { model: NiveauMaitrise, as: 'niveauxMaitrise', separate: true, order: [['niveau', 'ASC']] },
      { model: ActiviteConnaissance, as: 'connaissances', separate: true, order: [['ordre', 'ASC']] },
    ],
    order: [['codeMetier', 'ASC']],
  });

  return couples.map((c) => {
    const brut = c.toJSON() as unknown as {
      metier?: { codeMetier: string; intitule: string };
      detailsActivite?: Array<{ libelle: string }>;
      detailsCompetence?: Array<{ libelle: string }>;
      niveauxMaitrise?: Array<{ niveau: number; description: string }>;
      connaissances?: Array<{
        codeFormacode: string;
        intitule: string | null;
        niveau: number | null;
        dureeHeures: number | null;
        justificationDuree: string | null;
        codeNsf: string | null;
        estFondamental: boolean;
      }>;
    };

    const connaissances = brut.connaissances ?? [];

    return {
      id: c.id,
      codeMetier: c.codeMetier,
      codeActivite: c.codeActivite,
      intituleMetier: brut.metier?.intitule ?? c.codeMetier,
      modifieLe: c.updatedAt ?? null,
      contenu: {
        intituleActivite: c.intituleActivite,
        intituleCompetence: c.intituleCompetence,
        detailsActivite: (brut.detailsActivite ?? []).map((d) => d.libelle),
        detailsCompetence: (brut.detailsCompetence ?? []).map((d) => d.libelle),
        niveauxMaitrise: (brut.niveauxMaitrise ?? [])
          .map((n) => ({ niveau: n.niveau, description: n.description }))
          .sort((a, b) => a.niveau - b.niveau),
        connaissances: connaissances
          .map((k) => ({
            codeFormacode: k.codeFormacode,
            niveau: k.niveau,
            dureeHeures: k.dureeHeures !== null ? Number(k.dureeHeures) : null,
            justificationDuree: k.justificationDuree,
            codeNsf: k.codeNsf,
            estFondamental: k.estFondamental,
          }))
          .sort((a, b) => a.codeFormacode.localeCompare(b.codeFormacode)),
      },
      connaissancesAffichage: connaissances
        .map((k) => ({ codeFormacode: k.codeFormacode, intitule: k.intitule, niveau: k.niveau }))
        .sort((a, b) => a.codeFormacode.localeCompare(b.codeFormacode)),
    };
  });
}

function signature(c: ContenuComparable): string {
  return JSON.stringify(c);
}

export interface CodeIncoherent {
  codeActivite: string;
  intituleActivite: string;
  nbVariantes: number;
  nbMetiers: number;
}

/** Les codes activité pour lesquels toutes les rédactions ne sont pas identiques. */
export async function listerIncoherences(): Promise<CodeIncoherent[]> {
  const couples = await chargerCouples();

  const parCode = new Map<string, { intitule: string; signatures: Set<string>; nbMetiers: number }>();
  for (const c of couples) {
    if (!parCode.has(c.codeActivite)) {
      parCode.set(c.codeActivite, {
        intitule: c.contenu.intituleActivite ?? c.codeActivite,
        signatures: new Set(),
        nbMetiers: 0,
      });
    }
    const entree = parCode.get(c.codeActivite)!;
    entree.signatures.add(signature(c.contenu));
    entree.nbMetiers++;
  }

  return [...parCode.entries()]
    .filter(([, e]) => e.signatures.size > 1)
    .map(([codeActivite, e]) => ({
      codeActivite,
      intituleActivite: e.intitule,
      nbVariantes: e.signatures.size,
      nbMetiers: e.nbMetiers,
    }))
    .sort((a, b) => b.nbVariantes - a.nbVariantes || a.codeActivite.localeCompare(b.codeActivite));
}

export interface VarianteDetaillee {
  /** Un couple représentatif de cette rédaction — sert de « modèle » si on l'harmonise. */
  coupleModeleId: number;
  /**
   * `coupleId` est nécessaire à l'édition des domaines de connaissance, qui se fait couple
   * par couple. Les formacodes entrent dans la signature comparée : tous les couples d'une
   * même variante en portent donc exactement les mêmes — en modifier un le détachera de
   * cette variante, ce qui est le comportement attendu.
   */
  metiers: Array<{
    coupleId: number;
    codeMetier: string;
    intitule: string;
    /** Dernière modification de la rédaction de CE couple. */
    modifieLe: Date | null;
  }>;
  intituleActivite: string | null;
  intituleCompetence: string | null;
  detailsActivite: string[];
  detailsCompetence: string[];
  niveauxMaitrise: Array<{ niveau: number; description: string }>;
  connaissances: Array<{ codeFormacode: string; intitule: string | null; niveau: number | null }>;
}

/** Les rédactions distinctes d'un code activité, chacune avec les métiers qui la portent. */
export async function obtenirVariantes(codeActivite: string): Promise<VarianteDetaillee[]> {
  const couples = await chargerCouples(codeActivite);
  if (couples.length === 0) throw HttpError.notFound(`Activité ${codeActivite}`);

  const groupes = new Map<string, VarianteDetaillee>();
  for (const c of couples) {
    const sig = signature(c.contenu);
    if (!groupes.has(sig)) {
      groupes.set(sig, {
        coupleModeleId: c.id,
        metiers: [],
        intituleActivite: c.contenu.intituleActivite,
        intituleCompetence: c.contenu.intituleCompetence,
        detailsActivite: c.contenu.detailsActivite,
        detailsCompetence: c.contenu.detailsCompetence,
        niveauxMaitrise: c.contenu.niveauxMaitrise,
        connaissances: c.connaissancesAffichage,
      });
    }
    groupes.get(sig)!.metiers.push({
      coupleId: c.id,
      codeMetier: c.codeMetier,
      intitule: c.intituleMetier,
      modifieLe: c.modifieLe,
    });
  }

  return [...groupes.values()].sort((a, b) => b.metiers.length - a.metiers.length);
}

export interface EditionModele {
  intituleActivite: string | null;
  intituleCompetence: string | null;
  detailsActivite: string[];
  detailsCompetence: string[];
  niveauxMaitrise: Array<{ niveau: number; description: string }>;
}

/**
 * Réécrit la rédaction d'un couple : intitulés, détails et niveaux de maîtrise.
 *
 * Ne touche ni aux mots-clés (exclus de cette notion de « contenu », voir l'en-tête) ni aux
 * domaines de connaissance, qui s'éditent couple par couple
 * (`modifierConnaissancesCouple`, couple.service.ts) : eux seuls entrent dans le calcul des
 * passerelles, d'où la séparation — réécrire un intitulé ne doit rien périmer.
 */
async function appliquerEdition(
  couple: MetierActivite,
  edition: EditionModele,
  transaction: Transaction,
): Promise<void> {
  // `updatedAt` explicite : sans lui, réécrire uniquement les détails ou les niveaux ne
  // toucherait pas la ligne `metier_activite` (Sequelize n'émet pas d'UPDATE quand aucun
  // champ ne change) et le couple resterait daté de sa version précédente. Or c'est sa
  // date qui fait foi pour toute la rédaction : détails et niveaux n'en ont pas.
  await couple.update(
    {
      intituleActivite: edition.intituleActivite,
      intituleCompetence: edition.intituleCompetence,
      updatedAt: new Date(),
    },
    { transaction },
  );

  await Promise.all([
    ActiviteDetail.destroy({ where: { metierActiviteId: couple.id }, transaction }),
    CompetenceDetail.destroy({ where: { metierActiviteId: couple.id }, transaction }),
    NiveauMaitrise.destroy({ where: { metierActiviteId: couple.id }, transaction }),
  ]);

  await Promise.all([
    ActiviteDetail.bulkCreate(
      edition.detailsActivite.map((libelle, i) => ({
        metierActiviteId: couple.id,
        libelle,
        ordre: i + 1,
      })),
      { transaction },
    ),
    CompetenceDetail.bulkCreate(
      edition.detailsCompetence.map((libelle, i) => ({
        metierActiviteId: couple.id,
        libelle,
        ordre: i + 1,
      })),
      { transaction },
    ),
    NiveauMaitrise.bulkCreate(
      edition.niveauxMaitrise.map((n) => ({
        metierActiviteId: couple.id,
        niveau: n.niveau,
        description: n.description,
      })),
      { transaction },
    ),
  ]);
}

/**
 * Réécrit UNE rédaction, sur les seuls couples qui la portent — l'édition depuis la page
 * d'une activité. Les autres rédactions du même code ne sont pas touchées : c'est ce qui
 * distingue cette opération de `harmoniserCouple`, qui les aligne toutes.
 *
 * Si la nouvelle rédaction se trouve être identique à celle d'une autre variante, les deux
 * fusionnent d'elles-mêmes au prochain calcul : les signatures convergent, l'incohérence
 * disparaît.
 */
export async function modifierRedactionVariante(
  codeActivite: string,
  coupleModeleId: number,
  edition: EditionModele,
): Promise<{ nbCouplesModifies: number }> {
  const couples = await chargerCouples(codeActivite);
  const modele = couples.find((c) => c.id === coupleModeleId);
  if (!modele) {
    throw HttpError.badRequest(`Le couple ${coupleModeleId} ne porte pas le code ${codeActivite}`);
  }

  const signatureModele = signature(modele.contenu);
  const aModifier = couples.filter((c) => signature(c.contenu) === signatureModele);

  await sequelize.transaction(async (transaction) => {
    for (const cible of aModifier) {
      const ligne = await MetierActivite.findByPk(cible.id, { transaction });
      if (ligne) await appliquerEdition(ligne, edition, transaction);
    }
  });

  return { nbCouplesModifies: aModifier.length };
}

/**
 * Recopie intégralement la rédaction du couple `coupleModeleId` sur tous les autres couples
 * du même code activité — intitulés, détails, niveaux de maîtrise et domaines de connaissance.
 * Les mots-clés ne sont jamais touchés (`ActiviteMotCle` n'apparaît nulle part ici).
 *
 * `edition`, si fourni, réécrit d'abord le modèle lui-même (tout sauf les domaines de
 * connaissance : les modifier à la main risquerait de référencer un formacode qui n'existe
 * pas — ils restent hérités tels quels). Le tout dans une seule transaction : la fiche modèle
 * et les fiches alignées dessus changent ensemble, ou pas du tout.
 *
 * Périme les passerelles de chaque métier affecté (y compris le modèle s'il est réécrit) :
 * les domaines de connaissance harmonisés peuvent différer de ceux portés avant.
 */
export async function harmoniserCouple(
  codeActivite: string,
  coupleModeleId: number,
  edition?: EditionModele,
): Promise<{ nbMetiersAffectes: number }> {
  const modele = await MetierActivite.findByPk(coupleModeleId);
  if (!modele) throw HttpError.notFound(`Couple ${coupleModeleId}`);
  if (modele.codeActivite !== codeActivite) {
    throw HttpError.badRequest(`Le couple ${coupleModeleId} ne porte pas le code ${codeActivite}`);
  }

  const autres = await MetierActivite.findAll({
    where: { codeActivite, id: { [Op.ne]: coupleModeleId } },
  });

  await sequelize.transaction(async (transaction) => {
    if (edition) {
      await appliquerEdition(modele, edition, transaction);
      await marquerProximitePerimee(modele.codeMetier, transaction);
    }

    if (autres.length === 0) return;

    const [detailsModele, competencesModele, niveauxModele, connaissancesModele] = await Promise.all([
      ActiviteDetail.findAll({ where: { metierActiviteId: coupleModeleId }, transaction }),
      CompetenceDetail.findAll({ where: { metierActiviteId: coupleModeleId }, transaction }),
      NiveauMaitrise.findAll({ where: { metierActiviteId: coupleModeleId }, transaction }),
      ActiviteConnaissance.findAll({ where: { metierActiviteId: coupleModeleId }, transaction }),
    ]);
    const intituleActivite = edition ? edition.intituleActivite : modele.intituleActivite;
    const intituleCompetence = edition ? edition.intituleCompetence : modele.intituleCompetence;

    for (const cible of autres) {
      await cible.update({ intituleActivite, intituleCompetence }, { transaction });

      await Promise.all([
        ActiviteDetail.destroy({ where: { metierActiviteId: cible.id }, transaction }),
        CompetenceDetail.destroy({ where: { metierActiviteId: cible.id }, transaction }),
        NiveauMaitrise.destroy({ where: { metierActiviteId: cible.id }, transaction }),
        ActiviteConnaissance.destroy({ where: { metierActiviteId: cible.id }, transaction }),
      ]);

      await Promise.all([
        ActiviteDetail.bulkCreate(
          detailsModele.map((d) => ({ metierActiviteId: cible.id, libelle: d.libelle, ordre: d.ordre })),
          { transaction },
        ),
        CompetenceDetail.bulkCreate(
          competencesModele.map((d) => ({ metierActiviteId: cible.id, libelle: d.libelle, ordre: d.ordre })),
          { transaction },
        ),
        NiveauMaitrise.bulkCreate(
          niveauxModele.map((n) => ({
            metierActiviteId: cible.id,
            niveau: n.niveau,
            description: n.description,
          })),
          { transaction },
        ),
        ActiviteConnaissance.bulkCreate(
          connaissancesModele.map((k) => ({
            metierActiviteId: cible.id,
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

      await marquerProximitePerimee(cible.codeMetier, transaction);
    }
  });

  return { nbMetiersAffectes: autres.length };
}

export interface ResultatScission {
  /** Le code créé, dans le même halo que celui d'origine. */
  codeActivite: string;
  nbMetiersDeplaces: number;
}

/**
 * Le « halo » d'un code activité : ses trois premiers segments. `I.02.08.01` -> `I.02.08`,
 * qui regroupe les déclinaisons `I.02.08.01`, `.02`, `.03`…
 */
function halo(codeActivite: string): string {
  const segments = codeActivite.split('.');
  if (segments.length < 4) {
    throw HttpError.badRequest(
      `Le code ${codeActivite} ne suit pas la nomenclature (A.00.00.00 attendu) : impossible d’en déduire un halo.`,
    );
  }
  return segments.slice(0, 3).join('.');
}

/**
 * Prochain code libre du halo : `MAX(dernier segment) + 1`, et non `COUNT + 1`.
 * La numérotation porte des trous (le halo K.01.03 compte 26 déclinaisons mais va jusqu'à
 * `.29`) — compter les lignes finirait par proposer un code déjà pris.
 */
async function prochainCodeDuHalo(codeActivite: string, transaction: Transaction): Promise<string> {
  const prefixe = `${halo(codeActivite)}.`;

  const [{ maxSuffixe }] = await sequelize.query<{ maxSuffixe: number | null }>(
    `SELECT MAX(CAST(SUBSTRING_INDEX(code_activite, '.', -1) AS UNSIGNED)) AS maxSuffixe
       FROM activite
      WHERE code_activite LIKE :prefixe`,
    { replacements: { prefixe: `${prefixe}%` }, type: QueryTypes.SELECT, transaction },
  );

  const suivant = (maxSuffixe ?? 0) + 1;
  if (suivant > 99) {
    throw HttpError.badRequest(
      `Le halo ${halo(codeActivite)} est saturé (dernier code .${maxSuffixe}) : la nomenclature ne prévoit que deux chiffres.`,
    );
  }

  return `${prefixe}${String(suivant).padStart(2, '0')}`;
}

/**
 * Détache une rédaction divergente vers un NOUVEAU code activité du même halo, au lieu de
 * l'aligner sur les autres : c'est la sortie à prendre quand la divergence est légitime —
 * deux métiers ne décrivent pas la même activité, ils ne devraient pas partager un code.
 *
 * Tous les couples qui portent exactement cette rédaction suivent. Leurs détails, niveaux
 * de maîtrise, mots-clés et domaines de connaissance pendent de `metier_activite.id`
 * (migrations 006 et 008) : ils n'ont rien à recopier, ils suivent le couple déplacé.
 *
 * La famille est reprise de l'activité d'origine plutôt que déduite : le nouveau code
 * partage son halo, donc sa lettre et son sous-code — c'est la même famille par construction.
 *
 * Aucune passerelle n'est périmée : `passerelle.service.ts` ne regarde jamais le code
 * activité, seulement les formacodes portés par le métier — inchangés ici.
 */
export async function scinderVariante(
  codeActivite: string,
  coupleModeleId: number,
  edition?: EditionModele,
): Promise<ResultatScission> {
  const couples = await chargerCouples(codeActivite);
  const modele = couples.find((c) => c.id === coupleModeleId);
  if (!modele) {
    throw HttpError.badRequest(`Le couple ${coupleModeleId} ne porte pas le code ${codeActivite}`);
  }

  // La rédaction fait l'unité de scission : tous les couples qui la partagent partent ensemble.
  const signatureModele = signature(modele.contenu);
  const aDeplacer = couples.filter((c) => signature(c.contenu) === signatureModele);

  if (aDeplacer.length === couples.length) {
    throw HttpError.badRequest(
      `Les ${couples.length} métier(s) portant ${codeActivite} ont tous la même rédaction : il n’y a rien à détacher.`,
    );
  }

  const activiteOrigine = await Activite.findByPk(codeActivite);
  if (!activiteOrigine) throw HttpError.notFound(`Activité ${codeActivite}`);

  const intituleActivite = edition ? edition.intituleActivite : modele.contenu.intituleActivite;
  const intituleCompetence = edition ? edition.intituleCompetence : modele.contenu.intituleCompetence;

  try {
    return await sequelize.transaction(async (transaction) => {
      const nouveauCode = await prochainCodeDuHalo(codeActivite, transaction);

      await Activite.create(
        {
          codeActivite: nouveauCode,
          codeFamilleActivite: activiteOrigine.codeFamilleActivite,
          intituleActivite: intituleActivite ?? nouveauCode,
          intituleCompetence,
          dossierSourceId: activiteOrigine.dossierSourceId,
        },
        { transaction },
      );

      for (const couple of aDeplacer) {
        const ligne = await MetierActivite.findByPk(couple.id, { transaction });
        if (!ligne) continue;

        await ligne.update({ codeActivite: nouveauCode }, { transaction });
        if (edition) await appliquerEdition(ligne, edition, transaction);
      }

      return { codeActivite: nouveauCode, nbMetiersDeplaces: aDeplacer.length };
    });
  } catch (err) {
    // Deux scissions simultanées sur le même halo viseraient le même numéro : le dire
    // plutôt que de renvoyer une erreur SQL brute, l'utilisateur n'a qu'à relancer.
    if (err instanceof UniqueConstraintError) {
      throw HttpError.conflict(
        `Un autre code vient d’être créé dans le halo ${halo(codeActivite)} : relancez l’opération.`,
      );
    }
    throw err;
  }
}
