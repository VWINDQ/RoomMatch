import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './AppContext';
import { AppShell } from './components/Layout';
import { Toast } from './components/Toast';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { ListingFormPage } from './pages/ListingFormPage';
import { MatchesPage } from './pages/MatchesPage';
import { MyListingsPage } from './pages/MyListingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { RequestsPage } from './pages/RequestsPage';
import { RoomDetailPage } from './pages/RoomDetailPage';
import { RoomsPage } from './pages/RoomsPage';
import { FriendsPage } from './pages/FriendsPage';
import { FavoritesPage } from './pages/FavoritesPage';

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    const workspace = document.querySelector<HTMLElement>('.workspace');

    if (workspace) {
      workspace.scrollTop = 0;
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname]);

  return null;
}

function ProtectedRoutes() {
  const { user, authLoading, authError, retryAuth } = useApp(); const location = useLocation();
  if (authLoading) return <main className="route-loading"><span className="clay-loader"/><p>กำลังเตรียมห้องให้คุณ...</p></main>;
  if (authError) return <main className="route-loading"><p>{authError}</p><button className="button button-primary" onClick={retryAuth}>ลองเชื่อมต่ออีกครั้ง</button></main>;
  return user ? <Outlet/> : <Navigate to="/login" replace state={{ from: location.pathname }}/>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, authLoading } = useApp();
  if (authLoading) return null;
  return user ? <Navigate to="/rooms" replace/> : children;
}

function RoutedApp() {
  const { toast } = useApp();
  return <><ScrollToTop/><Routes>
    <Route path="/login" element={<GuestOnly><LoginPage/></GuestOnly>}/>
    <Route path="/register" element={<GuestOnly><RegisterPage/></GuestOnly>}/>
    <Route element={<ProtectedRoutes/>}><Route element={<AppShell/>}>
      <Route path="/favorites" element={<FavoritesPage/>}/>
      <Route path="/rooms" element={<RoomsPage/>}/><Route path="/rooms/:id" element={<RoomDetailPage/>}/>
      <Route path="/my-listings" element={<MyListingsPage/>}/><Route path="/my-listings/new" element={<ListingFormPage/>}/><Route path="/my-listings/:id/edit" element={<ListingFormPage/>}/>
      <Route path="/requests" element={<RequestsPage/>}/><Route path="/matches" element={<MatchesPage/>}/><Route path="/profile" element={<ProfilePage/>}/>
      <Route path="/friends" element={<FriendsPage/>}/>
    </Route></Route>
    <Route path="*" element={<Navigate to="/rooms" replace/>}/>
  </Routes><Toast message={toast}/></>;
}

export default function App() { return <AppProvider><RoutedApp/></AppProvider>; }
