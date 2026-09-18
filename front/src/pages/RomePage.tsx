import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listerRome } from '@/api/activites';
import { useFetch } from '@/hooks/useFetch';
import { SearchBar } from '@/components/SearchBar';
import { Loader } from '@/components/Loader';
import { ErrorMessage } from '@/components/ErrorMessage';

/**
 * Tous les codes ROME cités par les fiches, avec les métiers qui les portent. Le
 * référentiel tient en une réponse (136 codes) : la recherche filtre en mémoire, sur le
 * code, le libellé et les métiers rattachés.
 */
export function RomePage() {
  const [recherche, setRecherche] = useState('');
  const rome = useFetch((signal) => listerRome(signal), []);

  const lignes = useMemo(() => {
    const tous = rome.donnees?.data ?? [];
    const terme = recherche.trim().toLowerCase();
    if (!terme) return tous;
    return tous.filter(
      (r) =>
        r.codeRome.toLowerCase().includes(terme) ||
        (r.libelle ?? '').toLowerCase().includes(terme) ||
        r.metiers.some(
          (m) =>
            m.codeMetier.toLowerCase().includes(terme) || m.intitule.toLowerCase().includes(terme),
        ),
    );
  }, [rome.donnees, recherche]);

  const nbSansLibelle = (rome.donnees?.data ?? []).filter((r) => !r.libelle).length;

  return (
    <div className="page">
      <div className="fiche__entete-ligne">
        <h1>Codes ROME</h1>
      </div>

      {rome.donnees && (
        <p className="detail">
          {rome.donnees.data.length} codes cités par les fiches
          {nbSansLibelle > 0 && ` — ${nbSansLibelle} sans libellé dans la source`}.
        </p>
      )}

      <div className="barre-filtres">
        <SearchBar
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un code ROME, un libellé ou un métier…"
        />
      </div>

      {rome.erreur && <ErrorMessage message={rome.erreur} />}
      {rome.chargement && <Loader />}

      {rome.donnees && (
        <>
          <table className="tableau">
            <thead>
              <tr>
                <th>Code ROME</th>
                <th>Libellé</th>
                <th>Métiers</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((r) => (
                <tr key={r.codeRome}>
                  <td>
                    <span className="couple__code">{r.codeRome}</span>
                  </td>
                  <td>{r.libelle ?? '—'}</td>
                  <td>
                    {r.metiers.length === 0 ? (
                      <span className="detail">Aucun métier</span>
                    ) : (
                      <ul className="rome__metiers">
                        {r.metiers.map((m) => (
                          <li key={m.codeMetier}>
                            <Link to={`/metiers/${encodeURIComponent(m.codeMetier)}`}>
                              <span className="couple__code">{m.codeMetier}</span> {m.intitule}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {lignes.length === 0 && <p className="vide">Aucun résultat.</p>}
        </>
      )}
    </div>
  );
}
