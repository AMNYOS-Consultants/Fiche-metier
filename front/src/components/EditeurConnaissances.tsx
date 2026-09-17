import { useState } from 'react';
import { modifierConnaissancesCouple } from '@/api/activites';
import { ApiError } from '@/api/client';
import { ErrorMessage } from '@/components/ErrorMessage';
import {
  ChampsConnaissances,
  aDesDoublons,
  versConnaissancesApi,
  type LigneConnaissance,
} from '@/components/ChampsConnaissances';

interface Props {
  codeActivite: string;
  coupleId: number;
  /** Les domaines actuels du couple, tels qu'affichés. */
  connaissances: Array<{ codeFormacode: string; intitule: string | null; niveau: number | null }>;
  onEnregistre: () => void;
  onAnnule: () => void;
}

/**
 * Édition des domaines de connaissance d'UN couple métier ↔ activité.
 *
 * Portée volontairement limitée à un couple : deux métiers qui partagent un code activité
 * portent chacun les leurs. Comme les formacodes entrent dans la comparaison des rédactions,
 * modifier ceux d'un seul métier le détache de la rédaction commune — c'est voulu, et
 * signalé à l'utilisateur.
 */
export function EditeurConnaissances({
  codeActivite,
  coupleId,
  connaissances,
  onEnregistre,
  onAnnule,
}: Props) {
  const [lignes, setLignes] = useState<LigneConnaissance[]>(
    connaissances.map((c) => ({
      codeFormacode: c.codeFormacode,
      niveau: c.niveau !== null ? String(c.niveau) : '',
    })),
  );
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function enregistrer() {
    if (aDesDoublons(lignes)) {
      setErreur('Un même formacode est saisi deux fois.');
      return;
    }

    setEnregistrement(true);
    setErreur(null);
    try {
      await modifierConnaissancesCouple(codeActivite, coupleId, versConnaissancesApi(lignes));
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

      <ChampsConnaissances lignes={lignes} onChange={setLignes} desactive={enregistrement} />

      <p className="detail">
        La durée d’acquisition n’est pas saisie ici : un domaine ajouté reprend celle du
        référentiel pour le niveau choisi. Modifier les domaines d’un seul métier le détache de
        la rédaction partagée par les autres.
      </p>

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
          {enregistrement ? 'Enregistrement…' : 'Enregistrer les domaines'}
        </button>
      </div>
    </div>
  );
}
