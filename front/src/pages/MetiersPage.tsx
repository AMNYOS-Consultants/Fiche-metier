import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listerMetiers } from '@/api/metiers';
import { obtenirReferentiels } from '@/api/activites';
import { useFetch } from '@/hooks/useFetch';
import { SearchBar } from '@/components/SearchBar';
import { FiltreSelect } from '@/components/FiltreSelect';
import { MetierCard } from '@/components/MetierCard';
import { Pagination } from '@/components/Pagination';
import { Loader } from '@/components/Loader';
import { ErrorMessage } from '@/components/ErrorMessage';
import { libelleFamille } from '@/utils/format';

export function MetiersPage() {
  const [recherche, setRecherche] = useState('');
  const [famille, setFamille] = useState('');
  const [dossier, setDossier] = useState('');
  const [rome, setRome] = useState('');
  const [page, setPage] = useState(1);

  const referentiels = useFetch((signal) => obtenirReferentiels(signal), []);
  const metiers = useFetch(
    (signal) =>
      listerMetiers(
        { search: recherche, famille, dossier: dossier ? Number(dossier) : undefined, rome, page, limit: 24 },
        signal,
      ),
    [recherche, famille, dossier, rome, page],
  );

  // Un changement de filtre doit ramener à la page 1, sinon on affiche une page
  // hors bornes du nouveau jeu de résultats.
  const changerFiltre = (setter: (v: string) => void) => (valeur: string) => {
    setter(valeur);
    setPage(1);
  };

  return (
    <div className="page">
      <div className="fiche__entete-ligne">
        <h1>Métiers</h1>
        <Link to="/metiers/nouveau" className="bouton--export">
          + Créer une fiche métier
        </Link>
      </div>

      <div className="barre-filtres">
        <SearchBar
          valeur={recherche}
          onChange={changerFiltre(setRecherche)}
          placeholder="Rechercher un métier ou un code (D192)…"
        />
        <FiltreSelect
          label="Famille"
          valeur= {famille}
          onChange={changerFiltre(setFamille)}
          options={(referentiels.donnees?.famillesMetier ?? []).map((f) => ({
            valeur: f.codeFamille,
            libelle: libelleFamille(f),
          }))}
        />
        <FiltreSelect
          label="Fiche ROME"
          valeur={rome}
          onChange={changerFiltre(setRome)}
          options={(referentiels.donnees?.rome ?? []).map((r) => ({
            valeur: r.codeRome,
            // La source ne documente le libellé que pour 27 des 136 codes.
            libelle: r.libelle ? `${r.codeRome} — ${r.libelle}` : r.codeRome,
          }))}
        />
        <FiltreSelect
          label="Dossier"
          valeur={dossier}
          onChange={changerFiltre(setDossier)}
          options={(referentiels.donnees?.dossiersSource ?? []).map((d) => ({
            valeur: String(d.id),
            libelle: d.libelle,
          }))}
        />
      </div>

      {metiers.erreur && <ErrorMessage message={metiers.erreur} />}
      {metiers.chargement && <Loader />}

      {metiers.donnees && (
        <>
          <div className="grille">
            {metiers.donnees.data.map((m) => (
              <MetierCard key={m.codeMetier} metier={m} />
            ))}
          </div>

          {metiers.donnees.data.length === 0 && <p className="vide">Aucun métier ne correspond.</p>}

          <Pagination pagination={metiers.donnees.pagination} onChangePage={setPage} />
        </>
      )}
    </div>
  );
}
