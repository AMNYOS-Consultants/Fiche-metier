import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SearchBar } from '@/components/SearchBar';
import { AccordionActivites } from '@/components/AccordionActivites';

export function ActivitesPage() {
  const [recherche, setRecherche] = useState('');

  return (
    <div className="page">
      <div className="fiche__entete-ligne">
        <h1>Activités &amp; compétences</h1>
        <div className="fiche__entete-boutons">
          <Link to="/activites/incoherences" className="bouton--secondaire">
            Corriger les incohérences
          </Link>
          <Link to="/activites/nouveau" className="bouton--export">
            + Créer un couple
          </Link>
        </div>
      </div>

      <div className="barre-filtres">
        <SearchBar
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher une activité ou une compétence…"
        />
      </div>

      <AccordionActivites recherche={recherche} />
    </div>
  );
}
