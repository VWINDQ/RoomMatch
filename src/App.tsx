import { SessionSkeleton, Skeleton } from './components/Skeleton';
import { Component, lazy, Suspense, useEffect, type ComponentProps, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { AppProvider, useApp } from './AppContext';
import { AppShell } from './components/Layout';
import { Toast } from './components/Toast';
import { Button } from './components/UI';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { OAuthCallbackPage } from './pages/OAuthCallbackPage';
import { RoomsPage } from './pages/RoomsPage';

const ListingFormPage = lazy(() => import('./pages/ListingFormPage').then(module => ({ default: module.ListingFormPage })));
const MatchesPage = lazy(() => import('./pages/MatchesPage').then(module => ({ default: module.MatchesPage })));
const MyListingsPage = lazy(() => import('./pages/MyListingsPage').then(module => ({ default: module.MyListingsPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(module => ({ default: module.ProfilePage })));
const RequestsPage = lazy(() => import('./pages/RequestsPage').then(module => ({ default: module.RequestsPage })));
const RoomDetailPage = lazy(() => import('./pages/RoomDetailPage').then(module => ({ default: module.RoomDetailPage })));
const FriendsPage = lazy(() => import('./pages/FriendsPage').then(module => ({ default: module.FriendsPage })));
const FavoritesPage = lazy(() => import('./pages/FavoritesPage').then(module => ({ default: module.FavoritesPage })));

class PageLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error('RoomMatch page failed to load', error); }
  render() {
    if (this.state.failed) return <div className="page" role="alert"><h1>โหลดหน้านี้ไม่สำเร็จ</h1><p>ตรวจสอบการเชื่อมต่อแล้วลองโหลดหน้าใหม่ ข้อมูลที่บันทึกไว้ยังอยู่</p><Button onClick={() => window.location.reload()}>โหลดหน้าใหม่</Button></div>;
    return this.props.children;
  }
}

function DeferredPage({ children, variant }: { children: ReactNode; variant: ComponentProps<typeof Skeleton>['variant'] }) {
  return <PageLoadBoundary key={variant}><Suspense fallback={<div className="page"><Skeleton variant={variant}/></div>}>{children}</Suspense></PageLoadBoundary>;
}

function ScrollToTop() {
  const location = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>('.workspace')?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    const state = location.state as { focusTarget?: string } | null;
    const restoreId = state?.focusTarget || (navigationType === 'POP' ? sessionStorage.getItem(`roommatch:focus:${location.pathname}${location.search}`) : null);
    let finished = false;
    const focus = (fallback = false) => {
      const target = (restoreId ? document.getElementById(restoreId) : null) || ((!restoreId || fallback) ? document.querySelector<HTMLElement>('main h1, main h2') : null);
      if (!target || finished) return;
      // A dialog opened during loading now owns focus, including its return target.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) { finished = true; return; }
      target.tabIndex = target.matches('a, button, input') ? target.tabIndex : -1;
      target.focus({ preventScroll: true });
      if (restoreId && target.id === restoreId) target.scrollIntoView({ block: 'center', behavior: 'instant' });
      finished = true;
    };
    const observer = new MutationObserver(() => focus());
    observer.observe(document.body, { childList: true, subtree: true });
    const frame = requestAnimationFrame(() => focus());
    const timer = window.setTimeout(() => focus(true), 2000);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [location.pathname]);
  return null;
}

function ProtectedRoutes() {
  const { user, authLoading, authError, retryAuth } = useApp(); const location = useLocation();
  if (authLoading) return <SessionSkeleton/>;
  if (authError) return <main className="route-loading"><p>{authError}</p><button className="button button-primary" onClick={retryAuth}>ลองเชื่อมต่ออีกครั้ง</button></main>;
  return user ? <Outlet key={user.userId}/> : <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }}/>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, authLoading } = useApp();
  const location = useLocation();
  const destination = (location.state as { from?: string } | null)?.from || '/rooms';
  if (authLoading) return <SessionSkeleton/>;
  return user ? <Navigate to={destination} replace/> : children;
}

function RoutedApp() {
  const { toast, toastTone } = useApp();
  return <><ScrollToTop/><Routes>
    <Route path="/auth/google/complete" element={<OAuthCallbackPage/>}/>
    <Route path="/login" element={<GuestOnly><LoginPage/></GuestOnly>}/>
    <Route path="/register" element={<GuestOnly><RegisterPage/></GuestOnly>}/>
    <Route element={<ProtectedRoutes/>}><Route element={<AppShell/>}>
      <Route path="/favorites" element={<DeferredPage variant="rooms"><FavoritesPage/></DeferredPage>}/>
      <Route path="/rooms" element={<RoomsPage/>}/><Route path="/rooms/:id" element={<DeferredPage variant="room-detail"><RoomDetailPage/></DeferredPage>}/>
      <Route path="/my-listings" element={<DeferredPage variant="listings"><MyListingsPage/></DeferredPage>}/><Route path="/my-listings/new" element={<DeferredPage variant="listing-form"><ListingFormPage/></DeferredPage>}/><Route path="/my-listings/:id/edit" element={<DeferredPage variant="listing-form"><ListingFormPage/></DeferredPage>}/>
      <Route path="/requests" element={<DeferredPage variant="requests"><RequestsPage/></DeferredPage>}/><Route path="/matches" element={<DeferredPage variant="matches"><MatchesPage/></DeferredPage>}/><Route path="/profile" element={<DeferredPage variant="profile"><ProfilePage/></DeferredPage>}/>
      <Route path="/friends" element={<DeferredPage variant="friends"><FriendsPage/></DeferredPage>}/>
    </Route></Route>
    <Route path="*" element={<Navigate to="/rooms" replace/>}/>
  </Routes><Toast message={toast} tone={toastTone}/></>;
}

export default function App() { return <AppProvider><RoutedApp/></AppProvider>; }
