import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

const LIENS = [
  { to: '/', label: 'Accueil', exact: true },
  { to: '/metiers', label: 'Métiers' },
  { to: '/activites', label: 'Activités & compétences' },
  { to: '/formacodes', label: 'Domaines de connaissance' },
  { to: '/rome', label: 'Codes ROME' },
  { to: '/passerelles', label: 'Passerelles' },
];

export function Layout() {
  const { deconnecterSession } = useAuth();
  const navigate = useNavigate();

  async function seDeconnecter() {
    await deconnecterSession();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__brand">Fiches Métiers</div>
        <nav className="app-nav">
          {LIENS.map(({ to, label, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) => (isActive ? 'app-nav__lien actif' : 'app-nav__lien')}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <button type="button" className="app-header__deconnexion" onClick={seDeconnecter}>
          Se déconnecter
        </button>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        Données issues des cartographies de branches — base compétences V3.3
      </footer>
    </div>
  );
}
