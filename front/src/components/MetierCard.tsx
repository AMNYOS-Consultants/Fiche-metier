import { Link } from 'react-router-dom';
import type { Metier } from '@/types/api';
import { libelleFamille } from '@/utils/format';

export function MetierCard({ metier }: { metier: Metier }) {
  const appellations = metier.appellations ?? [];
  const dossier = metier.dossierSource?.libelle ?? metier.dossierAutre;

  return (
    <article className="carte">
      <header className="carte__entete">
        <Link to={`/metiers/${encodeURIComponent(metier.codeMetier)}`} className="carte__titre">
          {metier.intitule}
        </Link>
        <span className="carte__code">{metier.codeMetier}</span>
      </header>

      {dossier && (
        <ul className="badges">
          <li className="badge badge--dossier">{dossier}</li>
        </ul>
      )}

      {metier.famille && <p className="carte__famille">{libelleFamille(metier.famille)}</p>}

      {metier.definition && <p className="carte__definition">{metier.definition}</p>}

      {appellations.length > 0 && (
        <ul className="badges">
          {appellations.slice(0, 4).map((a) => (
            <li key={a.id} className="badge">
              {a.appellation}
            </li>
          ))}
          {appellations.length > 4 && <li className="badge">+{appellations.length - 4}</li>}
        </ul>
      )}
    </article>
  );
}
