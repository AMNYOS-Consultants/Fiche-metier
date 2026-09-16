import { Link, useParams } from 'react-router-dom';
import { obtenirActivite } from '@/api/activites';
import { useFetch } from '@/hooks/useFetch';
import { Loader } from '@/components/Loader';
import { ErrorMessage } from '@/components/ErrorMessage';
import type { Detail } from '@/types/api';

function ListeDetails({ details }: { details: Detail[] }) {
  if (details.length === 0) return <span className="detail">—</span>;
  return (
    <ul className="couple__details">
      {details.map((d) => (
        <li key={d.id}>{d.libelle}</li>
      ))}
    </ul>
  );
}

export function ActiviteDetailPage() {
  const { code = '' } = useParams();
  const { donnees, chargement, erreur } = useFetch(
    (signal) => obtenirActivite(code, signal),
    [code],
  );

  if (chargement) return <Loader />;
  if (erreur) return <ErrorMessage message={erreur} />;
  if (!donnees) return null;

  const a = donnees;
  const couples = a.couples ?? [];

  return (
    <article className="page fiche">
      <header className="fiche__entete">
        <span className="carte__code">{a.codeActivite}</span>
        <h1>{couples[0]?.intituleActivite ?? a.intituleActivite ?? 'Activité'}</h1>
        {(a.famille?.domaine1 || a.famille?.domaine2) && (
          <p className="fiche__famille">
            {[a.famille?.domaine1, a.famille?.domaine2].filter(Boolean).join(' · ')}
          </p>
        )}
        {/* Catégorisation libre, pas assez tranchée pour une vignette : visible seulement ici. */}
        {a.famille?.domaine3 && <p className="fiche__famille-detail">{a.famille.domaine3}</p>}
      </header>

      {(a.connaissances ?? []).length > 0 && (
        <section className="fiche__section">
          <h2>Domaines de connaissance</h2>
          <table className="tableau">
            <thead>
              <tr>
                <th scope="col">Formacode</th>
                <th scope="col">Intitulé</th>
                <th scope="col">Niveau</th>
                <th scope="col">Durée (h)</th>
              </tr>
            </thead>
            <tbody>
              {a.connaissances!.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/formacodes/${encodeURIComponent(c.codeFormacode)}`}>
                      {c.codeFormacode}
                    </Link>
                  </td>
                  <td>{c.intitule ?? c.formacode?.intitule ?? '—'}</td>
                  <td>{c.niveau}</td>
                  <td>{c.dureeHeures ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="fiche__section">
        <h2>Employée par {couples.length} métier{couples.length > 1 ? 's' : ''}</h2>
        {couples.length === 0 && <p className="vide">Aucun métier n’emploie cette activité.</p>}

        {/* Un couple par métier : la rédaction diffère d'un métier à l'autre pour
            121 des codes activité, d'où l'affichage de chaque version. */}
        {couples.map((c) => (
          <div key={c.id} className="couple">
            <header className="couple__entete">
              <span>
                {c.metier ? (
                  <Link to={`/metiers/${encodeURIComponent(c.metier.codeMetier)}`}>
                    {c.metier.intitule}
                  </Link>
                ) : (
                  c.codeMetier
                )}
              </span>
              <span className="couple__code">{c.codeMetier}</span>
            </header>

            <table className="tableau couple__table">
              <thead>
                <tr>
                  <th scope="col">{c.intituleActivite ?? 'Activité'}</th>
                  <th scope="col">{c.intituleCompetence ?? 'Compétence'}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <ListeDetails details={c.detailsActivite ?? []} />
                  </td>
                  <td>
                    <ListeDetails details={c.detailsCompetence ?? []} />
                  </td>
                </tr>
              </tbody>
            </table>

            {(c.motsCles ?? []).length > 0 && (
              <div className="couple__mots">
                <span className="couple__mots-titre">Mots clés</span>
                <ul className="badges">
                  {c.motsCles!.map((m) => (
                    <li key={m.id} className="badge">
                      {m.libelle}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </section>

      <Link to="/activites" className="lien-retour">
        ← Retour aux activités
      </Link>
    </article>
  );
}
