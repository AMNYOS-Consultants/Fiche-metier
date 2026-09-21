import { Router } from 'express';
import { metierRoutes } from './metier.routes';
import { activiteRoutes } from './activite.routes';
import { formacodeRoutes } from './formacode.routes';
import { referentielRoutes } from './referentiel.routes';
import { passerelleRoutes } from './passerelle.routes';
import { exportRoutes } from './export.routes';
import { importRoutes } from './import.routes';
import { authRoutes } from './auth.routes';
import { exigerAuthentification } from '../middlewares/auth.middleware';

export const apiRoutes = Router();

// Public : le healthcheck Docker et la connexion elle-même ne peuvent pas exiger
// une session qu'on n'a pas encore.
apiRoutes.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
apiRoutes.use('/auth', authRoutes);

// Tout ce qui suit exige une session valide.
apiRoutes.use(exigerAuthentification);

apiRoutes.use('/metiers', metierRoutes);
apiRoutes.use('/activites', activiteRoutes);
apiRoutes.use('/formacodes', formacodeRoutes);
apiRoutes.use('/referentiels', referentielRoutes);
apiRoutes.use('/passerelles', passerelleRoutes);
apiRoutes.use('/export', exportRoutes);
apiRoutes.use('/import', importRoutes);
