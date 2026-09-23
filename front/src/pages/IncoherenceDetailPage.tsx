import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { obtenirVariantes, harmoniserCouple, scinderVariante } from '@/api/activites';
import { ApiError } from '@/api/client';
import { useFetch } from '@/hooks/useFetch';
import { Loader } from '@/components/Loader';
import { ErrorMessage } from '@/components/ErrorMessage';
import { EditeurConnaissances } from '@/components/EditeurConnaissances';
import { EditeurMotsCles } from '@/components/EditeurMotsCles';
import {
  FormulaireRedaction,
  redactionDepuis,
  versEditionModele,
  type Redaction,
} from '@/components/FormulaireRedaction';
import { dateModification } from '@/utils/format';
import type { VarianteDetaillee } from '@/types/api';

function Details({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="detail">—</span>;
  return (
    <ul className="couple__details">
      {items.map((d, i) => (
        <li key={i}>{d}</li>
      ))}
    </ul>
  );
}

/** `I.02.08.01` -> `I.02.08` : le halo dans lequel un nouveau code serait créé. */
function halo(codeActivite: string): string {
  return codeActivite.split('.').slice(0, 3).join('.');
}

export function IncoherenceDetailPage() {
  const { code = '' } = useParams();
  const [recharger, setRecharger] = useState(0);
  const [selectionneId, setSelectionneId] = useState<number | null>(null);
  const [edition, setEdition] = useState<Redaction | null>(null);
  /** Couple dont on édite les domaines de connaissance (indépendant de la rédaction). */
  const [dcCoupleId, setDcCoupleId] = useState<number | null>(null);
  /** Couple dont on édite les mots-clés (indépendant de la rédaction). */
  const [mcCoupleId, setMcCoupleId] = useState<number | null>(null);
  const [actionEnCours, setActionEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  const variantes = useFetch((signal) => obtenirVariantes(code, signal), [code, recharger]);

  const donnees = variantes.donnees?.data ?? [];
  const totalMetiers = donnees.reduce((somme, v) => somme + v.metiers.length, 0);
  const selectionnee = donnees.find((v) => v.coupleModeleId === selectionneId) ?? null;

  function choisir(v: VarianteDetaillee) {
    // Re-cliquer sur la rédaction déjà choisie revient en arrière plutôt que de forcer à en
    // sélectionner une autre pour se raviser.
    if (selectionneId === v.coupleModeleId) {
      setSelectionneId(null);
      setEdition(null);
    } else {
      setSelectionneId(v.coupleModeleId);
      setEdition(redactionDepuis(v));
    }
    setDcCoupleId(null);
    setMcCoupleId(null);
    setErreur(null);
    setSucces(null);
  }

  /** La rédaction en cours d'édition, au format attendu par l'API. */
  function editionAEnvoyer() {
    return edition ? versEditionModele(edition) : undefined;
  }

  async function appliquer() {
    if (!selectionnee || !edition) return;
    const nbAutres = totalMetiers - selectionnee.metiers.length;
    if (
      !window.confirm(
        `Appliquer cette rédaction aux ${nbAutres} autre(s) métier(s) qui portent ${code} ? ` +
          'Leurs détails, niveaux de maîtrise et domaines de connaissance actuels seront ' +
          'remplacés (les mots-clés ne sont pas touchés). Cette action est définitive.',
      )
    ) {
      return;
    }
    setActionEnCours(true);
    setErreur(null);
    setSucces(null);
    try {
      await harmoniserCouple(code, selectionnee.coupleModeleId, editionAEnvoyer());
      setSelectionneId(null);
      setEdition(null);
      setRecharger((v) => v + 1);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Application impossible');
    } finally {
      setActionEnCours(false);
    }
  }

  /**
   * L'autre issue : cette rédaction décrit en fait une autre activité — on la détache vers
   * un nouveau code du même halo plutôt que de l'aligner sur les autres.
   */
  async function creerCouple() {
    if (!selectionnee || !edition) return;
    const nbRestants = totalMetiers - selectionnee.metiers.length;
    if (
      !window.confirm(
        `Créer un nouveau couple dans le halo ${halo(code)} à partir de cette rédaction ? ` +
          `Le ou les ${selectionnee.metiers.length} métier(s) qui la portent basculeront sur ce ` +
          `nouveau code, avec leurs détails et domaines de connaissance. ${code} restera porté ` +
          `par les ${nbRestants} autre(s) métier(s). Cette action est définitive.`,
      )
    ) {
      return;
    }
    setActionEnCours(true);
    setErreur(null);
    setSucces(null);
    try {
      const resultat = await scinderVariante(code, selectionnee.coupleModeleId, editionAEnvoyer());
      setSucces(
        `Couple ${resultat.codeActivite} créé : ${resultat.nbMetiersDeplaces} métier(s) y ont été déplacés.`,
      );
      setSelectionneId(null);
      setEdition(null);
      setRecharger((v) => v + 1);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Création impossible');
    } finally {
      setActionEnCours(false);
    }
  }

  return (
    <div className="page">
      <Link to="/activites/incoherences" className="lien-retour">
        ← Retour aux incohérences
      </Link>
      <h1>{code}</h1>
      <p className="fiche__famille">
        Choisissez d’abord une rédaction (« Partir de cette description »), modifiez-la si
        besoin, puis choisissez l’issue : <strong>l’appliquer à tous</strong> les métiers qui
        portent {code}, ou <strong>créer un couple</strong> — la rédaction est alors détachée
        vers un nouveau code du halo {halo(code)}, ce qui convient quand la divergence est
        légitime (deux métiers ne décrivent pas la même activité). Une confirmation est
        demandée avant toute écriture. Les domaines de connaissance et les mots-clés
        s’éditent séparément, métier par métier, dans l’encart de chaque rédaction.
      </p>

      {succes && <p className="bandeau-alerte">{succes}</p>}
      {erreur && <ErrorMessage message={erreur} />}
      {variantes.erreur && <ErrorMessage message={variantes.erreur} />}
      {variantes.chargement && <Loader />}

      {selectionnee && edition && (
        <div className="bandeau-alerte">
          <span>
            Rédaction retenue : « {edition.intituleActivite || 'Sans intitulé'} », portée par{' '}
            {selectionnee.metiers.length} des {totalMetiers} métiers qui portent {code}.
          </span>
          <div className="fiche__entete-boutons">
            <button
              type="button"
              className="bouton--secondaire"
              onClick={() => {
                setSelectionneId(null);
                setEdition(null);
              }}
              disabled={actionEnCours}
            >
              Annuler la sélection
            </button>
            <button
              type="button"
              className="bouton--secondaire"
              onClick={creerCouple}
              disabled={actionEnCours}
              title={`Détache cette rédaction vers un nouveau code du halo ${halo(code)}`}
            >
              {actionEnCours ? 'En cours…' : 'Créer un couple'}
            </button>
            <button
              type="button"
              className="bouton--export"
              onClick={appliquer}
              disabled={actionEnCours}
            >
              {actionEnCours ? 'En cours…' : 'Appliquer à tous'}
            </button>
          </div>
        </div>
      )}

      {variantes.donnees &&
        (donnees.length <= 1 ? (
          <p className="vide">Toutes les rédactions de ce code sont désormais identiques.</p>
        ) : (
          donnees.map((v) => {
            const estSelectionnee = v.coupleModeleId === selectionneId;
            return (
              <section
                key={v.coupleModeleId}
                className={
                  estSelectionnee ? 'fiche__section fiche__section--selectionnee' : 'fiche__section'
                }
              >
                <div className="fiche__entete-ligne">
                  <h2>{v.intituleActivite ?? 'Sans intitulé'}</h2>
                  <button
                    type="button"
                    className={estSelectionnee ? 'bouton--export' : 'bouton--secondaire'}
                    onClick={() => choisir(v)}
                    disabled={actionEnCours}
                  >
                    {estSelectionnee ? 'Sélectionnée ✓' : 'Partir de cette description'}
                  </button>
                </div>

                {estSelectionnee && edition ? (
                  <FormulaireRedaction
                    redaction={edition}
                    onChange={setEdition}
                    idPrefix={`inc-${v.coupleModeleId}`}
                    desactive={actionEnCours}
                    sansNiveaux={v.niveauxMaitrise.length === 0}
                  />
                ) : (
                  <>
                    <table className="tableau couple__table">
                      <thead>
                        <tr>
                          <th scope="col">{v.intituleActivite ?? 'Activité'}</th>
                          <th scope="col">{v.intituleCompetence ?? 'Compétence'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>
                            <Details items={v.detailsActivite} />
                          </td>
                          <td>
                            <Details items={v.detailsCompetence} />
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {v.niveauxMaitrise.length > 0 && (
                      <p className="detail">
                        Niveaux de maîtrise :{' '}
                        {v.niveauxMaitrise.map((n) => `${n.niveau}. ${n.description}`).join(' — ')}
                      </p>
                    )}
                  </>
                )}

                <div className="encart-metiers">
                  <p className="encart-metiers__titre">
                    Domaines de connaissance
                    {v.connaissances.length === 0 && ' — aucun'}
                  </p>
                  {v.connaissances.length > 0 && (
                    <ul className="badges">
                      {v.connaissances.map((c) => (
                        <li key={c.codeFormacode} className="badge">
                          {c.intitule ?? c.codeFormacode}
                          {c.niveau !== null && ` (niv. ${c.niveau})`}
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="encart-metiers__titre">
                    Portée par {v.metiers.length} métier{v.metiers.length > 1 ? 's' : ''}
                  </p>
                  <ul className="encart-metiers__liste">
                    {v.metiers.map((m) => (
                      <li key={m.coupleId}>
                        <div className="encart-metiers__entete">
                          <Link to={`/metiers/${encodeURIComponent(m.codeMetier)}`}>
                            {m.intitule} <span className="detail">({m.codeMetier})</span>
                          </Link>
                          <span className="detail">Modifié : {dateModification(m.modifieLe)}</span>
                        </div>
                        {m.motsCles.length > 0 && (
                          <ul className="badges">
                            {m.motsCles.map((mot) => (
                              <li key={mot} className="badge">
                                {mot}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="encart-metiers__actions">
                          {dcCoupleId !== m.coupleId && (
                            <button
                              type="button"
                              className="lien-discret"
                              onClick={() => {
                                setDcCoupleId(m.coupleId);
                                setMcCoupleId(null);
                              }}
                              disabled={actionEnCours}
                            >
                              Modifier ses domaines
                            </button>
                          )}
                          {mcCoupleId !== m.coupleId && (
                            <button
                              type="button"
                              className="lien-discret"
                              onClick={() => {
                                setMcCoupleId(m.coupleId);
                                setDcCoupleId(null);
                              }}
                              disabled={actionEnCours}
                            >
                              Modifier ses mots-clés
                            </button>
                          )}
                        </div>
                        {mcCoupleId === m.coupleId && (
                          <EditeurMotsCles
                            codeActivite={code}
                            coupleId={m.coupleId}
                            motsCles={m.motsCles}
                            onEnregistre={() => {
                              setMcCoupleId(null);
                              setSelectionneId(null);
                              setEdition(null);
                              setRecharger((n) => n + 1);
                            }}
                            onAnnule={() => setMcCoupleId(null)}
                          />
                        )}
                      </li>
                    ))}
                  </ul>

                  {v.metiers.some((m) => m.coupleId === dcCoupleId) && (
                    <EditeurConnaissances
                      codeActivite={code}
                      coupleId={dcCoupleId!}
                      connaissances={v.connaissances}
                      onEnregistre={() => {
                        setDcCoupleId(null);
                        setSelectionneId(null);
                        setEdition(null);
                        setRecharger((n) => n + 1);
                      }}
                      onAnnule={() => setDcCoupleId(null)}
                    />
                  )}
                </div>
              </section>
            );
          })
        ))}
    </div>
  );
}
