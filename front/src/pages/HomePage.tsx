import { useState } from 'react';
import { Link } from 'react-router-dom';
import { exporterBaseGeneraleExcel } from '@/utils/exportExcel';

const SECTIONS = [
  {
    to: '/metiers',
    titre: 'Métiers',
    texte:
      'Les fiches métier : définition, appellations, codes ROME, conditions d’exercice, compétences transversales et conditions d’accès.',
  },
  {
    to: '/activites',
    titre: 'Activités & compétences',
    texte:
      'Les couples activité-compétence, leurs tâches détaillées, niveaux de maîtrise et domaines de connaissance associés.',
  },
  {
    to: '/formacodes',
    titre: 'Domaines de connaissance',
    texte:
      'Les formacodes, leur rattachement NSF et les durées d’acquisition par niveau d’approfondissement.',
  },
];

export function HomePage() {
  const [exportEnCours, setExportEnCours] = useState(false);

  async function exporter() {
    setExportEnCours(true);
    try {
      await exporterBaseGeneraleExcel();
    } finally {
      setExportEnCours(false);
    }
  }

  return (
    <div className="accueil">
      <div className="fiche__entete-ligne">
        <h1>Base de données Fiches Métiers</h1>
        <button
          type="button"
          className="bouton--export"
          onClick={exporter}
          disabled={exportEnCours}
          title="Métiers, couples activité-compétence, domaines de connaissance, ressources transverses, conditions d’exercice et d’accès — un seul fichier .xlsx, une feuille par table."
        >
          {exportEnCours ? 'Export en cours…' : 'Exporter toute la base'}
        </button>
      </div>
      <p className="accueil__intro">
        Consultation des cartographies métiers de branche : 333 métiers, 1 360 activités et
        158 domaines de connaissance.
      </p>

      <div className="grille">
        {SECTIONS.map((s) => (
          <Link key={s.to} to={s.to} className="carte carte--lien">
            <h2 className="carte__titre">{s.titre}</h2>
            <p className="carte__definition">{s.texte}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
