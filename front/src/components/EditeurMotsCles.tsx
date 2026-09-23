import { useState } from 'react';
import { modifierMotsClesCouple } from '@/api/activites';
import { ApiError } from '@/api/client';
import { ErrorMessage } from '@/components/ErrorMessage';

const MAX_MOTS_CLES = 10;

interface Props {
  codeActivite: string;
  coupleId: number;
  motsCles: string[];
  onEnregistre: () => void;
  onAnnule: () => void;
}

/**
 * Édition des mots-clés d'UN couple métier ↔ activité — texte libre, pas une liste fermée
 * comme les domaines de connaissance. Même portée volontairement limitée à un couple :
 * deux métiers qui partagent un code activité peuvent porter des mots-clés différents (ils
 * sont exclus de la comparaison des rédactions, voir `incoherence.service.ts`).
 */
export function EditeurMotsCles({ codeActivite, coupleId, motsCles, onEnregistre, onAnnule }: Props) {
  const [lignes, setLignes] = useState<string[]>(motsCles.length > 0 ? motsCles : ['']);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  function modifier(index: number, valeur: string) {
    setLignes(lignes.map((l, i) => (i === index ? valeur : l)));
  }

  async function enregistrer() {
    const valeurs = lignes.map((l) => l.trim()).filter((l) => l !== '');
    if (new Set(valeurs).size !== valeurs.length) {
      setErreur('Un même mot-clé est saisi deux fois.');
      return;
    }

    setEnregistrement(true);
    setErreur(null);
    try {
      await modifierMotsClesCouple(codeActivite, coupleId, valeurs);
      onEnregistre();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Enregistrement impossible');
    } finally {
      setEnregistrement(false);
    }
  }

  return (
    <div className="editeur-dc">
      {erreur && <ErrorMessage message={erreur} />}

      <div className="liste-edition">
        {lignes.map((ligne, index) => (
          <div key={index} className="liste-edition__ligne">
            <input
              type="text"
              className="edition__texte"
              placeholder="Mot-clé"
              maxLength={150}
              value={ligne}
              disabled={enregistrement}
              onChange={(e) => modifier(index, e.target.value)}
            />
            <button
              type="button"
              className="bouton--retirer-ligne"
              onClick={() => setLignes(lignes.filter((_, i) => i !== index))}
              disabled={enregistrement}
            >
              Retirer
            </button>
          </div>
        ))}
      </div>

      {lignes.length < MAX_MOTS_CLES && (
        <button
          type="button"
          className="bouton--secondaire"
          onClick={() => setLignes([...lignes, ''])}
          disabled={enregistrement}
        >
          + Ajouter un mot-clé
        </button>
      )}

      <div className="fiche__entete-boutons">
        <button
          type="button"
          className="bouton--secondaire"
          onClick={onAnnule}
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
          {enregistrement ? 'Enregistrement…' : 'Enregistrer les mots-clés'}
        </button>
      </div>
    </div>
  );
}
