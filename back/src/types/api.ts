/** Contrats d'API partagés avec le front (voir front/src/types/api.ts). */

export interface PaginationQuery {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiErrorBody {
  error: {
    message: string;
    code: string;
    details?: unknown;
  };
}

/** Erreur applicative portant un statut HTTP, interceptée par le middleware d'erreur. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = 'ERREUR',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static notFound(ressource: string): HttpError {
    return new HttpError(404, `${ressource} introuvable`, 'NON_TROUVE');
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, message, 'REQUETE_INVALIDE', details);
  }

  static conflict(message: string, details?: unknown): HttpError {
    return new HttpError(409, message, 'CONFLIT', details);
  }
}
