import { apiGet, apiPost, apiPut, apiDelete } from './client';
import type {
  Activite,
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
