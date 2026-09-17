import { apiGet, apiPost, apiPut, apiDelete } from './client';
import type {
  Activite,
  ActiviteConnaissance,
  FamilleActiviteComptee,
  Formacode,
  FormacodeNiveau,
  Referentiels,
  CodeIncoherent,
  VarianteDetaillee,
  EditionModele,
  PaginatedResponse,
} from '@/types/api';

export interface FiltresActivites {
  search?: string;
  famille?: string;
  formacode?: string;
  page?: number;
  limit?: number;
}

export function listerActivites(filtres: FiltresActivites, signal?: AbortSignal) {
  return apiGet<PaginatedResponse<Activite>>('/activites', { ...filtres }, signal);
}

export function obtenirActivite(code: string, signal?: AbortSignal) {
  return apiGet<Activite>(`/activites/${encodeURIComponent(code)}`, undefined, signal);
}

/**
 * Emplacement du nouveau couple : une seule des trois formes.
 *   - `halo` (« I.02.08 ») : le 3e segment existe, on ajoute une déclinaison.
 *   - `famille` (« I.02 ») : le 2e segment existe, on ajoute une activité.
 *   - `nouvelleFamille` : on crée le 2e segment, sous une lettre existante ou nouvelle.
 */
export interface EmplacementCouple {
  famille?: string;
  halo?: string;
  nouvelleFamille?: {
    lettre: string;
    /** Requis seulement si la lettre est nouvelle. */
    domaine1?: string;
    domaine2: string;
    domaine3?: string;
  };
}

export interface NouveauCouple extends EmplacementCouple {
  codeMetier: string;
  intituleActivite: string;
  intituleCompetence: string | null;
  detailsActivite: string[];
  detailsCompetence: string[];
  niveauxMaitrise: Array<{ niveau: number; description: string }>;
  connaissances: Array<{ codeFormacode: string; niveau: number | null }>;
}

/**
 * Crée un couple activité-compétence de toutes pièces : l'entrée de catalogue et son
 * rattachement à la fiche métier. Le code est attribué par le serveur, jamais saisi.
 */
export function creerCouple(donnees: NouveauCouple, signal?: AbortSignal) {
  return apiPost<{ codeActivite: string; coupleId: number }>('/activites', donnees, signal);
}

/** L'arborescence de la page : familles portant au moins une activité, avec leur compte. */
export function listerFamillesActivite(signal?: AbortSignal) {
  return apiGet<{ data: FamilleActiviteComptee[] }>('/activites/familles', undefined, signal);
}

export interface FiltresFormacodes {
  search?: string;
  nsf?: string;
  fondamental?: boolean;
  page?: number;
  limit?: number;
}

export function listerFormacodes(filtres: FiltresFormacodes, signal?: AbortSignal) {
  return apiGet<PaginatedResponse<Formacode>>('/formacodes', { ...filtres }, signal);
}

export function obtenirFormacode(code: string, signal?: AbortSignal) {
  return apiGet<Formacode>(`/formacodes/${encodeURIComponent(code)}`, undefined, signal);
}

export interface NouveauFormacode {
  codeFormacode: string;
  intitule: string;
  codeNsf: string | null;
  estFondamental: boolean;
}

export function creerFormacode(donnees: NouveauFormacode, signal?: AbortSignal) {
  return apiPost<Formacode>('/formacodes', donnees, signal);
}

export function supprimerFormacode(code: string, signal?: AbortSignal) {
  return apiDelete(`/formacodes/${encodeURIComponent(code)}`, signal);
}

// ---------- Édition des niveaux d'un formacode ----------

export interface LigneNiveauFormacode {
  niveau: number;
  origine: 'base_formacodes' | 'base_competences' | 'outil_fiche_metier';
  estNiveauUnique: boolean;
  dureeHeures: number | null;
  dureeSemaines: number | null;
  dureeMois: number | null;
  methodeCalcul: string | null;
  source: string | null;
}

/** Remplace en bloc les lignes (niveau, origine) d'un formacode — ajout, retrait et édition. */
export function modifierFormacodeNiveaux(
  code: string,
  niveaux: LigneNiveauFormacode[],
  signal?: AbortSignal,
) {
  return apiPut<{ data: FormacodeNiveau[]; proximitePerimee: boolean }>(
    `/formacodes/${encodeURIComponent(code)}/niveaux`,
    { niveaux },
    signal,
  );
}

export function obtenirReferentiels(signal?: AbortSignal) {
  return apiGet<Referentiels>('/referentiels', undefined, signal);
}

// ---------- Incohérences entre rédactions d'un même couple ----------

/** Les codes activité dont les rédactions divergent selon le métier (hors mots-clés). */
export function listerIncoherences(signal?: AbortSignal) {
  return apiGet<{ data: CodeIncoherent[] }>('/activites/incoherences', undefined, signal);
}

export function obtenirVariantes(codeActivite: string, signal?: AbortSignal) {
  return apiGet<{ data: VarianteDetaillee[] }>(
    `/activites/${encodeURIComponent(codeActivite)}/variantes`,
    undefined,
    signal,
  );
}

/**
 * Recopie la rédaction du couple `coupleModeleId` sur tous les autres du même code.
 * `edition`, si fourni, réécrit d'abord le modèle avec le contenu modifié.
 */
export function harmoniserCouple(
  codeActivite: string,
  coupleModeleId: number,
  edition?: EditionModele,
  signal?: AbortSignal,
) {
  return apiPut<{ nbMetiersAffectes: number }>(
    `/activites/${encodeURIComponent(codeActivite)}/harmoniser`,
    { coupleModeleId, edition },
    signal,
  );
}

/**
 * Réécrit une rédaction sur les seuls couples qui la portent — les autres rédactions du
 * même code activité ne sont pas touchées (contrairement à `harmoniserCouple`).
 */
export function modifierRedaction(
  codeActivite: string,
  coupleModeleId: number,
  edition: EditionModele,
  signal?: AbortSignal,
) {
  return apiPut<{ nbCouplesModifies: number }>(
    `/activites/${encodeURIComponent(codeActivite)}/redaction`,
    { coupleModeleId, edition },
    signal,
  );
}

/**
 * Domaines de connaissance d'UN couple (métier ↔ activité) : remplacement en bloc. Ils
 * pendent du couple, deux métiers partageant un code peuvent porter les leurs.
 */
export function modifierConnaissancesCouple(
  codeActivite: string,
  coupleId: number,
  connaissances: Array<{ codeFormacode: string; niveau: number | null }>,
  signal?: AbortSignal,
) {
  return apiPut<{ data: ActiviteConnaissance[] }>(
    `/activites/${encodeURIComponent(codeActivite)}/couples/${coupleId}/connaissances`,
    { connaissances },
    signal,
  );
}

/**
 * L'autre issue à une incohérence : détacher cette rédaction vers un nouveau code du même
 * halo (`I.02.08.01` -> `I.02.08.24`), au lieu de l'imposer aux autres métiers.
 */
export function scinderVariante(
  codeActivite: string,
  coupleModeleId: number,
  edition?: EditionModele,
  signal?: AbortSignal,
) {
  return apiPost<{ codeActivite: string; nbMetiersDeplaces: number }>(
    `/activites/${encodeURIComponent(codeActivite)}/scinder`,
    { coupleModeleId, edition },
    signal,
  );
}
