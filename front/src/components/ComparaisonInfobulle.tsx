import { useRef, useState } from 'react';
import { comparerMetiers } from '@/api/metiers';
import type { ComparaisonMetiers } from '@/types/api';

const DELAI_AVANT_CHARGEMENT_MS = 250;

interface Etat {
  chargement: boolean;
  erreur: string | null;
  donnees: ComparaisonMetiers | null;
}

const ETAT_INITIAL: Etat = { chargement: false, erreur: null, donnees: null };

/**
 * Survol du nom d'un métier passerelle : une infobulle détaille, formacode par formacode,
 * ce qui est déjà couvert par le métier de départ et ce qu'il faudrait acquérir en plus —
 * le détail derrière les colonnes « Nb de DC communs » / « Différence heures formation »
 * du tableau. Chargé à la demande, une seule fois par ligne (le `codeCible` d'une instance
 * ne change jamais : un simple drapeau suffit, pas besoin d'un cache par clé).
 */
export function ComparaisonInfobulle({
  codeSource,
  codeCible,
  children,
}: {
  codeSource: string;
  codeCible: string;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [etat, setEtat] = useState<Etat>(ETAT_INITIAL);
  const dejaChargee = useRef(false);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

  function ouvrir() {
    setVisible(true);
    if (dejaChargee.current) return;

    minuteur.current = setTimeout(async () => {
      dejaChargee.current = true;
      setEtat({ chargement: true, erreur: null, donnees: null });
      try {
        const donnees = await comparerMetiers(codeSource, codeCible);
        setEtat({ chargement: false, erreur: null, donnees });
      } catch {
        setEtat({ chargement: false, erreur: 'Comparaison indisponible', donnees: null });
      }
    }, DELAI_AVANT_CHARGEMENT_MS);
  }

  function fermer() {
    setVisible(false);
    if (minuteur.current) clearTimeout(minuteur.current);
  }

  const communs = etat.donnees?.ecarts.filter((e) => e.niveauSource !== null) ?? [];
  const aAcquerir = etat.donnees?.ecarts.filter((e) => e.niveauSource === null) ?? [];

  return (
    <div
      className="comparaison-infobulle"
      onMouseEnter={ouvrir}
      onMouseLeave={fermer}
      onFocus={ouvrir}
      onBlur={fermer}
    >
      {children}
      {visible && (
        <div className="comparaison-infobulle__panneau" role="tooltip">
          {etat.chargement && <p className="detail">Chargement…</p>}
          {etat.erreur && <p className="detail">{etat.erreur}</p>}
          {etat.donnees && (
            <>
              <TableauEcarts
                titre={`Formacodes en commun (${communs.length})`}
                lignes={communs}
                vide="Aucun domaine de connaissance en commun."
              />
              <TableauEcarts
                titre={`À acquérir pour cette passerelle (${aAcquerir.length})`}
                lignes={aAcquerir}
                vide="Rien à acquérir : tout est déjà couvert."
                afficherHeures
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TableauEcarts({
  titre,
  lignes,
  vide,
  afficherHeures = false,
}: {
  titre: string;
  lignes: ComparaisonMetiers['ecarts'];
  vide: string;
  afficherHeures?: boolean;
}) {
  return (
    <div className="comparaison-infobulle__groupe">
      <p className="comparaison-infobulle__titre">{titre}</p>
      {lignes.length === 0 ? (
        <p className="detail">{vide}</p>
      ) : (
        <table className="tableau comparaison-infobulle__tableau">
          <thead>
            <tr>
              <th>Formacode</th>
              <th>Intitulé</th>
              <th className="colonne-etroite">Niveau</th>
              {afficherHeures && <th className="colonne-etroite">Heures</th>}
            </tr>
          </thead>
          <tbody>
            {lignes.map((e) => (
              <tr key={e.codeFormacode}>
                <td>{e.codeFormacode}</td>
                <td>{e.intitule}</td>
                <td className="colonne-etroite">{e.niveauCible ?? '—'}</td>
                {afficherHeures && (
                  <td className="colonne-etroite">
                    {e.heuresAcquerir !== null ? Math.round(Number(e.heuresAcquerir)) : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
