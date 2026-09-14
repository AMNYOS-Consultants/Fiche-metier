import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listerFormacodes, obtenirReferentiels, creerFormacode } from '@/api/activites';
import { ApiError } from '@/api/client';
import { exporterFormacodesCsv } from '@/utils/exportCsv';
import { useFetch } from '@/hooks/useFetch';
import { SearchBar } from '@/components/SearchBar';
import { FiltreSelect } from '@/components/FiltreSelect';
import { Pagination } from '@/components/Pagination';
import { Loader } from '@/components/Loader';
import { ErrorMessage } from '@/components/ErrorMessage';
import type { Formacode } from '@/types/api';

export function FormacodesPage() {
  const navigate = useNavigate();
  const [recherche, setRecherche] = useState('');
  const [nsf, setNsf] = useState('');
  const [page, setPage] = useState(1);
  const [exportEnCours, setExportEnCours] = useState(false);

  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [nouveauCode, setNouveauCode] = useState('');
  const [nouvelIntitule, setNouvelIntitule] = useState('');
  const [nouveauNsf, setNouveauNsf] = useState('');
  const [nouveauFondamental, setNouveauFondamental] = useState(false);
  const [creationEnCours, setCreationEnCours] = useState(false);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);
  const [doublonIntitule, setDoublonIntitule] = useState<Formacode | null>(null);

  const referentiels = useFetch((signal) => obtenirReferentiels(signal), []);
  const formacodes = useFetch(
    (signal) => listerFormacodes({ search: recherche, nsf, page, limit: 30 }, signal),
    [recherche, nsf, page],
  );

  const changerFiltre = (setter: (v: string) => void) => (valeur: string) => {
    setter(valeur);
    setPage(1);
  };

  // Avertit d'un intitulé déjà pris (à la casse près) plutôt que de créer un doublon — voir
  // back/src/database/importers/correctionsFormacodes.ts, plusieurs corrections récentes en
  // venaient (« Approvisionnement » / « approvisionnement », etc.). N'empêche pas la création :
  // deux formacodes peuvent légitimement porter le même intitulé dans des NSF différents.
  useEffect(() => {
    if (!formulaireOuvert) return;
    const terme = nouvelIntitule.trim();
    if (terme.length < 3) {
      setDoublonIntitule(null);
      return;
    }

    const controller = new AbortController();
    const minuteur = setTimeout(async () => {
      try {
        const resultat = await listerFormacodes({ search: terme, limit: 50 }, controller.signal);
        const correspondance = resultat.data.find(
          (f) => f.intitule.trim().toLowerCase() === terme.toLowerCase(),
        );
        setDoublonIntitule(correspondance ?? null);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setDoublonIntitule(null);
      }
    }, 400);

    return () => {
      clearTimeout(minuteur);
      controller.abort();
    };
  }, [nouvelIntitule, formulaireOuvert]);

  async function exporter() {
    setExportEnCours(true);
    try {
      await exporterFormacodesCsv({ search: recherche, nsf });
    } finally {
      setExportEnCours(false);
    }
  }

  function ouvrirFormulaire() {
    setNouveauCode('');
    setNouvelIntitule('');
    setNouveauNsf('');
    setNouveauFondamental(false);
    setErreurCreation(null);
    setDoublonIntitule(null);
    setFormulaireOuvert(true);
  }

  async function creer() {
    const code = nouveauCode.trim();
    const intitule = nouvelIntitule.trim();
    if (!code || !intitule) {
      setErreurCreation('Le code et l’intitulé sont obligatoires.');
      return;
    }

    setCreationEnCours(true);
    setErreurCreation(null);
    try {
      await creerFormacode({
        codeFormacode: code,
        intitule,
        codeNsf: nouveauNsf || null,
        estFondamental: nouveauFondamental,
      });
      // La suite naturelle est d'y ajouter les niveaux/durées, déjà édités sur la fiche.
      navigate(`/formacodes/${encodeURIComponent(code)}`);
    } catch (err) {
      setErreurCreation(err instanceof ApiError ? err.message : 'Création impossible');
    } finally {
      setCreationEnCours(false);
    }
  }

  return (
    <div className="page">
      <div className="fiche__entete-ligne">
        <h1>Domaines de connaissance</h1>
        <div className="fiche__entete-boutons">
          {!formulaireOuvert && (
            <button type="button" className="bouton--secondaire" onClick={ouvrirFormulaire}>
              + Créer un formacode
            </button>
          )}
          <button type="button" className="bouton--export" onClick={exporter} disabled={exportEnCours}>
            {exportEnCours ? 'Export en cours…' : 'Exporter en Excel'}
          </button>
        </div>
      </div>

      {formulaireOuvert && (
        <div className="fiche__section formacode-creation">
          <h2>Nouveau formacode</h2>
          {erreurCreation && <ErrorMessage message={erreurCreation} />}
          <div className="passerelles-parametres">
            <div className="passerelles-champ">
              <label htmlFor="formacode-nouveau-code">Code formacode</label>
              <input
                id="formacode-nouveau-code"
                type="text"
                maxLength={10}
                value={nouveauCode}
                disabled={creationEnCours}
                onChange={(e) => setNouveauCode(e.target.value)}
                placeholder="ex. 21547"
              />
            </div>
            <div className="passerelles-champ passerelles-champ--large">
              <label htmlFor="formacode-nouvel-intitule">Intitulé</label>
              <input
                id="formacode-nouvel-intitule"
                type="text"
                maxLength={255}
                value={nouvelIntitule}
                disabled={creationEnCours}
                onChange={(e) => setNouvelIntitule(e.target.value)}
              />
              {doublonIntitule && (
                <p className="avertissement-champ">
                  ⚠ Un formacode porte déjà cet intitulé :{' '}
                  <Link to={`/formacodes/${encodeURIComponent(doublonIntitule.codeFormacode)}`}>
                    {doublonIntitule.codeFormacode}
                  </Link>
                  . Vérifiez qu’il ne s’agit pas d’un doublon avant de continuer.
                </p>
              )}
            </div>
            <div className="passerelles-champ">
              <label htmlFor="formacode-nouveau-nsf">NSF</label>
              <select
                id="formacode-nouveau-nsf"
                value={nouveauNsf}
                disabled={creationEnCours}
                onChange={(e) => setNouveauNsf(e.target.value)}
              >
                <option value="">—</option>
                {(referentiels.donnees?.nsf ?? []).map((n) => (
                  <option key={n.codeNsf} value={n.codeNsf}>
                    {n.libelle ? `${n.codeNsf} — ${n.libelle}` : n.codeNsf}
                  </option>
                ))}
              </select>
            </div>
            <div className="passerelles-champ passerelles-champ--case">
              <label htmlFor="formacode-nouveau-fondamental">
                <input
                  id="formacode-nouveau-fondamental"
                  type="checkbox"
                  checked={nouveauFondamental}
                  disabled={creationEnCours}
                  onChange={(e) => setNouveauFondamental(e.target.checked)}
                />
                Fondamental
              </label>
            </div>
          </div>
          <div className="fiche__entete-boutons">
            <button
              type="button"
              className="bouton--secondaire"
              onClick={() => setFormulaireOuvert(false)}
              disabled={creationEnCours}
            >
              Annuler
            </button>
            <button type="button" className="bouton--export" onClick={creer} disabled={creationEnCours}>
              {creationEnCours ? 'Création…' : 'Créer'}
            </button>
          </div>
        </div>
      )}

      <div className="barre-filtres">
        <SearchBar
          valeur={recherche}
          onChange={changerFiltre(setRecherche)}
          placeholder="Rechercher un formacode…"
        />
        <FiltreSelect
          label="NSF"
          valeur={nsf}
          onChange={changerFiltre(setNsf)}
          options={(referentiels.donnees?.nsf ?? []).map((n) => ({
            valeur: n.codeNsf,
            libelle: n.libelle ? `${n.codeNsf} — ${n.libelle}` : n.codeNsf,
          }))}
        />
      </div>

      {formacodes.erreur && <ErrorMessage message={formacodes.erreur} />}
      {formacodes.chargement && <Loader />}

      {formacodes.donnees && (
        <>
          <table className="tableau">
            <thead>
              <tr>
                <th>Formacode</th>
                <th>Intitulé</th>
                <th>NSF</th>
                <th>Fondamental</th>
              </tr>
            </thead>
            <tbody>
              {formacodes.donnees.data.map((f) => (
                <tr key={f.codeFormacode}>
                  <td>
                    <Link to={`/formacodes/${encodeURIComponent(f.codeFormacode)}`}>
                      {f.codeFormacode}
                    </Link>
                  </td>
                  <td>{f.intitule}</td>
                  <td>{f.codeNsf ?? '—'}</td>
                  <td>{f.estFondamental ? 'Oui' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {formacodes.donnees.data.length === 0 && <p className="vide">Aucun résultat.</p>}

          <Pagination pagination={formacodes.donnees.pagination} onChangePage={setPage} />
        </>
      )}
    </div>
  );
}
