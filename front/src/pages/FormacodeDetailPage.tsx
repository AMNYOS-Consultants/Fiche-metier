import { useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { obtenirFormacode, modifierFormacodeNiveaux, supprimerFormacode } from '@/api/activites';
import type { LigneNiveauFormacode } from '@/api/activites';
import { ApiError } from '@/api/client';
import { useFetch } from '@/hooks/useFetch';
import { Loader } from '@/components/Loader';
import { ErrorMessage } from '@/components/ErrorMessage';
import type { FormacodeNiveau } from '@/types/api';

type OrigineFormacode = 'base_formacodes' | 'base_competences' | 'outil_fiche_metier';

const LIBELLE_ORIGINE: Record<string, string> = {
  base_formacodes: 'Base formacodes DC structurants',
  base_competences: 'Base compétences V3.3',
  outil_fiche_metier: 'Outil fiche métier',
};

const ORIGINES: OrigineFormacode[] = ['base_formacodes', 'base_competences', 'outil_fiche_metier'];

interface LigneEditable {
  cle: string;
  niveau: number;
  origine: OrigineFormacode;
  estNiveauUnique: boolean;
  dureeHeures: string;
  dureeSemaines: string;
  dureeMois: string;
  methodeCalcul: string;
  source: string;
}

function versLigneEditable(n: FormacodeNiveau, cle: string): LigneEditable {
  return {
    cle,
    niveau: n.niveau,
    origine: n.origine,
    estNiveauUnique: n.estNiveauUnique,
    dureeHeures: n.dureeHeures ?? '',
    dureeSemaines: n.dureeSemaines ?? '',
    dureeMois: n.dureeMois ?? '',
    methodeCalcul: n.methodeCalcul ?? '',
    source: n.source ?? '',
  };
}

/** `''` -> `null`, sinon le nombre — un champ de durée vide n'est pas 0, il est absent. */
function versNombreOuNull(valeur: string): number | null {
  const v = valeur.trim();
  if (!v) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function FormacodeDetailPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [recharger, setRecharger] = useState(0);
  const { donnees, chargement, erreur } = useFetch(
    (signal) => obtenirFormacode(code, signal),
    [code, recharger],
  );

  const [modeEdition, setModeEdition] = useState(false);
  const [lignes, setLignes] = useState<LigneEditable[]>([]);
  const [ligneSelectionneeCle, setLigneSelectionneeCle] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreurEdition, setErreurEdition] = useState<string | null>(null);
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null);
  const compteurCles = useRef(0);

  if (chargement) return <Loader />;
  if (erreur) return <ErrorMessage message={erreur} />;
  if (!donnees) return null;

  const f = donnees;
  const niveaux = f.niveaux ?? [];
  const metiers = f.metiers ?? [];

  function commencerEdition() {
    const initiales = niveaux.map((n) => versLigneEditable(n, String(n.id)));
    setLignes(initiales);
    setLigneSelectionneeCle(initiales[0]?.cle ?? null);
    setErreurEdition(null);
    setModeEdition(true);
  }

  function annulerEdition() {
    setModeEdition(false);
    setErreurEdition(null);
  }

  function ajouterLigne() {
    compteurCles.current += 1;
    const cle = `nouvelle-${compteurCles.current}`;
    setLignes((precedent) => [
      ...precedent,
      {
        cle,
        niveau: 1,
        origine: 'outil_fiche_metier',
        estNiveauUnique: false,
        dureeHeures: '',
        dureeSemaines: '',
        dureeMois: '',
        methodeCalcul: '',
        source: '',
      },
    ]);
    // La nouvelle ligne est sélectionnée d'office : sa méthode/référence est ce qu'on
    // vient probablement ajouter, pas besoin de la rechercher dans le menu déroulant.
    setLigneSelectionneeCle(cle);
  }

  function supprimerLigne(cle: string) {
    const suite = lignes.filter((l) => l.cle !== cle);
    setLignes(suite);
    if (ligneSelectionneeCle === cle) setLigneSelectionneeCle(suite[0]?.cle ?? null);
  }

  function modifierLigne<K extends keyof LigneEditable>(cle: string, champ: K, valeur: LigneEditable[K]) {
    setLignes((precedent) => precedent.map((l) => (l.cle === cle ? { ...l, [champ]: valeur } : l)));
  }

  async function enregistrer() {
    const cles = lignes.map((l) => `${l.niveau}|${l.origine}`);
    if (cles.length !== new Set(cles).size) {
      setErreurEdition('Deux lignes portent le même niveau pour la même source.');
      return;
    }

    setEnregistrement(true);
    setErreurEdition(null);
    try {
      const payload: LigneNiveauFormacode[] = lignes.map((l) => ({
        niveau: l.niveau,
        origine: l.origine,
        estNiveauUnique: l.estNiveauUnique,
        dureeHeures: versNombreOuNull(l.dureeHeures),
        dureeSemaines: versNombreOuNull(l.dureeSemaines),
        dureeMois: versNombreOuNull(l.dureeMois),
        methodeCalcul: l.methodeCalcul.trim() || null,
        source: l.source.trim() || null,
      }));
      await modifierFormacodeNiveaux(code, payload);
      setModeEdition(false);
      setRecharger((v) => v + 1);
    } catch (err) {
      setErreurEdition(err instanceof ApiError ? err.message : 'Enregistrement impossible');
    } finally {
      setEnregistrement(false);
    }
  }

  async function supprimer() {
    if (!window.confirm(`Supprimer définitivement le formacode ${f.codeFormacode} ?`)) return;

    setSuppressionEnCours(true);
    setErreurSuppression(null);
    try {
      await supprimerFormacode(code);
      navigate('/formacodes');
    } catch (err) {
      setErreurSuppression(err instanceof ApiError ? err.message : 'Suppression impossible');
    } finally {
      setSuppressionEnCours(false);
    }
  }

  return (
    <article className="page fiche">
      <header className="fiche__entete">
        <div className="fiche__entete-ligne">
          <div>
            <span className="carte__code">{f.codeFormacode}</span>
            <h1>{f.intitule}</h1>
          </div>
          {!modeEdition && (
            <button
              type="button"
              className="bouton--retirer-ligne"
              onClick={supprimer}
              disabled={suppressionEnCours || metiers.length > 0}
              title={
                metiers.length > 0
                  ? `Utilisé par ${metiers.length} métier(s) : retirez d’abord ce domaine de connaissance de leurs couples`
                  : undefined
              }
            >
              {suppressionEnCours ? 'Suppression…' : 'Supprimer'}
            </button>
          )}
        </div>
        {erreurSuppression && <ErrorMessage message={erreurSuppression} />}
        {f.nsf && (
          <p className="fiche__famille">
            NSF {f.nsf.codeNsf}
            {f.nsf.libelle ? ` — ${f.nsf.libelle}` : ''}
          </p>
        )}
      </header>

      <section className="fiche__section">
        <div className="fiche__entete-ligne">
          <h2>Durées et méthodes de calcul par niveau</h2>
          <div className="fiche__entete-boutons">
            {modeEdition ? (
              <>
                <button
                  type="button"
                  className="bouton--secondaire"
                  onClick={annulerEdition}
                  disabled={enregistrement}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="bouton--export"
                  onClick={enregistrer}
                  disabled={enregistrement}
                >
                  {enregistrement ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </>
            ) : (
              <button type="button" className="bouton--secondaire" onClick={commencerEdition}>
                Modifier
              </button>
            )}
          </div>
        </div>

        {erreurEdition && <ErrorMessage message={erreurEdition} />}

        {modeEdition && (
          <p className="detail">
            Une durée changée peut périmer les passerelles de tous les métiers dont un couple
            porte ce formacode, quel que soit le niveau — un recalcul sera nécessaire.
          </p>
        )}

        {modeEdition ? (
          <>
            {lignes.length === 0 ? (
              <p className="vide">Aucun niveau. Utilisez « Ajouter un niveau » ci-dessous.</p>
            ) : (
              <div className="tableau-scroll">
                <table className="tableau">
                  <thead>
                    <tr>
                      <th>Niveau</th>
                      <th>Unique</th>
                      <th>Heures</th>
                      <th>Semaines</th>
                      <th>Mois</th>
                      <th>Source</th>
                      <th>Méthode / référence</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map((l) => (
                      <tr key={l.cle}>
                        <td>
                          <select
                            aria-label="Niveau"
                            value={l.niveau}
                            disabled={enregistrement}
                            onChange={(e) => modifierLigne(l.cle, 'niveau', Number(e.target.value))}
                          >
                            {[1, 2, 3, 4].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label="Niveau unique"
                            checked={l.estNiveauUnique}
                            disabled={enregistrement}
                            onChange={(e) => modifierLigne(l.cle, 'estNiveauUnique', e.target.checked)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="champ-etroit"
                            aria-label="Heures"
                            value={l.dureeHeures}
                            disabled={enregistrement}
                            onChange={(e) => modifierLigne(l.cle, 'dureeHeures', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="champ-etroit"
                            aria-label="Semaines"
                            value={l.dureeSemaines}
                            disabled={enregistrement}
                            onChange={(e) => modifierLigne(l.cle, 'dureeSemaines', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="champ-etroit"
                            aria-label="Mois"
                            value={l.dureeMois}
                            disabled={enregistrement}
                            onChange={(e) => modifierLigne(l.cle, 'dureeMois', e.target.value)}
                          />
                        </td>
                        <td>
                          <select
                            aria-label="Source"
                            className="champ-origine"
                            value={l.origine}
                            disabled={enregistrement}
                            onChange={(e) => modifierLigne(l.cle, 'origine', e.target.value as OrigineFormacode)}
                          >
                            {ORIGINES.map((o) => (
                              <option key={o} value={o}>
                                {LIBELLE_ORIGINE[o]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={
                              l.cle === ligneSelectionneeCle ? 'lien-bouton lien-bouton--actif' : 'lien-bouton'
                            }
                            onClick={() => setLigneSelectionneeCle(l.cle)}
                            disabled={enregistrement}
                          >
                            {l.methodeCalcul || l.source ? 'Modifier' : 'Ajouter'}
                          </button>
                          {(l.methodeCalcul || l.source) && <span className="detail"> · renseigné</span>}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="bouton--retirer-ligne"
                            onClick={() => supprimerLigne(l.cle)}
                            disabled={enregistrement}
                            title="Retirer ce niveau"
                          >
                            Retirer
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button
              type="button"
              className="bouton--secondaire bouton--ajouter"
              onClick={ajouterLigne}
              disabled={enregistrement}
            >
              + Ajouter un niveau
            </button>

            {lignes.length > 0 &&
              (() => {
                const ligneSelectionnee = lignes.find((l) => l.cle === ligneSelectionneeCle) ?? lignes[0];
                return (
                  <div className="formacode-methode-edition">
                    <div className="passerelles-champ">
                      <label htmlFor="formacode-select-niveau-methode">
                        Méthode de calcul et référence — niveau concerné
                      </label>
                      <select
                        id="formacode-select-niveau-methode"
                        value={ligneSelectionnee.cle}
                        disabled={enregistrement}
                        onChange={(e) => setLigneSelectionneeCle(e.target.value)}
                      >
                        {lignes.map((l) => (
                          <option key={l.cle} value={l.cle}>
                            Niveau {l.niveau} — {LIBELLE_ORIGINE[l.origine]}
                            {(l.methodeCalcul || l.source) ? ' (renseigné)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="formacode-methode-edition__champ">
                      <label htmlFor="formacode-methode-calcul">Méthode de calcul</label>
                      <textarea
                        id="formacode-methode-calcul"
                        rows={5}
                        value={ligneSelectionnee.methodeCalcul}
                        disabled={enregistrement}
                        onChange={(e) => modifierLigne(ligneSelectionnee.cle, 'methodeCalcul', e.target.value)}
                      />
                    </div>

                    <div className="formacode-methode-edition__champ">
                      <label htmlFor="formacode-source">Référence / source du chiffre</label>
                      <textarea
                        id="formacode-source"
                        rows={3}
                        value={ligneSelectionnee.source}
                        disabled={enregistrement}
                        onChange={(e) => modifierLigne(ligneSelectionnee.cle, 'source', e.target.value)}
                      />
                    </div>
                  </div>
                );
              })()}
          </>
        ) : niveaux.length === 0 ? (
          <p className="vide">Aucune durée renseignée.</p>
        ) : (
          <>
            <table className="tableau">
              <thead>
                <tr>
                  <th>Niveau</th>
                  <th>Heures</th>
                  <th>Semaines</th>
                  <th>Mois</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {niveaux.map((n) => (
                  <tr key={n.id}>
                    <td>
                      {n.niveau}
                      {n.estNiveauUnique && <span className="detail"> (unique)</span>}
                    </td>
                    <td>{n.dureeHeures ?? '—'}</td>
                    <td>{n.dureeSemaines ?? '—'}</td>
                    <td>{n.dureeMois ?? '—'}</td>
                    <td className="detail">{LIBELLE_ORIGINE[n.origine] ?? n.origine}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {niveaux.some((n) => n.methodeCalcul || n.source) && (
              <dl className="definitions">
                {niveaux
                  .filter((n) => n.methodeCalcul || n.source)
                  .map((n) => (
                    <div key={n.id}>
                      <dt>
                        Niveau {n.niveau} — {LIBELLE_ORIGINE[n.origine] ?? n.origine}
                      </dt>
                      <dd>
                        {n.methodeCalcul && <p>{n.methodeCalcul}</p>}
                        {n.source && <p className="detail">Source : {n.source}</p>}
                      </dd>
                    </div>
                  ))}
              </dl>
            )}
          </>
        )}
      </section>

      <section className="fiche__section">
        <h2>Métiers concernés</h2>
        {metiers.length === 0 ? (
          <p className="vide">Aucun métier ne porte ce domaine de connaissance.</p>
        ) : (
          <table className="tableau">
            <thead>
              <tr>
                <th>Métier</th>
                <th className="colonne-etroite">Niveau requis</th>
                <th className="colonne-etroite">Couples concernés</th>
              </tr>
            </thead>
            <tbody>
              {metiers.map((m) => (
                <tr key={m.codeMetier}>
                  <th scope="row">
                    <Link to={`/metiers/${encodeURIComponent(m.codeMetier)}`}>{m.intitule}</Link>
                    <span className="detail"> ({m.codeMetier})</span>
                  </th>
                  <td className="colonne-etroite">{m.niveauMax ?? '—'}</td>
                  <td className="colonne-etroite">{m.nbCouples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Link to="/formacodes" className="lien-retour">
        ← Retour aux domaines de connaissance
      </Link>
    </article>
  );
}
