import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { obtenirActivite, obtenirVariantes, modifierRedaction } from '@/api/activites';
import { ApiError } from '@/api/client';
import { useFetch } from '@/hooks/useFetch';
import { Loader } from '@/components/Loader';
import { ErrorMessage } from '@/components/ErrorMessage';
import { EditeurConnaissances } from '@/components/EditeurConnaissances';
import {
  FormulaireRedaction,
  redactionDepuis,
  versEditionModele,
  type Redaction,
} from '@/components/FormulaireRedaction';
import { dateModification } from '@/utils/format';
import type { VarianteDetaillee } from '@/types/api';

function ListeDetails({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="detail">—</span>;
  return (
    <ul className="couple__details">
      {items.map((d, i) => (
        <li key={i}>{d}</li>
      ))}
    </ul>
  );
}

function libelleDomaine(c: { codeFormacode: string; intitule: string | null; niveau: number | null }) {
  const nom = c.intitule ?? c.codeFormacode;
  return c.niveau !== null ? `${nom} (niv. ${c.niveau})` : nom;
}

export function ActiviteDetailPage() {
  const { code = '' } = useParams();
  const [recharger, setRecharger] = useState(0);
  /** Rédaction en cours d'édition, identifiée par son couple modèle. */
  const [editionId, setEditionId] = useState<number | null>(null);
  const [redaction, setRedaction] = useState<Redaction | null>(null);
  /** Couple dont on édite les domaines de connaissance. */
  const [dcCoupleId, setDcCoupleId] = useState<number | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const activite = useFetch((signal) => obtenirActivite(code, signal), [code, recharger]);
  const variantes = useFetch((signal) => obtenirVariantes(code, signal), [code, recharger]);

  if (activite.erreur) return <ErrorMessage message={activite.erreur} />;
  if (variantes.erreur) return <ErrorMessage message={variantes.erreur} />;
  if (activite.chargement || variantes.chargement) return <Loader />;
  if (!activite.donnees || !variantes.donnees) return null;

  const a = activite.donnees;
  const redactions = variantes.donnees.data;
  const nbMetiers = redactions.reduce((somme, v) => somme + v.metiers.length, 0);

  function commencerEdition(v: VarianteDetaillee) {
    setEditionId(v.coupleModeleId);
    setRedaction(redactionDepuis(v));
    setDcCoupleId(null);
    setErreur(null);
  }

  function annuler() {
    setEditionId(null);
    setRedaction(null);
    setErreur(null);
  }

  async function enregistrer(v: VarianteDetaillee) {
    if (!redaction) return;
    setEnregistrement(true);
    setErreur(null);
    try {
      await modifierRedaction(code, v.coupleModeleId, versEditionModele(redaction));
      annuler();
      setRecharger((n) => n + 1);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Enregistrement impossible');
    } finally {
      setEnregistrement(false);
    }
  }

  return (
    <article className="page fiche">
      <header className="fiche__entete">
        <span className="carte__code">{a.codeActivite}</span>
        <h1>{redactions[0]?.intituleActivite ?? a.intituleActivite ?? 'Activité'}</h1>
        {(a.famille?.domaine1 || a.famille?.domaine2) && (
          <p className="fiche__famille">
            {[a.famille?.domaine1, a.famille?.domaine2].filter(Boolean).join(' · ')}
          </p>
        )}
        {a.famille?.domaine3 && <p className="fiche__famille-detail">{a.famille.domaine3}</p>}
      </header>

      {erreur && <ErrorMessage message={erreur} />}

      {redactions.length > 1 && (
        <div className="bandeau-alerte">
          <span>
            {redactions.length} rédactions divergentes pour ce code, sur {nbMetiers} métiers.
            Chacune s’édite séparément ci-dessous ; pour les aligner ou détacher l’une d’elles
            vers un nouveau code, passez par la correction des incohérences.
          </span>
          <Link to={`/activites/incoherences/${encodeURIComponent(code)}`} className="bouton--secondaire">
            Corriger les incohérences
          </Link>
        </div>
      )}

      {redactions.length === 0 && (
        <p className="vide">Aucun métier n’emploie cette activité.</p>
      )}

      {redactions.map((v, index) => {
        const enEdition = editionId === v.coupleModeleId;

        return (
          <section key={v.coupleModeleId} className="fiche__section">
            <div className="fiche__entete-ligne">
              <h2>
                {redactions.length > 1 ? `Rédaction ${index + 1}` : 'Rédaction'}
                {v.intituleActivite ? ` — ${v.intituleActivite}` : ''}
              </h2>
              {!enEdition && (
                <button
                  type="button"
                  className="bouton--secondaire"
                  onClick={() => commencerEdition(v)}
                  disabled={enregistrement}
                >
                  Modifier
                </button>
              )}
            </div>

            {enEdition && redaction ? (
              <>
                <FormulaireRedaction
                  redaction={redaction}
                  onChange={setRedaction}
                  idPrefix={`red-${v.coupleModeleId}`}
                  desactive={enregistrement}
                  sansNiveaux={v.niveauxMaitrise.length === 0}
                />
                <p className="detail">
                  L’enregistrement s’applique aux {v.metiers.length} métier(s) qui portent cette
                  rédaction, et à eux seuls.
                </p>
                <div className="fiche__entete-boutons">
                  <button
                    type="button"
                    className="bouton--secondaire"
                    onClick={annuler}
                    disabled={enregistrement}
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    className="bouton--export"
                    onClick={() => enregistrer(v)}
                    disabled={enregistrement}
                  >
                    {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </div>
              </>
            ) : (
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
                      <ListeDetails items={v.detailsActivite} />
                    </td>
                    <td>
                      <ListeDetails items={v.detailsCompetence} />
                    </td>
                  </tr>
                </tbody>
              </table>
            )}

            {!enEdition && v.niveauxMaitrise.length > 0 && (
              <p className="detail">
                Niveaux de maîtrise :{' '}
                {v.niveauxMaitrise.map((n) => `${n.niveau}. ${n.description}`).join(' — ')}
              </p>
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
                      <Link to={`/formacodes/${encodeURIComponent(c.codeFormacode)}`}>
                        {libelleDomaine(c)}
                      </Link>
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
                    <Link to={`/metiers/${encodeURIComponent(m.codeMetier)}`}>
                      {m.intitule} <span className="detail">({m.codeMetier})</span>
                    </Link>
                    <span className="detail">Modifié : {dateModification(m.modifieLe)}</span>
                    {dcCoupleId === m.coupleId ? null : (
                      <button
                        type="button"
                        className="lien-discret"
                        onClick={() => {
                          setDcCoupleId(m.coupleId);
                          annuler();
                        }}
                      >
                        Modifier ses domaines
                      </button>
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
                    setRecharger((n) => n + 1);
                  }}
                  onAnnule={() => setDcCoupleId(null)}
                />
              )}
            </div>
          </section>
        );
      })}

      <Link to="/activites" className="lien-retour">
        ← Retour aux activités
      </Link>
    </article>
  );
}
