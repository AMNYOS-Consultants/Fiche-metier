import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  creerCouple,
  listerActivites,
  obtenirReferentiels,
  obtenirVariantes,
  type EmplacementCouple,
} from '@/api/activites';
import { listerMetiersOptions } from '@/api/metiers';
import { ApiError } from '@/api/client';
import { useFetch } from '@/hooks/useFetch';
import { Loader } from '@/components/Loader';
import { ErrorMessage } from '@/components/ErrorMessage';
import {
  ChampsConnaissances,
  aDesDoublons,
  versConnaissancesApi,
  type LigneConnaissance,
} from '@/components/ChampsConnaissances';
import {
  FormulaireRedaction,
  redactionDepuis,
  versEditionModele,
  type Redaction,
} from '@/components/FormulaireRedaction';
import type { VarianteDetaillee } from '@/types/api';

const REDACTION_VIDE: Redaction = {
  intituleActivite: '',
  intituleCompetence: '',
  detailsActivite: '',
  detailsCompetence: '',
  niveaux: ['', '', '', ''],
};

/** Chaque segment se choisit parmi l'existant, ou se crée. */
type Choix = 'existant' | 'nouveau';

/** Le halo (3 segments) d'un code activité, avec l'intitulé de sa première déclinaison. */
interface Halo {
  code: string;
  intitule: string;
}

export function NouveauCouplePage() {
  const navigate = useNavigate();
  const [parametres] = useSearchParams();
  // Depuis une fiche métier, le métier est déjà connu : `?metier=D21`.
  const metierImpose = parametres.get('metier');

  const [codeMetier, setCodeMetier] = useState(metierImpose ?? '');
  // Trois segments, chacun « existant » ou « nouveau ». Créer un segment force les
  // suivants à être neufs : sous une lettre neuve il n'existe aucune famille, etc.
  const [choixLettre, setChoixLettre] = useState<Choix>('existant');
  const [lettre, setLettre] = useState('');
  const [domaine1, setDomaine1] = useState('');
  const [choixFamille, setChoixFamille] = useState<Choix>('existant');
  const [famille, setFamille] = useState('');
  const [domaine2, setDomaine2] = useState('');
  const [domaine3, setDomaine3] = useState('');
  const [choixActivite, setChoixActivite] = useState<Choix>('nouveau');
  const [halo, setHalo] = useState('');
  const [redaction, setRedaction] = useState<Redaction>(REDACTION_VIDE);
  const [connaissances, setConnaissances] = useState<LigneConnaissance[]>([]);
  const [recherche, setRecherche] = useState('');
  const [sourceChoisie, setSourceChoisie] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const metiers = useFetch((signal) => listerMetiersOptions(signal), []);
  // Le référentiel et non `/activites/familles` : ce dernier masque les familles sans
  // activité (jointure interne), or créer la première activité d'une famille vide
  // (A.02, B.03, D.06, D.07, F.03) est un cas légitime.
  const referentiels = useFetch((signal) => obtenirReferentiels(signal), []);
  // Les activités de la famille choisie : elles donnent les halos existants et le prochain
  // numéro libre, affiché à titre indicatif (le serveur l'attribue pour de vrai).
  const activitesFamille = useFetch(
    (signal) =>
      famille ? listerActivites({ famille, limit: 200 }, signal) : Promise.resolve(null),
    [famille],
  );
  // Recherche d'un couple existant dont recopier la rédaction.
  const candidats = useFetch(
    (signal) =>
      recherche.trim().length >= 3
        ? listerActivites({ search: recherche.trim(), limit: 15 }, signal)
        : Promise.resolve(null),
    [recherche],
  );
  const variantesSource = useFetch(
    (signal) => (sourceChoisie ? obtenirVariantes(sourceChoisie, signal) : Promise.resolve(null)),
    [sourceChoisie],
  );

  const codesFamille = activitesFamille.donnees?.data ?? [];
  const toutesFamilles = referentiels.donnees?.famillesActivite ?? [];

  /** Une entrée par lettre, avec son domaine 1 — constant sur toutes ses familles. */
  const lettres = useMemo(() => {
    const parLettre = new Map<string, string>();
    for (const f of toutesFamilles) {
      const l = f.codeFamilleActivite.split('.')[0];
      if (!parLettre.has(l)) parLettre.set(l, f.domaine1 ?? '—');
    }
    return [...parLettre.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [toutesFamilles]);

  const famillesDeLaLettre = useMemo(
    () => toutesFamilles.filter((f) => f.codeFamilleActivite.startsWith(`${lettre}.`)),
    [toutesFamilles, lettre],
  );

  const halos = useMemo<Halo[]>(() => {
    const parHalo = new Map<string, Halo>();
    for (const a of codesFamille) {
      const code = a.codeActivite.split('.').slice(0, 3).join('.');
      if (!parHalo.has(code)) {
        parHalo.set(code, { code, intitule: a.intituleActivite ?? code });
      }
    }
    return [...parHalo.values()].sort((x, y) => x.code.localeCompare(y.code));
  }, [codesFamille]);

  const segmentSuivant = (valeurs: number[]) =>
    String(Math.max(0, ...valeurs) + 1).padStart(2, '0');

  /** L'emplacement tel qu'il sera envoyé, ou `null` si la saisie est incomplète. */
  const emplacement = useMemo<EmplacementCouple | null>(() => {
    if (choixLettre === 'nouveau') {
      if (!/^[A-Za-z]$/.test(lettre) || !domaine1.trim() || !domaine2.trim()) return null;
      return {
        nouvelleFamille: {
          lettre: lettre.toUpperCase(),
          domaine1: domaine1.trim(),
          domaine2: domaine2.trim(),
          domaine3: domaine3.trim() || undefined,
        },
      };
    }
    if (!lettre) return null;

    if (choixFamille === 'nouveau') {
      if (!domaine2.trim()) return null;
      return { nouvelleFamille: { lettre, domaine2: domaine2.trim(), domaine3: domaine3.trim() || undefined } };
    }
    if (!famille) return null;

    if (choixActivite === 'existant') return halo ? { halo } : null;
    return { famille };
  }, [choixLettre, lettre, domaine1, choixFamille, domaine2, domaine3, famille, choixActivite, halo]);

  /**
   * Estimation du code attribué. Le serveur recalcule MAX + 1 à l'insertion : c'est lui qui
   * tranche, l'affichage n'est là que pour montrer où l'on atterrit.
   */
  const codePrevu = useMemo(() => {
    if (!emplacement) return null;

    if (emplacement.halo) {
      const duHalo = codesFamille.filter((a) => a.codeActivite.startsWith(`${emplacement.halo}.`));
      if (duHalo.length === 0) return null;
      return `${emplacement.halo}.${segmentSuivant(duHalo.map((a) => Number(a.codeActivite.split('.')[3])))}`;
    }

    if (emplacement.famille) {
      // Une famille sans activité démarre à 01.
      return `${emplacement.famille}.${segmentSuivant(
        codesFamille.map((a) => Number(a.codeActivite.split('.')[2])),
      )}.01`;
    }

    const nouvelle = emplacement.nouvelleFamille!;
    const codeFamille =
      choixLettre === 'nouveau' && lettres.every(([l]) => l !== nouvelle.lettre)
        ? `${nouvelle.lettre}.01`
        : `${nouvelle.lettre}.${segmentSuivant(
            toutesFamilles
              .filter((f) => f.codeFamilleActivite.startsWith(`${nouvelle.lettre}.`))
              .map((f) => Number(f.codeFamilleActivite.split('.')[1])),
          )}`;
    return `${codeFamille}.01.01`;
  }, [emplacement, codesFamille, choixLettre, lettres, toutesFamilles]);

  function reprendre(v: VarianteDetaillee) {
    setRedaction(redactionDepuis(v));
    setConnaissances(
      v.connaissances.map((c) => ({
        codeFormacode: c.codeFormacode,
        niveau: c.niveau !== null ? String(c.niveau) : '',
      })),
    );
    setSourceChoisie(null);
    setRecherche('');
    setErreur(null);
  }

  const pret = codeMetier !== '' && redaction.intituleActivite.trim() !== '' && emplacement !== null;

  async function soumettre() {
    if (!emplacement) return;
    if (aDesDoublons(connaissances)) {
      setErreur('Un même domaine de connaissance est saisi deux fois.');
      return;
    }

    setCreation(true);
    setErreur(null);
    try {
      const edition = versEditionModele(redaction);
      const resultat = await creerCouple({
        codeMetier,
        ...emplacement,
        intituleActivite: edition.intituleActivite ?? '',
        intituleCompetence: edition.intituleCompetence,
        detailsActivite: edition.detailsActivite,
        detailsCompetence: edition.detailsCompetence,
        niveauxMaitrise: edition.niveauxMaitrise,
        connaissances: versConnaissancesApi(connaissances),
      });
      // Retour d'où l'on vient : depuis une fiche métier, on y remonte (le couple créé y
      // figure désormais) ; depuis le catalogue, on ouvre la fiche de l'activité créée.
      navigate(
        metierImpose
          ? `/metiers/${encodeURIComponent(metierImpose)}`
          : `/activites/${encodeURIComponent(resultat.codeActivite)}`,
      );
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Création impossible');
    } finally {
      setCreation(false);
    }
  }

  return (
    <div className="page nouveau-metier">
      <Link to={metierImpose ? `/metiers/${encodeURIComponent(metierImpose)}` : '/activites'} className="lien-retour">
        ← Retour
      </Link>
      <h1>Créer un couple activité-compétence</h1>
      <p className="fiche__famille">
        Le code n’est pas saisi : il est attribué dans l’emplacement choisi, au numéro suivant
        le plus élevé déjà utilisé. Le couple est rattaché à la fiche métier sélectionnée — une
        entrée de catalogue sans métier ne pourrait pas être rattachée ensuite.
      </p>

      {erreur && <ErrorMessage message={erreur} />}
      {metiers.erreur && <ErrorMessage message={metiers.erreur} />}
      {referentiels.erreur && <ErrorMessage message={referentiels.erreur} />}

      <section className="fiche__section">
        <h2>Fiche métier</h2>
        {metierImpose ? (
          <p>
            <strong>{metierImpose}</strong>{' '}
            <span className="detail">
              (
              {metiers.donnees?.data.find((m) => m.codeMetier === metierImpose)?.intitule ??
                'métier'}
              )
            </span>
          </p>
        ) : (
          <div className="passerelles-champ">
            <label htmlFor="metier">Métier auquel rattacher le couple</label>
            <select
              id="metier"
              className="filtre__select"
              value={codeMetier}
              disabled={creation}
              onChange={(e) => setCodeMetier(e.target.value)}
            >
              <option value="">— choisir un métier —</option>
              {(metiers.donnees?.data ?? []).map((m) => (
                <option key={m.codeMetier} value={m.codeMetier}>
                  {m.codeMetier} — {m.intitule}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="fiche__section">
        <h2>Emplacement dans la nomenclature</h2>
        <p className="detail">
          Chaque segment se choisit parmi l’existant ou se crée. Créer un segment impose de
          créer les suivants : sous une lettre nouvelle il n’existe encore aucune famille.
        </p>

        {/* --- 1er segment : la lettre, qui porte le domaine d'activité 1 --- */}
        <div className="segment-nomenclature">
          <p className="encart-metiers__titre">1. Domaine d’activité (lettre)</p>
          <div className="liste-edition">
            <label className="liste-edition__ligne">
              <input
                type="radio"
                name="choix-lettre"
                checked={choixLettre === 'existant'}
                disabled={creation}
                onChange={() => {
                  setChoixLettre('existant');
                  setDomaine1('');
                }}
              />
              <select
                className="filtre__select"
                value={choixLettre === 'existant' ? lettre : ''}
                disabled={creation || choixLettre === 'nouveau'}
                onChange={(e) => {
                  setLettre(e.target.value);
                  setFamille('');
                  setHalo('');
                }}
              >
                <option value="">— choisir un domaine existant —</option>
                {lettres.map(([l, d1]) => (
                  <option key={l} value={l}>
                    {l} — {d1}
                  </option>
                ))}
              </select>
            </label>

            <label className="liste-edition__ligne">
              <input
                type="radio"
                name="choix-lettre"
                checked={choixLettre === 'nouveau'}
                disabled={creation}
                onChange={() => {
                  setChoixLettre('nouveau');
                  setChoixFamille('nouveau');
                  setChoixActivite('nouveau');
                  setLettre('');
                  setFamille('');
                  setHalo('');
                }}
              />
              <span>Nouveau domaine :</span>
              <input
                type="text"
                className="edition__texte segment-nomenclature__lettre"
                maxLength={1}
                placeholder="M"
                value={choixLettre === 'nouveau' ? lettre : ''}
                disabled={creation || choixLettre === 'existant'}
                onChange={(e) => setLettre(e.target.value.toUpperCase())}
              />
              <input
                type="text"
                className="edition__texte"
                placeholder="Libellé du domaine d’activité 1"
                value={domaine1}
                disabled={creation || choixLettre === 'existant'}
                onChange={(e) => setDomaine1(e.target.value)}
              />
            </label>
          </div>
        </div>

        {/* --- 2e segment : la famille, qui porte le domaine d'activité 2 --- */}
        {(lettre !== '' || choixLettre === 'nouveau') && (
          <div className="segment-nomenclature">
            <p className="encart-metiers__titre">2. Famille (sous-code)</p>
            <div className="liste-edition">
              {choixLettre === 'existant' && (
                <label className="liste-edition__ligne">
                  <input
                    type="radio"
                    name="choix-famille"
                    checked={choixFamille === 'existant'}
                    disabled={creation}
                    onChange={() => {
                      setChoixFamille('existant');
                      setDomaine2('');
                      setDomaine3('');
                    }}
                  />
                  <select
                    className="filtre__select"
                    value={choixFamille === 'existant' ? famille : ''}
                    disabled={creation || choixFamille === 'nouveau'}
                    onChange={(e) => {
                      setFamille(e.target.value);
                      setHalo('');
                    }}
                  >
                    <option value="">— choisir une famille existante —</option>
                    {famillesDeLaLettre.map((f) => (
                      <option key={f.codeFamilleActivite} value={f.codeFamilleActivite}>
                        {f.codeFamilleActivite} — {f.domaine2}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="liste-edition__ligne">
                <input
                  type="radio"
                  name="choix-famille"
                  checked={choixFamille === 'nouveau'}
                  disabled={creation || choixLettre === 'nouveau'}
                  onChange={() => {
                    setChoixFamille('nouveau');
                    setChoixActivite('nouveau');
                    setFamille('');
                    setHalo('');
                  }}
                />
                <span>Nouvelle famille :</span>
                <input
                  type="text"
                  className="edition__texte"
                  placeholder="Libellé du domaine d’activité 2"
                  value={domaine2}
                  disabled={creation || choixFamille === 'existant'}
                  onChange={(e) => setDomaine2(e.target.value)}
                />
              </label>
            </div>

            {choixFamille === 'nouveau' && (
              <div className="passerelles-champ">
                <label htmlFor="domaine3">
                  Description de la famille (facultatif — le domaine 3, affiché sur la fiche de
                  l’activité)
                </label>
                <textarea
                  id="domaine3"
                  className="edition__texte"
                  rows={2}
                  value={domaine3}
                  disabled={creation}
                  onChange={(e) => setDomaine3(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {/* --- 3e segment : l'activité elle-même --- */}
        {choixFamille === 'existant' && famille !== '' && (
          <div className="segment-nomenclature">
            <p className="encart-metiers__titre">3. Activité</p>
            {activitesFamille.chargement ? (
              <Loader />
            ) : (
              <div className="liste-edition">
                <label className="liste-edition__ligne">
                  <input
                    type="radio"
                    name="choix-activite"
                    checked={choixActivite === 'nouveau'}
                    disabled={creation}
                    onChange={() => {
                      setChoixActivite('nouveau');
                      setHalo('');
                    }}
                  />
                  <span>Nouvelle activité dans {famille}</span>
                </label>
                <label className="liste-edition__ligne">
                  <input
                    type="radio"
                    name="choix-activite"
                    checked={choixActivite === 'existant'}
                    disabled={creation || halos.length === 0}
                    onChange={() => setChoixActivite('existant')}
                  />
                  <select
                    className="filtre__select"
                    value={halo}
                    disabled={creation || choixActivite === 'nouveau' || halos.length === 0}
                    onChange={(e) => setHalo(e.target.value)}
                  >
                    <option value="">
                      {halos.length === 0
                        ? '— aucune activité dans cette famille —'
                        : '— décliner une activité existante —'}
                    </option>
                    {halos.map((h) => (
                      <option key={h.code} value={h.code}>
                        {h.code} — {h.intitule}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        )}

        {codePrevu && (
          <p className="detail">
            Code attribué : <strong>{codePrevu}</strong> — sauf si un autre couple est créé au
            même emplacement entre-temps, le serveur tranche à l’enregistrement.
          </p>
        )}
      </section>

      <section className="fiche__section">
        <div className="fiche__entete-ligne">
          <h2>Rédaction</h2>
          {(redaction.intituleActivite || connaissances.length > 0) && (
            <button
              type="button"
              className="lien-discret"
              onClick={() => {
                setRedaction(REDACTION_VIDE);
                setConnaissances([]);
              }}
              disabled={creation}
            >
              Repartir d’une page blanche
            </button>
          )}
        </div>

        <div className="passerelles-champ">
          <label htmlFor="source">
            Partir d’un couple existant (facultatif) — recherche par intitulé, 3 caractères
            minimum
          </label>
          <input
            id="source"
            type="search"
            className="recherche__champ"
            value={recherche}
            disabled={creation}
            placeholder="Rechercher une activité à recopier…"
            onChange={(e) => {
              setRecherche(e.target.value);
              setSourceChoisie(null);
            }}
          />
        </div>

        {candidats.donnees && !sourceChoisie && (
          <ul className="encart-metiers__liste">
            {candidats.donnees.data.map((a) => (
              <li key={a.codeActivite}>
                <span>
                  <strong>{a.codeActivite}</strong> — {a.intituleActivite}
                </span>
                <button
                  type="button"
                  className="lien-discret"
                  onClick={() => setSourceChoisie(a.codeActivite)}
                  disabled={creation}
                >
                  Voir ses rédactions
                </button>
              </li>
            ))}
            {candidats.donnees.data.length === 0 && (
              <li className="detail">Aucune activité ne correspond.</li>
            )}
          </ul>
        )}

        {variantesSource.chargement && <Loader />}
        {variantesSource.donnees && (
          <div className="encart-metiers">
            <p className="encart-metiers__titre">
              {sourceChoisie} — {variantesSource.donnees.data.length} rédaction(s) disponible(s)
            </p>
            <ul className="encart-metiers__liste">
              {variantesSource.donnees.data.map((v) => (
                <li key={v.coupleModeleId}>
                  <span>
                    {v.intituleActivite ?? 'Sans intitulé'}{' '}
                    <span className="detail">
                      ({v.metiers.length} métier(s), {v.connaissances.length} domaine(s))
                    </span>
                  </span>
                  <button
                    type="button"
                    className="lien-discret"
                    onClick={() => reprendre(v)}
                    disabled={creation}
                  >
                    Reprendre cette rédaction
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <FormulaireRedaction
          redaction={redaction}
          onChange={setRedaction}
          idPrefix="nouveau"
          desactive={creation}
        />
      </section>

      <section className="fiche__section">
        <h2>Domaines de connaissance</h2>
        <ChampsConnaissances
          lignes={connaissances}
          onChange={setConnaissances}
          desactive={creation}
        />
        <p className="detail">
          La durée d’acquisition n’est pas saisie : chaque domaine reprend celle du référentiel
          pour le niveau choisi.
        </p>
      </section>

      <div className="fiche__entete-boutons">
        <button
          type="button"
          className="bouton--export"
          onClick={soumettre}
          disabled={creation || !pret}
        >
          {creation ? 'Création…' : 'Créer le couple'}
        </button>
      </div>
      {!pret && (
        <p className="detail">
          Pour créer le couple : un métier, un emplacement et un intitulé d’activité au minimum.
        </p>
      )}
    </div>
  );
}
