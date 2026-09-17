import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  obtenirMetier,
  modifierMetier,
  modifierAppellations,
  modifierCodesRome,
  supprimerMetier,
  obtenirActivitesMetier,
  obtenirConnaissancesMetier,
  listerMetiersProches,
  ajouterCouple,
  supprimerCouple,
  obtenirEtatProximites,
  recalculerProximites,
  modifierTransversales,
  modifierConditions,
  modifierAcces,
} from '@/api/metiers';
import { obtenirReferentiels } from '@/api/activites';
import { ApiError } from '@/api/client';
import { useFetch } from '@/hooks/useFetch';
import { Loader } from '@/components/Loader';
import { ErrorMessage } from '@/components/ErrorMessage';
import {
  TransversalesFiche,
  valeurInitiale,
  VALEUR_ABSENTE,
  VALEUR_NON_CONCERNE,
} from '@/components/TransversalesFiche';
import { ConditionsFiche } from '@/components/ConditionsFiche';
import { AccesFiche } from '@/components/AccesFiche';
import { CouplesFiche } from '@/components/CouplesFiche';
import { AjoutCouple } from '@/components/AjoutCouple';
import { ConnaissancesFiche } from '@/components/ConnaissancesFiche';
import { FiltresPasserelles } from '@/components/FiltresPasserelles';
import { dateModification, libelleFamille } from '@/utils/format';
import type { MetierTransversale, MetierCondition } from '@/types/api';

export function MetierDetailPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [suppressionMetierEnCours, setSuppressionMetierEnCours] = useState(false);
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null);
  const [exportEnCours, setExportEnCours] = useState(false);
  const [modeleExport, setModeleExport] = useState<'standard' | 'ocapiat' | 'ocapiat-client'>('standard');
  const [dcMin, setDcMin] = useState(1);
  const [heuresMax, setHeuresMax] = useState(2000);
  const [degreMin, setDegreMin] = useState(0.1);
  const [memeFamille, setMemeFamille] = useState(false);

  const [rechargerMetier, setRechargerMetier] = useState(0);

  // Édition des appellations et des codes ROME — deux listes courtes en texte libre / codes,
  // remplacées en bloc à l'enregistrement (même principe que les niveaux d'un formacode).
  const [modeEditionAppellations, setModeEditionAppellations] = useState(false);
  const [valeursAppellations, setValeursAppellations] = useState<string[]>([]);
  const [enregistrementAppellations, setEnregistrementAppellations] = useState(false);
  const [erreurAppellations, setErreurAppellations] = useState<string | null>(null);

  const [modeEditionRome, setModeEditionRome] = useState(false);
  const [valeursRome, setValeursRome] = useState<string[]>([]);
  const [enregistrementRome, setEnregistrementRome] = useState(false);
  const [erreurRome, setErreurRome] = useState<string | null>(null);

  // Édition de la section « Activités et compétences ». Un mode par section, et non un mode
  // global : chaque section recharge ses propres données, qui sont coûteuses à requêter.
  const [rechargerCouples, setRechargerCouples] = useState(0);
  const [modeEditionCouples, setModeEditionCouples] = useState(false);
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [ajoutEnCours, setAjoutEnCours] = useState(false);
  const [suppressionEnCours, setSuppressionEnCours] = useState<number | null>(null);
  const [erreurCouples, setErreurCouples] = useState<string | null>(null);
  const [recalculEnCours, setRecalculEnCours] = useState(false);

  // Édition de la section « Ressources transverses ». `valeursTransv` est indexé par code :
  // '' = ressource absente de la fiche, 'nc' = non concerné, '1'..'4' = niveau retenu.
  const [modeEditionTransv, setModeEditionTransv] = useState(false);
  const [valeursTransv, setValeursTransv] = useState<Record<string, string>>({});
  const [enregistrementTransv, setEnregistrementTransv] = useState(false);
  const [erreurTransv, setErreurTransv] = useState<string | null>(null);

  // Édition de la section « Conditions d'exercice du métier », qui couvre deux collections
  // (les 15 conditions et les 7 questions d'accès) enregistrées ensemble au clic sur
  // Enregistrer, comme les ressources transverses ci-dessus.
  const [modeEditionConditions, setModeEditionConditions] = useState(false);
  const [valeursConditions, setValeursConditions] = useState<
    Record<string, 'significatif' | 'non_significatif'>
  >({});
  const [valeursAcces, setValeursAcces] = useState<Record<string, string>>({});
  const [enregistrementConditions, setEnregistrementConditions] = useState(false);
  const [erreurConditions, setErreurConditions] = useState<string | null>(null);

  const [modeEdition, setModeEdition] = useState(false);
  const [enregistrementEnCours, setEnregistrementEnCours] = useState(false);
  const [erreurEnregistrement, setErreurEnregistrement] = useState<string | null>(null);
  const [edition, setEdition] = useState({
    definition: '',
    remarque: '',
    responsTransverse: '' as '' | 'oui' | 'non',
    interfaceAmontAval: '',
  });

  const metier = useFetch((signal) => obtenirMetier(code, signal), [code, rechargerMetier]);
  // Fournit la liste complète des critères d'accès : les questions sans réponse
  // doivent rester visibles sur la fiche.
  const referentiels = useFetch((signal) => obtenirReferentiels(signal), []);
  // Les deux dépendent de `rechargerCouples` : le tableau des domaines structurants est
  // dérivé des formacodes portés par les couples (GROUP BY côté API), il doit donc être
  // refetché en même temps qu'eux à chaque ajout ou suppression.
  const activites = useFetch(
    (signal) => obtenirActivitesMetier(code, signal),
    [code, rechargerCouples],
  );
  const connaissances = useFetch(
    (signal) => obtenirConnaissancesMetier(code, signal),
    [code, rechargerCouples],
  );
  const etatProximites = useFetch(
    (signal) => obtenirEtatProximites(code, signal),
    [code, rechargerCouples, rechargerMetier],
  );
  const proches = useFetch(
    (signal) => listerMetiersProches(code, { dcMin, heuresMax, degreMin, limite: 15 }, signal),
    [code, dcMin, heuresMax, degreMin],
  );

  if (metier.chargement) return <Loader />;
  if (metier.erreur) return <ErrorMessage message={metier.erreur} />;
  if (!metier.donnees) return null;

  const m = metier.donnees;

  // Le filtre « même famille » n'existe que côté front (comme sur la page Passerelles) :
  // les trois autres paramètres sont déjà appliqués par l'API.
  const resultatsProches =
    memeFamille && m.codeFamille
      ? (proches.donnees?.data ?? []).filter((p) => p.codeFamille === m.codeFamille)
      : (proches.donnees?.data ?? []);

  // Les données annexes ne sont pas encore chargées tant que ces requêtes n'ont pas abouti :
  // exporter avant produirait un .docx incomplet (activités ou connaissances manquantes).
  const donneesPretes =
    !activites.chargement &&
    !connaissances.chargement &&
    !proches.chargement &&
    !referentiels.chargement;

  async function supprimerFiche() {
    const nbCouples = activites.donnees?.data.length ?? 0;
    const detail = nbCouples > 0 ? ` (dont ${nbCouples} couple${nbCouples > 1 ? 's' : ''} activité-compétence)` : '';
    if (!window.confirm(`Supprimer définitivement la fiche ${code}${detail} ?`)) return;

    setSuppressionMetierEnCours(true);
    setErreurSuppression(null);
    try {
      await supprimerMetier(code);
      navigate('/metiers');
    } catch (err) {
      setErreurSuppression(err instanceof ApiError ? err.message : 'Suppression impossible');
    } finally {
      setSuppressionMetierEnCours(false);
    }
  }

  async function exporterWord() {
    if (!metier.donnees) return;
    setExportEnCours(true);
    try {
      // Import dynamique : `docx` (~600 ko) ne doit peser que sur les visiteurs qui exportent.
      // Seule la sélection déjà filtrée (`resultatsProches`) part dans le document : les
      // contrôles de filtre eux-mêmes n'existent que dans la page, jamais dans l'export.
      if (modeleExport === 'ocapiat' || modeleExport === 'ocapiat-client') {
        const { exporterFicheMetierOcapiat, exporterFicheMetierOcapiatClient } = await import('@/utils/exportWord');
        const exporter = modeleExport === 'ocapiat' ? exporterFicheMetierOcapiat : exporterFicheMetierOcapiatClient;
        await exporter({
          metier: metier.donnees,
          couples: activites.donnees?.data ?? [],
          connaissances: connaissances.donnees?.data ?? [],
          proches: resultatsProches,
          referentielRome: referentiels.donnees?.rome ?? [],
        });
      } else {
        const { exporterFicheMetierWord } = await import('@/utils/exportWord');
        await exporterFicheMetierWord({
          metier: metier.donnees,
          couples: activites.donnees?.data ?? [],
          connaissances: connaissances.donnees?.data ?? [],
          proches: resultatsProches,
          criteresAcces: referentiels.donnees?.acces ?? [],
        });
      }
    } finally {
      setExportEnCours(false);
    }
  }

  function commencerEdition() {
    setEdition({
      definition: m.definition ?? '',
      remarque: m.remarque ?? '',
      responsTransverse: m.responsTransverse ?? '',
      interfaceAmontAval: m.interfaceAmontAval ?? '',
    });
    setErreurEnregistrement(null);
    setModeEdition(true);
  }

  async function enregistrerEdition() {
    setEnregistrementEnCours(true);
    setErreurEnregistrement(null);
    try {
      await modifierMetier(code, {
        definition: edition.definition.trim() || null,
        remarque: edition.remarque.trim() || null,
        responsTransverse: edition.responsTransverse || null,
        interfaceAmontAval: edition.interfaceAmontAval || null,
      });
      setModeEdition(false);
      setRechargerMetier((v) => v + 1);
    } catch (err) {
      setErreurEnregistrement(err instanceof ApiError ? err.message : 'Enregistrement impossible');
    } finally {
      setEnregistrementEnCours(false);
    }
  }

  async function ajouterUnCouple(coupleSourceId: number) {
    setAjoutEnCours(true);
    setErreurCouples(null);
    try {
      await ajouterCouple(code, coupleSourceId);
      setAjoutOuvert(false);
      // Recharge couples, domaines structurants et état des passerelles d'un seul coup.
      setRechargerCouples((v) => v + 1);
    } catch (err) {
      setErreurCouples(err instanceof ApiError ? err.message : 'Ajout impossible');
    } finally {
      setAjoutEnCours(false);
    }
  }

  async function retirerUnCouple(coupleId: number, libelle: string) {
    // Le retrait emporte les détails, niveaux de maîtrise, mots-clés et domaines de
    // connaissance du couple (cascade en base) : la confirmation n'est pas superflue.
    if (!window.confirm(`Retirer « ${libelle} » de cette fiche ? Cette action est définitive.`)) {
      return;
    }
    setSuppressionEnCours(coupleId);
    setErreurCouples(null);
    try {
      await supprimerCouple(code, coupleId);
      setRechargerCouples((v) => v + 1);
    } catch (err) {
      setErreurCouples(err instanceof ApiError ? err.message : 'Suppression impossible');
    } finally {
      setSuppressionEnCours(null);
    }
  }

  /**
   * En édition, la section liste les 17 ressources du référentiel et non les seules lignes
   * de la fiche : sans ça, la ressource absente de D309 (16 lignes sur 17) resterait
   * définitivement inéditable. Les ressources absentes s'affichent « Non renseigné ».
   */
  function transversalesEditables(): MetierTransversale[] {
    const portees = new Map((m.transversales ?? []).map((t) => [t.codeTransversale, t]));
    return (referentiels.donnees?.transversales ?? []).map(
      (c) =>
        portees.get(c.codeTransversale) ?? {
          codeTransversale: c.codeTransversale,
          niveau: null,
          nonConcerne: false,
          competence: c,
        },
    );
  }

  function commencerEditionTransv() {
    const depart: Record<string, string> = {};
    for (const t of transversalesEditables()) depart[t.codeTransversale] = valeurInitiale(t);
    setValeursTransv(depart);
    setErreurTransv(null);
    setModeEditionTransv(true);
  }

  async function enregistrerTransversales() {
    setEnregistrementTransv(true);
    setErreurTransv(null);
    try {
      // Les ressources laissées « Non renseigné » ne sont pas envoyées : elles resteraient
      // absentes de la fiche plutôt que d'être créées avec une valeur qu'on n'a pas choisie.
      const lignes = Object.entries(valeursTransv)
        .filter(([, valeur]) => valeur !== VALEUR_ABSENTE)
        .map(([codeTransversale, valeur]) => ({
          codeTransversale,
          niveau: valeur === VALEUR_NON_CONCERNE ? null : Number(valeur),
          nonConcerne: valeur === VALEUR_NON_CONCERNE,
        }));

      await modifierTransversales(code, lignes);
      setModeEditionTransv(false);
      // Les transversales arrivent avec la fiche : c'est elle qu'il faut refetcher. Le
      // rechargement met aussi à jour le bandeau de péremption des passerelles.
      setRechargerMetier((v) => v + 1);
    } catch (err) {
      setErreurTransv(err instanceof ApiError ? err.message : 'Enregistrement impossible');
    } finally {
      setEnregistrementTransv(false);
    }
  }

  /** Les 15 conditions du référentiel, complétées par défaut « non significatif » pour
   *  celles que la fiche ne porte pas encore (même filet que `transversalesEditables`). */
  function conditionsEditables(): MetierCondition[] {
    const portees = new Map((m.conditions ?? []).map((c) => [c.codeCondition, c]));
    return (referentiels.donnees?.conditions ?? []).map(
      (c) =>
        portees.get(c.codeCondition) ?? {
          codeCondition: c.codeCondition,
          valeur: 'non_significatif',
          critere: c,
        },
    );
  }

  function commencerEditionConditions() {
    const departConditions: Record<string, 'significatif' | 'non_significatif'> = {};
    for (const c of conditionsEditables()) departConditions[c.codeCondition] = c.valeur;
    setValeursConditions(departConditions);

    const departAcces: Record<string, string> = {};
    for (const critere of referentiels.donnees?.acces ?? []) {
      const existant = (m.acces ?? []).find((a) => a.codeAcces === critere.codeAcces);
      departAcces[critere.codeAcces] = existant?.valeur ?? '';
    }
    setValeursAcces(departAcces);

    setErreurConditions(null);
    setModeEditionConditions(true);
  }

  async function enregistrerConditions() {
    setEnregistrementConditions(true);
    setErreurConditions(null);
    try {
      const conditions = Object.entries(valeursConditions).map(([codeCondition, valeur]) => ({
        codeCondition,
        valeur,
      }));
      const acces = Object.entries(valeursAcces).map(([codeAcces, valeur]) => ({
        codeAcces,
        valeur: valeur.trim() || null,
      }));
      await Promise.all([modifierConditions(code, conditions), modifierAcces(code, acces)]);
      setModeEditionConditions(false);
      // Les conditions/accès arrivent avec la fiche : même rechargement que definition/transv,
      // il met aussi à jour le bandeau de péremption si ACCES_3/ACCES_4 ont changé.
      setRechargerMetier((v) => v + 1);
    } catch (err) {
      setErreurConditions(err instanceof ApiError ? err.message : 'Enregistrement impossible');
    } finally {
      setEnregistrementConditions(false);
    }
  }

  async function lancerRecalcul() {
    setRecalculEnCours(true);
    setErreurCouples(null);
    try {
      await recalculerProximites();
      setRechargerCouples((v) => v + 1);
    } catch (err) {
      setErreurCouples(err instanceof ApiError ? err.message : 'Recalcul impossible');
    } finally {
      setRecalculEnCours(false);
    }
  }

  function commencerEditionAppellations() {
    setValeursAppellations((m.appellations ?? []).map((a) => a.appellation));
    setErreurAppellations(null);
    setModeEditionAppellations(true);
  }

  async function enregistrerAppellations() {
    const valeurs = valeursAppellations.map((v) => v.trim()).filter((v) => v.length > 0);
    setEnregistrementAppellations(true);
    setErreurAppellations(null);
    try {
      await modifierAppellations(code, valeurs);
      setModeEditionAppellations(false);
      setRechargerMetier((v) => v + 1);
    } catch (err) {
      setErreurAppellations(err instanceof ApiError ? err.message : 'Enregistrement impossible');
    } finally {
      setEnregistrementAppellations(false);
    }
  }

  function commencerEditionRome() {
    setValeursRome((m.codesRome ?? []).map((r) => r.codeRome));
    setErreurRome(null);
    setModeEditionRome(true);
  }

  async function enregistrerRome() {
    const valeurs = valeursRome.map((v) => v.trim()).filter((v) => v.length > 0);
    setEnregistrementRome(true);
    setErreurRome(null);
    try {
      await modifierCodesRome(code, valeurs);
      setModeEditionRome(false);
      setRechargerMetier((v) => v + 1);
    } catch (err) {
      setErreurRome(err instanceof ApiError ? err.message : 'Enregistrement impossible');
    } finally {
      setEnregistrementRome(false);
    }
  }

  return (
    <article className="page fiche">
      <header className="fiche__entete">
        <div className="fiche__entete-ligne">
          <div>
            <span className="carte__code">{m.codeMetier}</span>
            <h1>{m.intitule}</h1>
          </div>
          <div className="fiche__entete-boutons">
            {modeEdition ? (
              <>
                <button
                  type="button"
                  className="bouton--secondaire"
                  onClick={() => setModeEdition(false)}
                  disabled={enregistrementEnCours}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="bouton--export"
                  onClick={enregistrerEdition}
                  disabled={enregistrementEnCours}
                >
                  {enregistrementEnCours ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="bouton--retirer-ligne"
                  onClick={supprimerFiche}
                  disabled={suppressionMetierEnCours}
                >
                  {suppressionMetierEnCours ? 'Suppression…' : 'Supprimer'}
                </button>
                <button type="button" className="bouton--secondaire" onClick={commencerEdition}>
                  Modifier
                </button>
                <select
                  className="select-modele-export"
                  value={modeleExport}
                  onChange={(e) => setModeleExport(e.target.value as 'standard' | 'ocapiat' | 'ocapiat-client')}
                  disabled={exportEnCours}
                  aria-label="Modèle d’export Word"
                  title="Modèle OCAPIAT — voir docs/EXEMPLE FICHE METIER.docx"
                >
                  <option value="standard">Modèle standard</option>
                  <option value="ocapiat">Modèle OCAPIAT</option>
                  <option value="ocapiat-client">Modèle OCAPIAT Client</option>
                </select>
                <button
                  type="button"
                  className="bouton--export"
                  onClick={exporterWord}
                  disabled={!donneesPretes || exportEnCours}
                >
                  {exportEnCours ? 'Export en cours…' : 'Exporter en Word'}
                </button>
              </>
            )}
          </div>
        </div>
        {m.famille && <p className="fiche__famille">{libelleFamille(m.famille)}</p>}
        {((m.dossierSource?.libelle ?? m.dossierAutre) || m.interfaceAmontAval || m.redacteur) && (
          <ul className="badges">
            {(m.dossierSource?.libelle ?? m.dossierAutre) && (
              <li className="badge badge--dossier">{m.dossierSource?.libelle ?? m.dossierAutre}</li>
            )}
            {m.interfaceAmontAval && (
              <li className="badge badge--dossier">Interface amont/aval : {m.interfaceAmontAval}</li>
            )}
            {m.redacteur && <li className="badge badge--dossier">Rédacteur : {m.redacteur}</li>}
          </ul>
        )}
        <p className="detail">
          Fiche créée le {dateModification(m.createdAt)} · modifiée le{' '}
          {dateModification(m.updatedAt)}
        </p>
        {erreurEnregistrement && <ErrorMessage message={erreurEnregistrement} />}
        {erreurSuppression && <ErrorMessage message={erreurSuppression} />}

        {/* `metier_proximite` est matérialisée : elle reste sur les anciennes valeurs tant
            qu'elle n'est pas rejouée. Le bandeau est en tête de fiche parce que plusieurs
            sections la périment — les couples, les ressources transverses TRANSV_2/8/10 et
            les deux paramètres de calcul. Le recalcul reste manuel : il réécrit ~110 000
            lignes, trop pour être joué à chaque modification. */}
        {etatProximites.donnees?.perimee && (
          <div className="bandeau-alerte">
            <span>
              Les passerelles de cette fiche ont été calculées avant vos dernières
              modifications : elles ne les prennent pas encore en compte.
            </span>
            <button
              type="button"
              className="bouton--secondaire"
              onClick={lancerRecalcul}
              disabled={recalculEnCours}
            >
              {recalculEnCours ? 'Recalcul en cours…' : 'Recalculer les passerelles'}
            </button>
          </div>
        )}
      </header>

      {(modeEdition || m.definition) && (
        <section className="fiche__section">
          <h2>Définition</h2>
          {modeEdition ? (
            <textarea
              className="edition__texte"
              rows={4}
              value={edition.definition}
              onChange={(e) => setEdition((s) => ({ ...s, definition: e.target.value }))}
            />
          ) : (
            <p>{m.definition}</p>
          )}
        </section>
      )}

      {(modeEdition || m.remarque) && (
        <section className="fiche__section">
          <h2>Remarque</h2>
          {modeEdition ? (
            <textarea
              className="edition__texte"
              rows={3}
              value={edition.remarque}
              onChange={(e) => setEdition((s) => ({ ...s, remarque: e.target.value }))}
            />
          ) : (
            <p>{m.remarque}</p>
          )}
        </section>
      )}

      {modeEdition && (
        <section className="fiche__section">
          <h2>Paramètres de calcul des passerelles</h2>
          <p className="detail">
            Non affichés sur la fiche, utilisés uniquement par le calcul du degré
            d’élargissement. Un changement ne met pas à jour les passerelles déjà calculées —
            il faut relancer le recalcul côté serveur.
          </p>
          <div className="passerelles-parametres">
            <div className="passerelles-champ">
              <label htmlFor="edition-respons">Responsabilité transverse</label>
              <select
                id="edition-respons"
                value={edition.responsTransverse}
                onChange={(e) =>
                  setEdition((s) => ({ ...s, responsTransverse: e.target.value as '' | 'oui' | 'non' }))
                }
              >
                <option value="">Non renseigné</option>
                <option value="oui">Oui (significatif)</option>
                <option value="non">Non (non significatif)</option>
              </select>
            </div>
            <div className="passerelles-champ">
              <label htmlFor="edition-interface">Interface amont/aval</label>
              <select
                id="edition-interface"
                value={edition.interfaceAmontAval}
                onChange={(e) => setEdition((s) => ({ ...s, interfaceAmontAval: e.target.value }))}
              >
                <option value="">Non renseigné</option>
                <option value="Non">Non</option>
                <option value="Oui, en amont OU aval">Oui, en amont OU aval</option>
                <option value="Oui, en amont ET aval">Oui, en amont ET aval</option>
              </select>
            </div>
          </div>
        </section>
      )}

      <section className="fiche__section">
        <div className="fiche__entete-ligne">
          <h2>Autres appellations</h2>
          <div className="fiche__entete-boutons">
            {modeEditionAppellations ? (
              <>
                <button
                  type="button"
                  className="bouton--secondaire"
                  onClick={() => setModeEditionAppellations(false)}
                  disabled={enregistrementAppellations}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="bouton--export"
                  onClick={enregistrerAppellations}
                  disabled={enregistrementAppellations}
                >
                  {enregistrementAppellations ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </>
            ) : (
              <button type="button" className="bouton--secondaire" onClick={commencerEditionAppellations}>
                Modifier
              </button>
            )}
          </div>
        </div>

        {erreurAppellations && <ErrorMessage message={erreurAppellations} />}

        {modeEditionAppellations ? (
          <div className="liste-edition">
            {valeursAppellations.map((valeur, i) => (
              <div key={i} className="liste-edition__ligne">
                <input
                  type="text"
                  maxLength={255}
                  value={valeur}
                  disabled={enregistrementAppellations}
                  onChange={(e) =>
                    setValeursAppellations((prec) => prec.map((v, j) => (j === i ? e.target.value : v)))
                  }
                />
                <button
                  type="button"
                  className="bouton--retirer-ligne"
                  onClick={() => setValeursAppellations((prec) => prec.filter((_, j) => j !== i))}
                  disabled={enregistrementAppellations}
                >
                  Retirer
                </button>
              </div>
            ))}
            <button
              type="button"
              className="bouton--secondaire bouton--ajouter"
              onClick={() => setValeursAppellations((prec) => [...prec, ''])}
              disabled={enregistrementAppellations || valeursAppellations.length >= 10}
            >
              + Ajouter une appellation
            </button>
          </div>
        ) : (m.appellations ?? []).length === 0 ? (
          <p className="vide">Aucune appellation renseignée.</p>
        ) : (
          <ul className="badges">
            {m.appellations!.map((a) => (
              <li key={a.id} className="badge">
                {a.appellation}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="fiche__section">
        <div className="fiche__entete-ligne">
          <h2>Codes ROME</h2>
          <div className="fiche__entete-boutons">
            {modeEditionRome ? (
              <>
                <button
                  type="button"
                  className="bouton--secondaire"
                  onClick={() => setModeEditionRome(false)}
                  disabled={enregistrementRome}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="bouton--export"
                  onClick={enregistrerRome}
                  disabled={enregistrementRome}
                >
                  {enregistrementRome ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="bouton--secondaire"
                onClick={commencerEditionRome}
                disabled={!referentiels.donnees}
              >
                Modifier
              </button>
            )}
          </div>
        </div>

        {erreurRome && <ErrorMessage message={erreurRome} />}

        {modeEditionRome ? (
          <div className="liste-edition">
            {valeursRome.map((valeur, i) => (
              <div key={i} className="liste-edition__ligne">
                <select
                  value={valeur}
                  disabled={enregistrementRome}
                  onChange={(e) =>
                    setValeursRome((prec) => prec.map((v, j) => (j === i ? e.target.value : v)))
                  }
                >
                  <option value="">— Choisir —</option>
                  {(referentiels.donnees?.rome ?? []).map((r) => (
                    <option key={r.codeRome} value={r.codeRome}>
                      {r.libelle ? `${r.codeRome} — ${r.libelle}` : r.codeRome}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="bouton--retirer-ligne"
                  onClick={() => setValeursRome((prec) => prec.filter((_, j) => j !== i))}
                  disabled={enregistrementRome}
                >
                  Retirer
                </button>
              </div>
            ))}
            <button
              type="button"
              className="bouton--secondaire bouton--ajouter"
              onClick={() => setValeursRome((prec) => [...prec, ''])}
              disabled={enregistrementRome || valeursRome.length >= 5}
            >
              + Ajouter un code ROME
            </button>
          </div>
        ) : (m.codesRome ?? []).length === 0 ? (
          <p className="vide">Aucun code ROME renseigné.</p>
        ) : (
          <ul className="badges">
            {m.codesRome!.map((r) => (
              <li key={r.id} className="badge">
                {r.codeRome}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="fiche__section">
        <div className="fiche__entete-ligne">
          <h2>Conditions d’exercice du métier</h2>
          <div className="fiche__entete-boutons">
            {modeEditionConditions ? (
              <>
                <button
                  type="button"
                  className="bouton--secondaire"
                  onClick={() => setModeEditionConditions(false)}
                  disabled={enregistrementConditions}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="bouton--export"
                  onClick={enregistrerConditions}
                  disabled={enregistrementConditions}
                >
                  {enregistrementConditions ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="bouton--secondaire"
                onClick={commencerEditionConditions}
                disabled={!referentiels.donnees}
              >
                Modifier
              </button>
            )}
          </div>
        </div>

        {erreurConditions && <ErrorMessage message={erreurConditions} />}
        {modeEditionConditions && (
          <p className="detail">
            Le niveau ou l’intervalle de niveaux RNCP attendu (première question des
            conditions d’accès) entre dans le calcul des passerelles ; le reste de la
            section n’a aucun effet dessus.
          </p>
        )}

        <ConditionsFiche
          conditions={modeEditionConditions ? conditionsEditables() : (m.conditions ?? [])}
          edition={
            modeEditionConditions
              ? {
                  valeurs: valeursConditions,
                  onChange: (codeCondition, valeur) =>
                    setValeursConditions((precedent) => ({ ...precedent, [codeCondition]: valeur })),
                  desactive: enregistrementConditions,
                }
              : undefined
          }
        />

        {(modeEditionConditions || (m.acces ?? []).length > 0) && (
          <div className="acces">
            <h3 className="transversales__titre">Conditions d’accès au métier</h3>
            <AccesFiche
              acces={m.acces ?? []}
              criteres={referentiels.donnees?.acces ?? []}
              edition={
                modeEditionConditions
                  ? {
                      valeurs: valeursAcces,
                      onChange: (codeAcces, valeur) =>
                        setValeursAcces((precedent) => ({ ...precedent, [codeAcces]: valeur })),
                      desactive: enregistrementConditions,
                    }
                  : undefined
              }
            />
          </div>
        )}
      </section>

      <section className="fiche__section">
        <div className="fiche__entete-ligne">
          <h2>Activités et compétences du métier</h2>
          <div className="fiche__entete-boutons">
            {modeEditionCouples && (
              <>
                <button
                  type="button"
                  className="bouton--secondaire"
                  onClick={() => setAjoutOuvert((ouvert) => !ouvert)}
                  disabled={ajoutEnCours}
                >
                  {ajoutOuvert ? 'Masquer l’ajout' : 'Ajouter un couple'}
                </button>
                {/* « Ajouter » ne propose que des codes déjà rédigés ailleurs : créer part
                    d'un code neuf, attribué dans la nomenclature. */}
                <Link
                  to={`/activites/nouveau?metier=${encodeURIComponent(m.codeMetier)}`}
                  className="bouton--secondaire"
                >
                  Créer un couple
                </Link>
              </>
            )}
            <button
              type="button"
              className={modeEditionCouples ? 'bouton--export' : 'bouton--secondaire'}
              onClick={() => {
                setModeEditionCouples((actif) => !actif);
                setAjoutOuvert(false);
                setErreurCouples(null);
              }}
            >
              {modeEditionCouples ? 'Terminer' : 'Modifier'}
            </button>
          </div>
        </div>

        {erreurCouples && <ErrorMessage message={erreurCouples} />}

        {modeEditionCouples && ajoutOuvert && (
          <AjoutCouple
            codeMetier={code}
            onAjouter={(variante) => ajouterUnCouple(variante.coupleId)}
            onAnnuler={() => setAjoutOuvert(false)}
            ajoutEnCours={ajoutEnCours}
          />
        )}

        {activites.chargement && <Loader />}
        {activites.erreur && <ErrorMessage message={activites.erreur} />}
        {activites.donnees && activites.donnees.data.length === 0 && (
          <p className="vide">Aucun couple activité-compétence renseigné.</p>
        )}
        <CouplesFiche
          couples={activites.donnees?.data ?? []}
          onSupprimer={
            modeEditionCouples
              ? (c) => retirerUnCouple(c.id, c.intituleActivite ?? c.codeActivite)
              : undefined
          }
          suppressionEnCours={suppressionEnCours}
        />
      </section>

      <section className="fiche__section">
        <div className="fiche__entete-ligne">
          <h2>Ressources transverses mobilisées dans le travail</h2>
          <div className="fiche__entete-boutons">
            {modeEditionTransv ? (
              <>
                <button
                  type="button"
                  className="bouton--secondaire"
                  onClick={() => setModeEditionTransv(false)}
                  disabled={enregistrementTransv}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="bouton--export"
                  onClick={enregistrerTransversales}
                  disabled={enregistrementTransv}
                >
                  {enregistrementTransv ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="bouton--secondaire"
                onClick={commencerEditionTransv}
                disabled={!referentiels.donnees}
              >
                Modifier
              </button>
            )}
          </div>
        </div>

        {erreurTransv && <ErrorMessage message={erreurTransv} />}
        {modeEditionTransv && (
          <p className="detail">
            Trois ressources entrent dans le calcul des passerelles — « Résolution de
            problèmes », « Adaptabilité / réactivité / proactivité » et « Prise d’initiative
            et gestion des aléas ». Changer leur niveau demandera un recalcul ; les quatorze
            autres n’ont aucun effet sur les passerelles.
          </p>
        )}

        <TransversalesFiche
          transversales={modeEditionTransv ? transversalesEditables() : (m.transversales ?? [])}
          edition={
            modeEditionTransv
              ? {
                  valeurs: valeursTransv,
                  onChange: (codeTransversale, valeur) =>
                    setValeursTransv((precedent) => ({
                      ...precedent,
                      [codeTransversale]: valeur,
                    })),
                  desactive: enregistrementTransv,
                }
              : undefined
          }
        />
      </section>

      <section className="fiche__section">
        <h2>Domaines de connaissances structurant pour l’exercice du métier</h2>
        {connaissances.chargement && <Loader />}
        {connaissances.erreur && <ErrorMessage message={connaissances.erreur} />}
        {connaissances.donnees && (
          <ConnaissancesFiche domaines={connaissances.donnees.data} />
        )}
      </section>

      <section className="fiche__section">
        <div className="fiche__entete-ligne">
          <h2>Métiers proches</h2>
          {/* Reprend ce métier comme point de départ sur l'écran passerelles complet
              (nuage de points, tableau détaillé, export Word). */}
          <Link
            to={`/passerelles?metier=${encodeURIComponent(code)}`}
            className="bouton--detail"
          >
            Détail
          </Link>
        </div>

        <div className="passerelles-parametres passerelles-parametres--compact">
          <FiltresPasserelles
            idPrefix="fiche-proches"
            dcMin={dcMin}
            onDcMinChange={setDcMin}
            heuresMax={heuresMax}
            onHeuresMaxChange={setHeuresMax}
            degreMin={degreMin}
            onDegreMinChange={setDegreMin}
            memeFamille={memeFamille}
            onMemeFamilleChange={setMemeFamille}
            labelFamille="Même famille que ce métier"
          />
        </div>

        {proches.chargement && <Loader />}
        {proches.erreur && <ErrorMessage message={proches.erreur} />}
        {proches.donnees && resultatsProches.length === 0 && (
          <p className="vide">Aucun métier ne correspond à ces paramètres.</p>
        )}
        <ul className="liste">
          {resultatsProches.map((p) => (
            <li key={p.codeMetier}>
              <Link to={`/metiers/${encodeURIComponent(p.codeMetier)}`}>{p.intitule}</Link>
              {p.dureeAcquisitionHeures !== null && (
                <span className="detail"> — {Math.round(Number(p.dureeAcquisitionHeures))} h d’acquisition</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Link to="/metiers" className="lien-retour">
        ← Retour aux métiers
      </Link>
    </article>
  );
}
