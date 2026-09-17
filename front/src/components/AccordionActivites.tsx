import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listerActivites, listerFamillesActivite } from '@/api/activites';
import { useFetch } from '@/hooks/useFetch';
import { Loader } from '@/components/Loader';
import { ErrorMessage } from '@/components/ErrorMessage';
import type { Activite, FamilleActiviteComptee } from '@/types/api';

/** Plafond de l'API (`LIMIT_MAX`, middlewares/pagination.ts) ; la plus grosse famille en porte 117. */
const LIMITE = 200;

interface NoeudFamille {
  code: string;
  sousCode: string;
  domaine2: string;
  nb: number;
}

interface NoeudLettre {
  lettre: string;
  domaine1: string;
  nb: number;
  familles: NoeudFamille[];
}

function nouveauNoeudLettre(lettre: string, domaine1: string | null): NoeudLettre {
  return { lettre, domaine1: domaine1 ?? '—', nb: 0, familles: [] };
}

function trier(arbre: NoeudLettre[]): NoeudLettre[] {
  arbre.sort((a, b) => a.lettre.localeCompare(b.lettre, 'fr'));
  for (const noeud of arbre) noeud.familles.sort((a, b) => a.sousCode.localeCompare(b.sousCode));
  return arbre;
}

/** Arborescence de navigation : une lettre (domaine 1) -> ses familles à deux chiffres (domaine 2). */
function construireArbre(familles: FamilleActiviteComptee[]): NoeudLettre[] {
  const parLettre = new Map<string, NoeudLettre>();

  for (const f of familles) {
    const [lettre, sousCode] = f.codeFamilleActivite.split('.');
    if (!lettre || !sousCode) continue;

    let noeud = parLettre.get(lettre);
    if (!noeud) {
      noeud = nouveauNoeudLettre(lettre, f.domaine1);
      parLettre.set(lettre, noeud);
    }
    noeud.nb += f.nbActivites;
    noeud.familles.push({
      code: f.codeFamilleActivite,
      sousCode,
      domaine2: f.domaine2 ?? '—',
      nb: f.nbActivites,
    });
  }

  return trier([...parLettre.values()]);
}

/**
 * Même arborescence, mais construite depuis des résultats de recherche : seules les
 * familles qui portent une correspondance apparaissent, et les couples sont déjà là (pas
 * de chargement à l'ouverture).
 */
function construireArbreRecherche(resultats: Activite[]): {
  arbre: NoeudLettre[];
  couples: Record<string, Activite[]>;
} {
  const parLettre = new Map<string, NoeudLettre>();
  const parFamille = new Map<string, NoeudFamille>();
  const couples: Record<string, Activite[]> = {};

  for (const activite of resultats) {
    const code = activite.codeFamilleActivite;
    if (!code) continue;
    const [lettre, sousCode] = code.split('.');
    if (!lettre || !sousCode) continue;

    let noeud = parLettre.get(lettre);
    if (!noeud) {
      noeud = nouveauNoeudLettre(lettre, activite.famille?.domaine1 ?? null);
      parLettre.set(lettre, noeud);
    }

    let famille = parFamille.get(code);
    if (!famille) {
      famille = { code, sousCode, domaine2: activite.famille?.domaine2 ?? '—', nb: 0 };
      parFamille.set(code, famille);
      noeud.familles.push(famille);
      couples[code] = [];
    }

    famille.nb += 1;
    noeud.nb += 1;
    couples[code].push(activite);
  }

  return { arbre: trier([...parLettre.values()]), couples };
}

function TableauCouples({ couples }: { couples: Activite[] }) {
  return (
    <table className="tableau tableau--couples">
      <thead>
        <tr>
          <th>Code</th>
          <th>Activité</th>
          <th>Compétence</th>
        </tr>
      </thead>
      <tbody>
        {couples.map((a) => (
          <tr key={a.codeActivite}>
            <td>
              <Link to={`/activites/${encodeURIComponent(a.codeActivite)}`}>{a.codeActivite}</Link>
            </td>
            <td>{a.intituleActivite}</td>
            <td>{a.intituleCompetence ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Props {
  /** Recherche texte : vide = navigation libre dans l'arborescence complète. */
  recherche: string;
}

/**
 * La page « Activités & compétences » en un seul bloc : l'arborescence de la nomenclature
 * (« B — Conception » puis « B.01 — Elaboration ») déplie directement la liste des couples
 * de la famille, chargée à la demande. Un seul niveau ouvert à la fois de chaque côté,
 * sinon la page devient interminable (1 350 couples au total).
 */
export function AccordionActivites({ recherche }: Props) {
  const familles = useFetch((signal) => listerFamillesActivite(signal), []);
  const resultats = useFetch(
    (signal) =>
      recherche
        ? listerActivites({ search: recherche, limit: LIMITE }, signal)
        : Promise.resolve(null),
    [recherche],
  );

  const [lettreOuverte, setLettreOuverte] = useState<string | null>(null);
  const [familleOuverte, setFamilleOuverte] = useState<string | null>(null);
  /** Couples déjà chargés, par code famille — évite de recharger à chaque ouverture. */
  const [couplesCharges, setCouplesCharges] = useState<Record<string, Activite[]>>({});
  const [familleEnChargement, setFamilleEnChargement] = useState<string | null>(null);
  const [erreurCouples, setErreurCouples] = useState<string | null>(null);

  const recherchePayload = resultats.donnees;
  const enRecherche = recherche !== '';

  const { arbre, couples } = useMemo(() => {
    if (enRecherche) {
      if (!recherchePayload) return { arbre: [] as NoeudLettre[], couples: {} };
      return construireArbreRecherche(recherchePayload.data);
    }
    return {
      arbre: construireArbre(familles.donnees?.data ?? []),
      couples: couplesCharges,
    };
  }, [enRecherche, recherchePayload, familles.donnees, couplesCharges]);

  async function basculerFamille(code: string) {
    if (familleOuverte === code) {
      setFamilleOuverte(null);
      return;
    }
    setFamilleOuverte(code);
    setErreurCouples(null);
    if (enRecherche || couplesCharges[code]) return;

    setFamilleEnChargement(code);
    try {
      const reponse = await listerActivites({ famille: code, limit: LIMITE });
      setCouplesCharges((cache) => ({ ...cache, [code]: reponse.data }));
    } catch (err) {
      setErreurCouples(err instanceof Error ? err.message : 'Chargement impossible');
    } finally {
      setFamilleEnChargement(null);
    }
  }

  const chargement = enRecherche ? resultats.chargement : familles.chargement;
  const erreur = enRecherche ? resultats.erreur : familles.erreur;

  if (erreur) return <ErrorMessage message={erreur} />;
  if (chargement) return <Loader />;

  if (arbre.length === 0) {
    return <p className="vide">Aucun couple activité-compétence ne correspond.</p>;
  }

  const tronque =
    enRecherche && recherchePayload ? recherchePayload.pagination.total > LIMITE : false;

  return (
    <div className="accordion-activites">
      {tronque && (
        <p className="accordion-activites__note">
          {LIMITE} premiers résultats sur {recherchePayload!.pagination.total} — précisez la
          recherche pour tout voir.
        </p>
      )}

      {arbre.map((noeud) => {
        // En recherche, tout est déplié : les correspondances doivent être visibles d'emblée.
        const lettreDepliee = enRecherche || lettreOuverte === noeud.lettre;

        return (
          <section key={noeud.lettre} className="accordion-activites__lettre">
            <button
              type="button"
              className="accordion-activites__entete"
              aria-expanded={lettreDepliee}
              onClick={() =>
                setLettreOuverte((courante) => (courante === noeud.lettre ? null : noeud.lettre))
              }
              disabled={enRecherche}
            >
              <span className="accordion-activites__chevron">{lettreDepliee ? '▾' : '▸'}</span>
              <span className="accordion-activites__titre">
                <strong>{noeud.lettre}</strong> — {noeud.domaine1}
              </span>
              <span className="accordion-activites__compte">{noeud.nb}</span>
            </button>

            {lettreDepliee && (
              <div className="accordion-activites__familles">
                {noeud.familles.map((famille) => {
                  const familleDepliee = enRecherche || familleOuverte === famille.code;
                  const lignes = couples[famille.code];

                  return (
                    <div key={famille.code} className="accordion-activites__famille">
                      <button
                        type="button"
                        className="accordion-activites__entete accordion-activites__entete--famille"
                        aria-expanded={familleDepliee}
                        onClick={() => basculerFamille(famille.code)}
                        disabled={enRecherche}
                      >
                        <span className="accordion-activites__chevron">
                          {familleDepliee ? '▾' : '▸'}
                        </span>
                        <span className="accordion-activites__titre">
                          <strong>{famille.code}</strong> — {famille.domaine2}
                        </span>
                        <span className="accordion-activites__compte">{famille.nb}</span>
                      </button>

                      {familleDepliee && (
                        <div className="accordion-activites__couples">
                          {familleEnChargement === famille.code && <Loader />}
                          {erreurCouples && familleOuverte === famille.code && (
                            <ErrorMessage message={erreurCouples} />
                          )}
                          {lignes && <TableauCouples couples={lignes} />}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
