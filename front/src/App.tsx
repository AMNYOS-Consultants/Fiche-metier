import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { HomePage } from '@/pages/HomePage';
import { MetiersPage } from '@/pages/MetiersPage';
import { NouveauMetierPage } from '@/pages/NouveauMetierPage';
import { NouveauCouplePage } from '@/pages/NouveauCouplePage';
import { MetierDetailPage } from '@/pages/MetierDetailPage';
import { ActivitesPage } from '@/pages/ActivitesPage';
import { ActiviteDetailPage } from '@/pages/ActiviteDetailPage';
import { IncoherencesPage } from '@/pages/IncoherencesPage';
import { IncoherenceDetailPage } from '@/pages/IncoherenceDetailPage';
import { FormacodesPage } from '@/pages/FormacodesPage';
import { FormacodeDetailPage } from '@/pages/FormacodeDetailPage';
import { PasserellesPage } from '@/pages/PasserellesPage';
import { RomePage } from '@/pages/RomePage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { AuthProvider } from '@/context/AuthContext';
import { RequireAuth } from '@/components/RequireAuth';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<HomePage />} />
            <Route path="metiers" element={<MetiersPage />} />
            <Route path="metiers/nouveau" element={<NouveauMetierPage />} />
            <Route path="metiers/:code" element={<MetierDetailPage />} />
            <Route path="activites" element={<ActivitesPage />} />
            {/* Avant `activites/:code` : sinon `nouveau` serait pris pour un code activité. */}
            <Route path="activites/nouveau" element={<NouveauCouplePage />} />
            <Route path="activites/incoherences" element={<IncoherencesPage />} />
            <Route path="activites/incoherences/:code" element={<IncoherenceDetailPage />} />
            <Route path="activites/:code" element={<ActiviteDetailPage />} />
            <Route path="formacodes" element={<FormacodesPage />} />
            <Route path="formacodes/:code" element={<FormacodeDetailPage />} />
            <Route path="rome" element={<RomePage />} />
            <Route path="passerelles" element={<PasserellesPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
