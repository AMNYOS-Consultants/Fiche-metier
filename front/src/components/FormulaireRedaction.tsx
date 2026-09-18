import type { EditionModele, VarianteDetaillee } from '@/types/api';

/**
 * La rédaction en cours de saisie. Les listes sont tenues en texte multiligne (une ligne =
 * un élément) : c'est ce que la zone de texte manipule, la conversion vers le format de
 * l'API se fait à l'enregistrement (`versEditionModele`).
 */
export interface Redaction {
  intituleActivite: string;
  intituleCompetence: string;
  detailsActivite: string;
  detailsCompetence: string;
  /** Index 0..3 = niveaux 1..4 ; case vide = niveau non retenu. */
  niveaux: [string, string, string, string];
}

export function redactionDepuis(v: VarianteDetaillee): Redaction {
  const niveaux: [string, string, string, string] = ['', '', '', ''];
  for (const n of v.niveauxMaitrise) {
    if (n.niveau >= 1 && n.niveau <= 4) niveaux[n.niveau - 1] = n.description;
  }
  return {
    intituleActivite: v.intituleActivite ?? '',
    intituleCompetence: v.intituleCompetence ?? '',
    detailsActivite: v.detailsActivite.join('\n'),
    detailsCompetence: v.detailsCompetence.join('\n'),
    niveaux,
  };
}

function lignes(texte: string): string[] {
  return texte
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function versEditionModele(redaction: Redaction): EditionModele {
  return {
    intituleActivite: redaction.intituleActivite.trim() || null,
    intituleCompetence: redaction.intituleCompetence.trim() || null,
    detailsActivite: lignes(redaction.detailsActivite),
    detailsCompetence: lignes(redaction.detailsCompetence),
    niveauxMaitrise: redaction.niveaux
      .map((description, i) => ({ niveau: i + 1, description: description.trim() }))
      .filter((n) => n.description.length > 0),
  };
}

interface Props {
  redaction: Redaction;
  onChange: (redaction: Redaction) => void;
  /** Préfixe des `id` : plusieurs formulaires cohabitent sur une même page. */
  idPrefix: string;
  desactive?: boolean;
  /**
   * Masque les niveaux de maîtrise. Ils ne sont plus renseignés sur les nouvelles
   * rédactions ; on ne les montre que là où une rédaction existante en porte déjà.
   */
  sansNiveaux?: boolean;
}

/**
 * Les champs d'une rédaction : intitulés, détails et niveaux de maîtrise. Les domaines de
 * connaissance n'y sont pas — ils pendent du couple et s'éditent métier par métier
 * (`EditeurConnaissances`).
 */
export function FormulaireRedaction({
  redaction,
  onChange,
  idPrefix,
  desactive,
  sansNiveaux,
}: Props) {
  return (
    <div className="edition-couple">
      <div className="passerelles-champ">
        <label htmlFor={`${idPrefix}-ia`}>Intitulé de l’activité</label>
        <input
          id={`${idPrefix}-ia`}
          type="text"
          className="edition__texte"
          value={redaction.intituleActivite}
          disabled={desactive}
          onChange={(e) => onChange({ ...redaction, intituleActivite: e.target.value })}
        />
      </div>
      <div className="passerelles-champ">
        <label htmlFor={`${idPrefix}-ic`}>Intitulé de la compétence</label>
        <input
          id={`${idPrefix}-ic`}
          type="text"
          className="edition__texte"
          value={redaction.intituleCompetence}
          disabled={desactive}
          onChange={(e) => onChange({ ...redaction, intituleCompetence: e.target.value })}
        />
      </div>

      <div className="edition-couple__details">
        <div className="passerelles-champ">
          <label htmlFor={`${idPrefix}-da`}>Détails de l’activité (un détail par ligne)</label>
          <textarea
            id={`${idPrefix}-da`}
            className="edition__texte"
            rows={6}
            value={redaction.detailsActivite}
            disabled={desactive}
            onChange={(e) => onChange({ ...redaction, detailsActivite: e.target.value })}
          />
        </div>
        <div className="passerelles-champ">
          <label htmlFor={`${idPrefix}-dc`}>Détails de la compétence (un détail par ligne)</label>
          <textarea
            id={`${idPrefix}-dc`}
            className="edition__texte"
            rows={6}
            value={redaction.detailsCompetence}
            disabled={desactive}
            onChange={(e) => onChange({ ...redaction, detailsCompetence: e.target.value })}
          />
        </div>
      </div>

      {!sansNiveaux && (
        <div className="passerelles-champ">
          <label>Niveaux de maîtrise (laisser vide si non retenu)</label>
          <div className="edition-couple__niveaux">
            {([0, 1, 2, 3] as const).map((i) => (
              <div key={i} className="passerelles-champ">
                <label htmlFor={`${idPrefix}-nm-${i}`} className="detail">
                  Niveau {i + 1}
                </label>
                <textarea
                  id={`${idPrefix}-nm-${i}`}
                  className="edition__texte"
                  rows={2}
                  value={redaction.niveaux[i]}
                  disabled={desactive}
                  onChange={(e) => {
                    const niveaux = [...redaction.niveaux] as Redaction['niveaux'];
                    niveaux[i] = e.target.value;
                    onChange({ ...redaction, niveaux });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
