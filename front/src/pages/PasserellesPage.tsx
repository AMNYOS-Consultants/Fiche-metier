import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listerMetiersOptions, listerMetiersProches } from '@/api/metiers';
import { useFetch } from '@/hooks/useFetch';
import { Loader } from '@/components/Loader';
import { ErrorMessage } from '@/components/ErrorMessage';
import { PasserellesScatter } from '@/components/PasserellesScatter';
import { FiltresPasserelles } from '@/components/FiltresPasserelles';
import { ComparaisonInfobulle } from '@/components/ComparaisonInfobulle';
import type { MetierProche } from '@/types/api';

const RESULTAT_VIDE: { data: MetierProche[] } = { data: [] };

/**
 * Reproduit l'écran « Métiers passerelles » de Outil_passerelles_062026.xlsx : un métier de
 * départ, les trois paramètres du filtre (cellules K3:K5 du classeur), un nuage de points et
 * le tableau détaillé.
 */
export function PasserellesPage() {
  // Le métier de départ vit dans l'URL (`?metier=`) plutôt qu'en état local : la page devient
  // adressable, ce qui permet d'y arriver depuis « Métiers proches » d'une fiche métier.
  const [parametresUrl, setParametresUrl] = useSearchParams();
  const codeSource = parametresUrl.get('metier') ?? '';
  const setCodeSource = (code: string) =>
    // `replace` : changer de métier de départ n'empile pas d'entrée d'historique, le bouton
    // « retour » ramène donc à la page d'où l'on vient, pas à la sélection précédente.
    setParametresUrl(code ? { metier: code } : {}, { replace: true });

  const [dcMin, setDcMin] = useState(1);
  const [heuresMax, setHeuresMax] = useState(2000);
  const [degreMin, setDegreMin] = useState(0.1);
  const [memeFamille, setMemeFamille] = useState(false);
  const [afficherNoms, setAfficherNoms] = useState(false);
  const [exportEnCours, setExportEnCours] = useState(false);

  const options = useFetch((signal) => listerMetiersOptions(signal), []);
  const proches = useFetch(
    (signal) =>
      codeSource
        ? listerMetiersProches(codeSource, { dcMin, heuresMax, degreMin, limite: 350 }, signal)
        : Promise.resolve(RESULTAT_VIDE),
    [codeSource, dcMin, heuresMax, degreMin],
  );

  const metierSource = options.donnees?.data.find((m) => m.codeMetier === codeSource);
  const resultats =
    memeFamille && metierSource?.codeFamille
      ? (proches.donnees?.data ?? []).filter((m) => m.codeFamille === metierSource.codeFamille)
      : (proches.donnees?.data ?? []);

  async function exporterWord() {
    if (!metierSource) return;
    setExportEnCours(true);
    try {
      const { exporterPasserellesWord } = await import('@/utils/exportWord');
      await exporterPasserellesWord({
        metierSource,
        parametres: { dcMin, heuresMax, degreMin, memeFamille },
        resultats,
      });
    } finally {
      setExportEnCours(false);
    }
  }

  return (
    <div className="page">
      <div className="fiche__entete-ligne">
        <h1>Métiers passerelles</h1>
        <button
          type="button"
          className="bouton--export"
          onClick={exporterWord}
          disabled={!codeSource || proches.chargement || exportEnCours}
        >
          {exportEnCours ? 'Export en cours…' : 'Exporter en Word'}
        </button>
      </div>
      <p className="fiche__famille">
        Choisissez un métier de départ : les métiers ci-dessous demandent un niveau de
        formation moyen supérieur ou égal (pas de régression), dans la limite des trois
        paramètres.
      </p>

      <div className="fiche__section passerelles-parametres">
        <div className="passerelles-champ passerelles-champ--large">
          <label htmlFor="passerelles-source">Métier de départ</label>
          <select
            id="passerelles-source"
            value={codeSource}
            onChange={(e) => setCodeSource(e.target.value)}
          >
            <option value="">— Choisir —</option>
            {(options.donnees?.data ?? []).map((m) => (
              <option key={m.codeMetier} value={m.codeMetier}>
                {m.intitule} ({m.codeMetier})
              </option>
            ))}
          </select>
        </div>

        <FiltresPasserelles
          idPrefix="passerelles"
          dcMin={dcMin}
          onDcMinChange={setDcMin}
          heuresMax={heuresMax}
          onHeuresMaxChange={setHeuresMax}
          degreMin={degreMin}
          onDegreMinChange={setDegreMin}
          memeFamille={memeFamille}
          onMemeFamilleChange={setMemeFamille}
          labelFamille="Même famille que le métier de départ"
        />
      </div>

      {!codeSource && <p className="vide">Choisissez un métier de départ pour voir ses passerelles.</p>}

      {proches.erreur && <ErrorMessage message={proches.erreur} />}
      {proches.chargement && <Loader />}

      {codeSource && proches.donnees && (
        <>
          <section className="fiche__section">
            <div className="passerelles-graphique-entete">
              <h2>Durée d’acquisition en heures selon le degré d’élargissement</h2>
              <label className="passerelles-graphique-entete__case">
                <input
                  type="checkbox"
                  checked={afficherNoms}
                  onChange={(e) => setAfficherNoms(e.target.checked)}
                />
                Afficher les noms des métiers
              </label>
            </div>
            <PasserellesScatter candidats={resultats} afficherNoms={afficherNoms} />
          </section>

          <section className="fiche__section">
            <h2>{resultats.length} métier(s) passerelle(s)</h2>
            {resultats.length === 0 ? (
              <p className="vide">Aucun métier ne correspond à ces paramètres.</p>
            ) : (
              <table className="tableau">
                <thead>
                  <tr>
                    <th scope="col">Intitulé métier</th>
                    <th scope="col" className="colonne-etroite">Nb de DC communs</th>
                    <th scope="col" className="colonne-etroite">Différence heures formation</th>
                    <th scope="col" className="colonne-etroite">Degré d’élargissement</th>
                  </tr>
                </thead>
                <tbody>
                  {resultats.map((m) => (
                    <tr key={m.codeMetier}>
                      <th scope="row">
                        <ComparaisonInfobulle codeSource={codeSource} codeCible={m.codeMetier}>
                          <Link to={`/metiers/${encodeURIComponent(m.codeMetier)}`}>{m.intitule}</Link>
                        </ComparaisonInfobulle>
                      </th>
                      <td className="colonne-etroite">{m.nbDcCommuns ?? '—'}</td>
                      <td className="colonne-etroite">
                        {m.dureeAcquisitionHeures !== null ? Math.round(Number(m.dureeAcquisitionHeures)) : '—'}
                      </td>
                      <td className="colonne-etroite">
                        {m.degreElargissement !== null ? Number(m.degreElargissement).toFixed(2) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
