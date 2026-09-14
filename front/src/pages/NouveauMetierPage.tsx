import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { listerMetiersOptions, creerMetier } from '@/api/metiers';
import { obtenirReferentiels } from '@/api/activites';
import { ApiError } from '@/api/client';
import { useFetch } from '@/hooks/useFetch';
import { Loader } from '@/components/Loader';
import { ErrorMessage } from '@/components/ErrorMessage';
import { libelleFamille } from '@/utils/format';

/** Plus haut numéro déjà utilisé, tous préfixes confondus — la numérotation est globale
 * et porte des trous historiques (332 métiers en base, mais le numéro 333 déjà pris) :
 * seul MAX + 1 garantit un code libre, `COUNT + 1` collisionnerait. */
function prochainNumero(codesMetier: string[]): number {
  let max = 0;
  for (const code of codesMetier) {
    const n = Number(code.slice(1));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export function NouveauMetierPage() {
  const navigate = useNavigate();
  const [rechargerOptions, setRechargerOptions] = useState(0);
  const referentiels = useFetch((signal) => obtenirReferentiels(signal), []);
  const options = useFetch((signal) => listerMetiersOptions(signal), [rechargerOptions]);

  const [codeFamille, setCodeFamille] = useState('');
  const [intitule, setIntitule] = useState('');
  const [definition, setDefinition] = useState('');
  const [dossierSourceId, setDossierSourceId] = useState('');
  const [dossierAutre, setDossierAutre] = useState('');
  const [redacteur, setRedacteur] = useState('');
  const [responsTransverse, setResponsTransverse] = useState<'' | 'oui' | 'non'>('');
  const [interfaceAmontAval, setInterfaceAmontAval] = useState('');
  const [creationEnCours, setCreationEnCours] = useState(false);
  const [erreurCreation, setErreurCreation] = useState<string | null>(null);

  const codesConnus = useMemo(() => (options.donnees?.data ?? []).map((o) => o.codeMetier), [options.donnees]);
  const numero = useMemo(() => prochainNumero(codesConnus), [codesConnus]);
  const codePreview = codeFamille ? `${codeFamille}${numero}` : null;

  async function creer() {
    if (!codeFamille || !intitule.trim()) {
      setErreurCreation('La famille et l’intitulé sont obligatoires.');
      return;
    }

    setCreationEnCours(true);
    setErreurCreation(null);
    try {
      const metier = await creerMetier({
        codeFamille,
        totalAttendu: codesConnus.length,
        intitule: intitule.trim(),
        definition: definition.trim() || null,
        dossierSourceId: dossierSourceId ? Number(dossierSourceId) : null,
        dossierAutre: dossierAutre.trim() || null,
        redacteur: redacteur.trim() || null,
        responsTransverse: responsTransverse || null,
        interfaceAmontAval: interfaceAmontAval || null,
      });
      navigate(`/metiers/${encodeURIComponent(metier.codeMetier)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Le catalogue a changé entre-temps : on rafraîchit la liste pour que le prochain
        // essai reparte d'un numéro et d'un total à jour, sans recharger toute la page.
        setRechargerOptions((v) => v + 1);
      }
      setErreurCreation(err instanceof ApiError ? err.message : 'Création impossible');
    } finally {
      setCreationEnCours(false);
    }
  }

  return (
    <div className="page">
      <div className="fiche__entete-ligne">
        <h1>Nouvelle fiche métier</h1>
      </div>

      {(referentiels.chargement || options.chargement) && <Loader />}
      {referentiels.erreur && <ErrorMessage message={referentiels.erreur} />}
      {options.erreur && <ErrorMessage message={options.erreur} />}

      {referentiels.donnees && options.donnees && (
        <div className="fiche__section nouveau-metier">
          {erreurCreation && <ErrorMessage message={erreurCreation} />}

          <div className="passerelles-parametres">
            <div className="passerelles-champ">
              <label htmlFor="nouveau-famille">Famille</label>
              <select
                id="nouveau-famille"
                value={codeFamille}
                disabled={creationEnCours}
                onChange={(e) => setCodeFamille(e.target.value)}
              >
                <option value="">— Choisir —</option>
                {referentiels.donnees.famillesMetier.map((f) => (
                  <option key={f.codeFamille} value={f.codeFamille}>
                    {libelleFamille(f)}
                  </option>
                ))}
              </select>
            </div>
            <div className="passerelles-champ passerelles-champ--large">
              <label htmlFor="nouveau-intitule">Intitulé</label>
              <input
                id="nouveau-intitule"
                type="text"
                maxLength={255}
                value={intitule}
                disabled={creationEnCours}
                onChange={(e) => setIntitule(e.target.value)}
              />
            </div>
          </div>

          <p className="detail">
            {codePreview
              ? `Code qui sera attribué : ${codePreview} (vérifié à nouveau au moment de la création, au cas où une autre fiche aurait été créée entre-temps).`
              : 'Choisissez une famille pour voir le code qui sera attribué.'}
          </p>

          <div className="passerelles-champ passerelles-champ--large">
            <label htmlFor="nouveau-definition">Définition</label>
            <textarea
              id="nouveau-definition"
              rows={4}
              value={definition}
              disabled={creationEnCours}
              onChange={(e) => setDefinition(e.target.value)}
            />
          </div>

          <div className="passerelles-parametres">
            <div className="passerelles-champ">
              <label htmlFor="nouveau-dossier">Dossier source</label>
              <select
                id="nouveau-dossier"
                value={dossierSourceId}
                disabled={creationEnCours}
                onChange={(e) => setDossierSourceId(e.target.value)}
              >
                <option value="">—</option>
                {referentiels.donnees.dossiersSource.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.libelle}
                  </option>
                ))}
              </select>
            </div>
            <div className="passerelles-champ">
              <label htmlFor="nouveau-dossier-autre">Dossier (si absent de la liste)</label>
              <input
                id="nouveau-dossier-autre"
                type="text"
                maxLength={255}
                value={dossierAutre}
                disabled={creationEnCours}
                onChange={(e) => setDossierAutre(e.target.value)}
              />
            </div>
            <div className="passerelles-champ">
              <label htmlFor="nouveau-redacteur">Rédacteur</label>
              <input
                id="nouveau-redacteur"
                type="text"
                maxLength={100}
                value={redacteur}
                disabled={creationEnCours}
                onChange={(e) => setRedacteur(e.target.value)}
              />
            </div>
          </div>

          <div className="passerelles-parametres">
            <div className="passerelles-champ">
              <label htmlFor="nouveau-responsabilites">Responsabilités transversales</label>
              <select
                id="nouveau-responsabilites"
                value={responsTransverse}
                disabled={creationEnCours}
                onChange={(e) => setResponsTransverse(e.target.value as '' | 'oui' | 'non')}
              >
                <option value="">Non renseigné</option>
                <option value="oui">Oui</option>
                <option value="non">Non</option>
              </select>
            </div>
            <div className="passerelles-champ">
              <label htmlFor="nouveau-interface">Interface amont/aval</label>
              <select
                id="nouveau-interface"
                value={interfaceAmontAval}
                disabled={creationEnCours}
                onChange={(e) => setInterfaceAmontAval(e.target.value)}
              >
                <option value="">Non renseigné</option>
                <option value="Non">Non</option>
                <option value="Oui, en amont OU aval">Oui, en amont OU aval</option>
                <option value="Oui, en amont ET aval">Oui, en amont ET aval</option>
              </select>
            </div>
          </div>

          <p className="detail">
            Les couples activité-compétence, appellations, codes ROME, conditions d’exercice
            et d’accès, et ressources transverses se complètent ensuite depuis la fiche,
            une fois créée.
          </p>

          <div className="fiche__entete-boutons">
            <Link to="/metiers" className="bouton--secondaire">
              Annuler
            </Link>
            <button type="button" className="bouton--export" onClick={creer} disabled={creationEnCours}>
              {creationEnCours ? 'Création…' : 'Créer la fiche'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
