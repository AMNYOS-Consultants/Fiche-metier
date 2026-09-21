import { useRef, useState } from 'react';
import { verifierImportGeneral, appliquerImportGeneral } from '@/api/import';
import { recalculerProximites } from '@/api/metiers';
import { ApiError } from '@/api/client';
import type { RapportImport } from '@/types/importGeneral';

type Etape =
  | { nom: 'fermee' }
  | { nom: 'verification'; fichier: File }
  | { nom: 'rapport'; fichier: File; rapport: RapportImport }
  | { nom: 'application'; fichier: File }
  | { nom: 'resultat'; rapport: RapportImport }
  | { nom: 'erreur'; message: string };

const LIMITE_ANOMALIES_AFFICHEES = 30;
const LIMITE_EXEMPLES = 3;

function messageErreur(err: unknown): string {
  return err instanceof ApiError ? err.message : 'La requête a échoué.';
}

function localiser(a: { feuille?: string; ligne?: number; colonne?: string }): string {
  const morceaux = [a.feuille, a.ligne ? `ligne ${a.ligne}` : null, a.colonne].filter(Boolean);
  return morceaux.length > 0 ? morceaux.join(' — ') : 'Classeur';
}

/**
 * Import du classeur d'échange, en deux temps visibles à l'écran : une vérification qui
 * n'écrit rien et détaille ce qui serait fait, puis — seulement si l'utilisateur confirme
 * — l'application. L'appui sur « Importer » ne déclenche jamais directement une écriture.
 *
 * L'import **synchronise** : une ligne absente du fichier est supprimée en base. Le
 * rapport de vérification est donc la seule protection contre un fichier périmé ou mal
 * édité — la confirmation le rappelle explicitement dès qu'une suppression est en jeu.
 */
export function ImportGeneral() {
  const [etape, setEtape] = useState<Etape>({ nom: 'fermee' });
  const [recalculEnCours, setRecalculEnCours] = useState(false);
  const [recalculFait, setRecalculFait] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function ouvrirSelecteur() {
    inputRef.current?.click();
  }

  async function fichierChoisi(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    e.target.value = ''; // permet de resélectionner le même fichier après une fermeture
    if (!fichier) return;

    setRecalculFait(false);
    setEtape({ nom: 'verification', fichier });
    try {
      const rapport = await verifierImportGeneral(fichier);
      setEtape({ nom: 'rapport', fichier, rapport });
    } catch (err) {
      setEtape({ nom: 'erreur', message: messageErreur(err) });
    }
  }

  async function confirmer() {
    if (etape.nom !== 'rapport') return;
    const { fichier } = etape;
    setEtape({ nom: 'application', fichier });
    try {
      const rapport = await appliquerImportGeneral(fichier);
      if (!rapport.applique) {
        // Le fichier était valide à la vérification mais ne l'est plus : la base a changé
        // entre les deux appels. On revient au rapport, avec les anomalies à jour.
        setEtape({ nom: 'rapport', fichier, rapport });
        return;
      }
      setEtape({ nom: 'resultat', rapport });
    } catch (err) {
      setEtape({ nom: 'erreur', message: messageErreur(err) });
    }
  }

  async function recalculer() {
    setRecalculEnCours(true);
    try {
      await recalculerProximites();
      setRecalculFait(true);
    } catch {
      // Le recalcul reste accessible depuis chaque fiche métier ; pas de blocage ici.
    } finally {
      setRecalculEnCours(false);
    }
  }

  function fermer() {
    setEtape({ nom: 'fermee' });
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        onChange={fichierChoisi}
        hidden
      />
      <button type="button" className="bouton--secondaire" onClick={ouvrirSelecteur}>
        Importer une base…
      </button>

      {etape.nom !== 'fermee' && (
        <div className="modale-fond" role="presentation" onClick={etape.nom === 'rapport' || etape.nom === 'resultat' || etape.nom === 'erreur' ? fermer : undefined}>
          <div
            className="modale"
            role="dialog"
            aria-modal="true"
            aria-label="Import de la base"
            onClick={(e) => e.stopPropagation()}
          >
            {etape.nom === 'verification' && (
              <div className="modale__corps">
                <p className="loader" role="status" aria-live="polite">
                  <span className="loader__spinner" aria-hidden="true" />
                  Analyse du fichier « {etape.fichier.name} »…
                </p>
              </div>
            )}

            {etape.nom === 'application' && (
              <div className="modale__corps">
                <p className="loader" role="status" aria-live="polite">
                  <span className="loader__spinner" aria-hidden="true" />
                  Application de l’import…
                </p>
              </div>
            )}

            {etape.nom === 'erreur' && (
              <>
                <h2 className="modale__titre">Import impossible</h2>
                <div className="modale__corps">
                  <div className="erreur" role="alert">
                    <strong>Erreur</strong>
                    <p>{etape.message}</p>
                  </div>
                </div>
                <div className="modale__pied">
                  <button type="button" className="bouton--secondaire" onClick={fermer}>
                    Fermer
                  </button>
                </div>
              </>
            )}

            {etape.nom === 'rapport' && <RapportEcran rapport={etape.rapport} onAnnuler={fermer} onConfirmer={confirmer} />}

            {etape.nom === 'resultat' && (
              <>
                <h2 className="modale__titre">Import appliqué</h2>
                <div className="modale__corps">
                  <p>
                    {etape.rapport.totaux.ajouts} ajout{etape.rapport.totaux.ajouts > 1 ? 's' : ''},{' '}
                    {etape.rapport.totaux.modifications} modification
                    {etape.rapport.totaux.modifications > 1 ? 's' : ''} et{' '}
                    {etape.rapport.totaux.suppressions} suppression
                    {etape.rapport.totaux.suppressions > 1 ? 's' : ''} appliqué
                    {etape.rapport.totaux.ajouts + etape.rapport.totaux.modifications + etape.rapport.totaux.suppressions > 1 ? 's' : ''}.
                  </p>
                  {etape.rapport.metiersARecalculer > 0 && (
                    <div className="import-general__recalcul">
                      <p className="detail">
                        {etape.rapport.metiersARecalculer} métier
                        {etape.rapport.metiersARecalculer > 1 ? 's ont' : ' a'} une donnée
                        entrant dans le calcul des passerelles qui a changé. Les passerelles
                        affichées resteront basées sur l’ancien calcul tant qu’il n’est pas
                        rejoué.
                      </p>
                      {recalculFait ? (
                        <p className="detail">Passerelles recalculées.</p>
                      ) : (
                        <button
                          type="button"
                          className="bouton--secondaire"
                          onClick={recalculer}
                          disabled={recalculEnCours}
                        >
                          {recalculEnCours ? 'Recalcul en cours…' : 'Recalculer les passerelles maintenant'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="modale__pied">
                  <button type="button" className="bouton--export" onClick={fermer}>
                    Fermer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function RapportEcran({
  rapport,
  onAnnuler,
  onConfirmer,
}: {
  rapport: RapportImport;
  onAnnuler: () => void;
  onConfirmer: () => void;
}) {
  const bloquant = rapport.anomalies.length > 0;
  const tablesTouchees = rapport.tables.filter(
    (t) => t.ajouts > 0 || t.modifications > 0 || t.suppressions > 0,
  );

  return (
    <>
      <h2 className="modale__titre">{bloquant ? 'Fichier invalide' : 'Vérifier l’import avant de l’appliquer'}</h2>
      <div className="modale__corps">
        {rapport.meta.versionSchemaFichier &&
          rapport.meta.versionSchemaBase &&
          rapport.meta.versionSchemaFichier !== rapport.meta.versionSchemaBase && (
            <p className="import-general__avertissement">
              Ce fichier a été exporté sur une version différente du schéma de cette base
              ({rapport.meta.versionSchemaFichier} contre {rapport.meta.versionSchemaBase}).
            </p>
          )}
        {rapport.avertissements.map((a, i) => (
          <p key={i} className="import-general__avertissement">
            {a}
          </p>
        ))}

        {bloquant ? (
          <>
            <p>
              {rapport.anomalies.length} anomalie{rapport.anomalies.length > 1 ? 's' : ''} empêche
              {rapport.anomalies.length > 1 ? 'nt' : ''} l’import. Corrigez le classeur et
              réessayez.
            </p>
            <ul className="import-general__anomalies">
              {rapport.anomalies.slice(0, LIMITE_ANOMALIES_AFFICHEES).map((a, i) => (
                <li key={i}>
                  <strong>{localiser(a)}</strong> — {a.message}
                </li>
              ))}
            </ul>
            {rapport.anomalies.length > LIMITE_ANOMALIES_AFFICHEES && (
              <p className="detail">
                et {rapport.anomalies.length - LIMITE_ANOMALIES_AFFICHEES} anomalie
                {rapport.anomalies.length - LIMITE_ANOMALIES_AFFICHEES > 1 ? 's' : ''} de plus.
              </p>
            )}
          </>
        ) : tablesTouchees.length === 0 ? (
          <p>Ce fichier est identique à la base actuelle : rien à importer.</p>
        ) : (
          <>
            {rapport.totaux.suppressions > 0 && (
              <p className="import-general__avertissement">
                <strong>{rapport.totaux.suppressions} ligne{rapport.totaux.suppressions > 1 ? 's' : ''} seront supprimée{rapport.totaux.suppressions > 1 ? 's' : ''}</strong> —
                elles sont en base mais absentes de ce fichier. L’import remplace le contenu
                de la base par celui de ce classeur.
              </p>
            )}
            <table className="import-general__tableau">
              <thead>
                <tr>
                  <th>Feuille</th>
                  <th>Ajouts</th>
                  <th>Modifications</th>
                  <th>Suppressions</th>
                </tr>
              </thead>
              <tbody>
                {tablesTouchees.map((t) => (
                  <tr key={t.cle}>
                    <td>{t.feuille}</td>
                    <td className={t.ajouts > 0 ? 'import-general__nb--ajout' : ''}>{t.ajouts || '—'}</td>
                    <td className={t.modifications > 0 ? 'import-general__nb--modif' : ''}>
                      {t.modifications || '—'}
                    </td>
                    <td className={t.suppressions > 0 ? 'import-general__nb--suppr' : ''}>
                      {t.suppressions || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <details className="import-general__exemples">
              <summary>Voir quelques exemples</summary>
              {tablesTouchees.map((t) => (
                <div key={t.cle}>
                  {t.exemples.ajouts.length > 0 && (
                    <p>
                      <strong>{t.feuille}</strong> — ajouts : {t.exemples.ajouts.slice(0, LIMITE_EXEMPLES).join(', ')}
                      {t.ajouts > LIMITE_EXEMPLES ? '…' : ''}
                    </p>
                  )}
                  {t.exemples.modifications.length > 0 && (
                    <p>
                      <strong>{t.feuille}</strong> — modifications :{' '}
                      {t.exemples.modifications.slice(0, LIMITE_EXEMPLES).join(', ')}
                      {t.modifications > LIMITE_EXEMPLES ? '…' : ''}
                    </p>
                  )}
                  {t.exemples.suppressions.length > 0 && (
                    <p>
                      <strong>{t.feuille}</strong> — suppressions :{' '}
                      {t.exemples.suppressions.slice(0, LIMITE_EXEMPLES).join(', ')}
                      {t.suppressions > LIMITE_EXEMPLES ? '…' : ''}
                    </p>
                  )}
                </div>
              ))}
            </details>
          </>
        )}
      </div>
      <div className="modale__pied">
        <button type="button" className="bouton--secondaire" onClick={onAnnuler}>
          Annuler
        </button>
        {!bloquant && tablesTouchees.length > 0 && (
          <button type="button" className="bouton--export" onClick={onConfirmer}>
            Confirmer l’import
          </button>
        )}
      </div>
    </>
  );
}
