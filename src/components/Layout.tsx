import { Building2, Home, LogOut, Plus, Sparkles, UserRound, UsersRound, UserRoundPlus, Heart } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';

const destinations = [
  { to: '/rooms', label: 'รวมประกาศห้อง', mobile: 'ห้อง', icon: Home },
  { to: '/friends', label: 'หาเพื่อนก่อนหาห้อง', mobile: 'หาเพื่อน', icon: UserRoundPlus },
  { to: '/my-listings', label: 'ประกาศของฉัน', mobile: 'ประกาศ', icon: Building2 },
  { to: '/favorites', label: 'ห้องโปรด', mobile: 'โปรด', icon: Heart },
  { to: '/requests', label: 'คำขอเข้าพัก', mobile: 'คำขอ', icon: UsersRound },
  { to: '/matches', label: 'เพื่อนร่วมห้อง', mobile: 'แมตช์', icon: Sparkles },
  { to: '/profile', label: 'โปรไฟล์', mobile: 'โปรไฟล์', icon: UserRound },
];

export function Logo({ compact = false }: { compact?: boolean }) {
  return <NavLink to="/rooms" className="logo" aria-label="ROOMMATCH หน้าแรก"><span className="logo-mark"><Building2 size={20}/></span>{!compact && <span>ROOMMATCH</span>}</NavLink>;
}

function NavItems({ mobile = false }: { mobile?: boolean }) {
  return <>{destinations.map(({ to, label, mobile: mobileLabel, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={20}/><span>{mobile ? mobileLabel : label}</span></NavLink>)}</>;
}

export function AppShell() {
  const navigate = useNavigate(); const location = useLocation(); const { user, logout } = useApp();
  const hideCreate = location.pathname.includes('/new') || location.pathname.includes('/edit');
  const initial = user?.firstName.trim().charAt(0) || 'ผ';
  const signOut = () => { logout(); navigate('/login'); };
  return <div className="app-shell">
    <aside className="desktop-rail"><Logo/><nav aria-label="เมนูหลัก"><NavItems/></nav>
      {!hideCreate && <button className="create-shortcut" onClick={() => navigate('/my-listings/new')}><Plus size={18}/>ลงประกาศใหม่</button>}
      <div className="rail-profile"><div className="avatar">{initial}</div><div><strong>{user?.firstName}</strong><span>นักศึกษา</span></div><button onClick={signOut} aria-label="ออกจากระบบ"><LogOut size={18}/></button></div>
    </aside>
    <header className="compact-header"><Logo/><button className="avatar" onClick={() => navigate('/profile')} aria-label="เปิดโปรไฟล์">{initial}</button></header>
    <main className="workspace"><Outlet/></main><nav className="mobile-nav" aria-label="เมนูหลัก"><NavItems mobile/></nav>
  </div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}
