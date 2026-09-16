import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listerActivites } from '@/api/activites';
import { useFetch } from '@/hooks/useFetch';
import { SearchBar } from '@/components/SearchBar';
import { Pagination } from '@/components/Pagination';
import { Loader } from '@/components/Loader';
import { ErrorMessage } from '@/components/ErrorMessage';

export function ActivitesPage() {
  const [recherche, setRecherche] = useState('');
  const [page, setPage] = useState(1);

  const activites = useFetch(
    (signal) => listerActivites({ search: recherche, page, limit: 25 }, signal),
    [recherche, page],
  );

  return (
    <div className="page">
      <div className="fiche__entete-ligne">
        <h1>Activités &amp; compétences</h1>
        <Link to="/activites/incoherences" className="bouton--secondaire">
          Corriger les incohérences
        </Link>
      </div>

      <div className="barre-filtres">
        <SearchBar
          valeur={recherche}
          onChange={(v) => {
            setRecherche(v);
            setPage(1);
          }}
          placeholder="Rechercher une activité ou une compétence…"
        />
      </div>

      {activites.erreur && <ErrorMessage message={activites.erreur} />}
      {activites.chargement && <Loader />}

      {activites.donnees && (
        <>
          <table className="tableau">
            <thead>
              <tr>
                <th>Code</th>
                <th>Domaine d'activité 1</th>
                <th>Domaine d'activité 2</th>
                <th>Activité</th>
                <th>Compétence</th>
              </tr>
            </thead>
            <tbody>
              {activites.donnees.data.map((a) => (
                <tr key={a.codeActivite}>
                  <td>
                    <Link to={`/activites/${encodeURIComponent(a.codeActivite)}`}>
                      {a.codeActivite}
                    </Link>
                  </td>
                  <td>{a.famille?.domaine1 ?? '—'}</td>
                  <td>{a.famille?.domaine2 ?? '—'}</td>
                  <td>{a.intituleActivite}</td>
                  <td>{a.intituleCompetence ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {activites.donnees.data.length === 0 && <p className="vide">Aucun résultat.</p>}

          <Pagination pagination={activites.donnees.pagination} onChangePage={setPage} />
        </>
      )}
    </div>
  );
}
