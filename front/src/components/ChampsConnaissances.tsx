import { listerFormacodes } from '@/api/activites';
import { useFetch } from '@/hooks/useFetch';

export interface LigneConnaissance {
  codeFormacode: string;
  /** Chaîne vide = niveau non renseigné. */
  niveau: string;
}

export const MAX_CONNAISSANCES = 20;

interface Props {
  lignes: LigneConnaissance[];
  onChange: (lignes: LigneConnaissance[]) => void;
  desactive?: boolean;
}

/**
 * Les lignes (domaine, niveau) d'un couple, en saisie pure : le composant ne connaît ni
 * l'enregistrement ni le couple visé. Partagé par l'édition d'un couple existant
 * (`EditeurConnaissances`) et la création d'un nouveau couple.
 */
export function ChampsConnaissances({ lignes, onChange, desactive }: Props) {
  // 194 formacodes : un select suffit, comme pour les codes ROME de la fiche métier.
  const formacodes = useFetch((signal) => listerFormacodes({ limit: 200 }, signal), []);
  const options = formacodes.donnees?.data ?? [];

  function modifier(index: number, champs: Partial<LigneConnaissance>) {
    onChange(lignes.map((l, i) => (i === index ? { ...l, ...champs } : l)));
  }

  return (
    <>
      <div className="liste-edition">
        {lignes.map((ligne, index) => (
          <div key={index} className="liste-edition__ligne">
            <select
              className="filtre__select"
              value={ligne.codeFormacode}
              disabled={desactive}
              onChange={(e) => modifier(index, { codeFormacode: e.target.value })}
            >
              <option value="">— choisir un domaine —</option>
              {options.map((f) => (
                <option key={f.codeFormacode} value={f.codeFormacode}>
                  {f.codeFormacode} — {f.intitule}
                </option>
              ))}
            </select>
            <select
              className="filtre__select editeur-dc__niveau"
              value={ligne.niveau}
              disabled={desactive}
              onChange={(e) => modifier(index, { niveau: e.target.value })}
            >
              <option value="">Niveau —</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  Niveau {n}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="bouton--retirer-ligne"
              onClick={() => onChange(lignes.filter((_, i) => i !== index))}
              disabled={desactive}
            >
              Retirer
            </button>
          </div>
        ))}
      </div>

      {lignes.length < MAX_CONNAISSANCES && (
        <button
          type="button"
          className="bouton--secondaire"
          onClick={() => onChange([...lignes, { codeFormacode: '', niveau: '' }])}
          disabled={desactive}
        >
          + Ajouter un domaine
        </button>
      )}
    </>
  );
}

/** Les lignes réellement renseignées, au format attendu par l'API. */
export function versConnaissancesApi(lignes: LigneConnaissance[]) {
  return lignes
    .filter((l) => l.codeFormacode !== '')
    .map((l) => ({
      codeFormacode: l.codeFormacode,
      niveau: l.niveau === '' ? null : Number(l.niveau),
    }));
}

/** Vrai si un même domaine est saisi deux fois — la contrainte (couple, formacode) l'interdit. */
export function aDesDoublons(lignes: LigneConnaissance[]): boolean {
  const codes = lignes.filter((l) => l.codeFormacode !== '').map((l) => l.codeFormacode);
  return new Set(codes).size !== codes.length;
}
