import { Skeleton } from '../components/Skeleton';
import { Check, HeartHandshake, RefreshCw, Search, Send, UserRoundPlus, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { PageHeader } from '../components/Layout';
import { ProfileDemographics } from '../components/ProfileDemographics';
import { roommateGenderLabel } from '../lib/profileLabels';
import { RoommateProfileModal, roommateBudgetLabel } from '../components/RoommateProfileModal';
import { ContactActions } from '../components/ContactActions';
import { FriendSearchExplanation } from '../components/FriendSearchContext';
import { FriendInstagram } from '../components/FriendInstagram';
import { Button, EmptyState, Modal } from '../components/UI';
import { api, ApiError } from '../lib/api';
import type { FriendConnection, FriendProfile } from '../types';
import './FriendsPage.css';

type View = 'discover' | 'invitations' | 'friends';
type InvitationView = 'incoming' | 'outgoing' | 'history';
type Withdrawal = { connection: FriendConnection; fromProfile: boolean };

function invitationLabel(connection: FriendConnection) {
  if (connection.status === 'accepted') return 'ตอบรับกันแล้ว';
  if (connection.status === 'cancelled') return connection.direction === 'outgoing' ? 'คุณถอนคำชวนแล้ว' : 'ผู้ส่งถอนคำชวนแล้ว';
  if (connection.status === 'declined') return connection.direction === 'incoming' ? 'คุณปฏิเสธคำชวน' : 'คำชวนไม่ได้รับการตอบรับ';
  return connection.direction === 'incoming' ? 'ชวนคุณหาห้องด้วยกัน' : 'รอเพื่อนตอบรับ';
}

function matchesSearch(person: FriendProfile, query: string) {
  const term = query.trim().toLocaleLowerCase();
  return [person.firstName, person.lastName, `${person.firstName} ${person.lastName}`, person.university, person.bio, person.lifestyle]
    .some(value => value.toLocaleLowerCase().includes(term));
}

function FriendAvatar({ person }: { person: FriendProfile }) {
  const [failed, setFailed] = useState(false);
  return <div className="friend-avatar">{person.profileImage && !failed
    ? <img src={person.profileImage} alt="" onError={() => setFailed(true)}/>
    : <span>{person.firstName.charAt(0)}{person.lastName.charAt(0)}</span>}</div>;
}

function PersonCard({ person, badge, actions, onView, accepted = false }: {
  person: FriendProfile; badge?: ReactNode; actions: ReactNode; onView: () => void; accepted?: boolean;
}) {
  return <article className="friend-card">
    <header><FriendAvatar person={person}/><div><h2>{person.firstName} {person.lastName}</h2><ProfileDemographics age={person.age} gender={person.gender}/><p>{person.university || 'ยังไม่ได้ระบุมหาวิทยาลัย'}</p></div></header>
    {badge && <div className="friend-status">{badge}</div>}
    <p className="friend-bio">{person.bio || 'ยังไม่ได้เขียนแนะนำตัว ลองทำความรู้จักกันก่อนตัดสินใจแชร์ห้อง'}</p>
    <dl className="friend-facts"><div><dt>ไลฟ์สไตล์</dt><dd>{person.lifestyle || 'ยังไม่ได้ระบุ'}</dd></div><div><dt>เพศที่สะดวกแชร์ห้อง</dt><dd>{roommateGenderLabel(person.preferredGender)}</dd></div><div><dt>งบค่าห้องที่ตั้งไว้</dt><dd>{roommateBudgetLabel(person)}</dd></div></dl>
    {accepted && <FriendInstagram instagram={person.instagram}/>}
    {accepted && (person.lineId || person.email || person.phone) && <ContactActions {...person} instagram={undefined}/>}
    <button className="friend-profile-link" onClick={onView}>ดูโปรไฟล์</button>
    <footer>{actions}</footer>
  </article>;
}

export function FriendsPage() {
  const { notify } = useApp();
  const [params, setParams] = useSearchParams();
  const view = (['discover', 'invitations', 'friends'].includes(params.get('view') || '') ? params.get('view') : 'discover') as View;
  const invitationView = (['incoming', 'outgoing', 'history'].includes(params.get('invitations') || '') ? params.get('invitations') : 'incoming') as InvitationView;
  const query = params.get('q') || '';
  const updateParams = (changes: Record<string,string>) => setParams(current => { const next = new URLSearchParams(current); for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); } return next; }, { replace: true });
  const setView = (value: View) => updateParams({ view: value });
  const setInvitationView = (value: InvitationView) => updateParams({ invitations: value });
  const setQuery = (value: string) => updateParams({ q: value });
  const [people, setPeople] = useState<FriendProfile[]>([]);
  const [connections, setConnections] = useState<FriendConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');
  const [actionNeedsRefresh, setActionNeedsRefresh] = useState(false);
  const actionFeedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (actionError && !busy) actionFeedback.current?.focus(); }, [actionError, busy]);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<FriendProfile | null>(null);
  const [withdrawal, setWithdrawal] = useState<Withdrawal | null>(null);
  const [withdrawalError, setWithdrawalError] = useState('');
  const withdrawalFeedback = useRef<HTMLParagraphElement>(null);
  const invitationFilters = useRef<HTMLElement>(null);
  const pendingFilterFocus = useRef<InvitationView | null>(null);
  const profileDialog = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLElement>(null);
  const selectedConnection = selected ? connections.find(connection => connection.person.userId === selected.userId) : undefined;
  const selectedPerson = selectedConnection?.person || selected;
  const openProfile = (person: FriendProfile) => { setActionError(''); setSelected(person); };
  const closeProfile = () => { if (busy) return; setSelected(null); requestAnimationFrame(() => { if (document.activeElement === document.body) tabsRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus(); }); };
  const withdrawalConnection = withdrawal ? connections.find(connection => connection.connectionId === withdrawal.connection.connectionId) || withdrawal.connection : null;
  const openWithdrawal = (connection: FriendConnection, fromProfile = false) => {
    if (busy) return;
    setActionError(''); setWithdrawalError(''); setSelected(null);
    setWithdrawal({ connection, fromProfile });
  };
  const closeWithdrawal = () => {
    if (busy) return;
    if (withdrawal?.fromProfile) setSelected(withdrawalConnection?.person || withdrawal.connection.person);
    else if (withdrawalConnection?.status !== 'pending') {
      pendingFilterFocus.current = 'history';
      updateParams({ view: 'invitations', invitations: 'history' });
    }
    setWithdrawal(null); setWithdrawalError('');
  };

  useEffect(() => { if (withdrawalError) withdrawalFeedback.current?.focus(); }, [withdrawalError]);
  useEffect(() => {
    if (withdrawal || view !== 'invitations' || invitationView !== pendingFilterFocus.current) return;
    // Wait for the destination filter to render before restoring keyboard focus.
    const frame = requestAnimationFrame(() => {
      invitationFilters.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
      pendingFilterFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [withdrawal, view, invitationView]);

  const withdrawInvitation = async () => {
    if (busy || !withdrawalConnection || withdrawalConnection.status !== 'pending') return;
    setBusy(`cancel-${withdrawalConnection.connectionId}`); setWithdrawalError('');
    try {
      const result = await api.cancelFriendInvitation(withdrawalConnection.connectionId);
      setConnections(current => [result, ...current.filter(connection => connection.connectionId !== result.connectionId)]);
      pendingFilterFocus.current = 'history';
      setWithdrawal(null);
      updateParams({ view: 'invitations', invitations: 'history' });
      notify('ถอนคำชวนแล้ว ดูได้ที่ประวัติ');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'ถอนคำชวนไม่สำเร็จ กรุณาลองอีกครั้ง';
      setWithdrawalError(message);
      if (caught instanceof ApiError && caught.status === 409) {
        try { setConnections(await api.friendConnections()); }
        catch { setWithdrawalError(`${message} ยังโหลดสถานะล่าสุดไม่ได้ กรุณาปิดหน้าต่างแล้วกดอัปเดตคำชวน`); }
      }
    } finally { setBusy(''); }
  };

  useEffect(() => {
    if (selected && !busy && profileDialog.current && !profileDialog.current.contains(document.activeElement)) {
      profileDialog.current.querySelector<HTMLButtonElement>('button[aria-label="ปิด"]')?.focus();
    }
  }, [selected, connections, busy]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      Promise.all([api.friends(query.trim()), api.friendConnections()])
        .then(([profiles, relationships]) => { if (active) { setPeople(profiles); setConnections(relationships); setActionNeedsRefresh(false); setActionError(''); } })
        .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'โหลดเพื่อนไม่สำเร็จ'); })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, reload]);

  const act = async (key: string, operation: () => Promise<FriendConnection>, message: string) => {
    if (busy || actionNeedsRefresh) return;
    setBusy(key); setActionError('');
    try {
      const result = await operation();
      setConnections(current => [result, ...current.filter(item => item.connectionId !== result.connectionId)]);
      setPeople(current => current.filter(person => person.userId !== result.person.userId));
      notify(message);
      if (result.status === 'accepted') setView('friends');
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : 'ดำเนินการไม่สำเร็จ';
      setActionError(reason);
      if (caught instanceof ApiError && caught.status === 409) {
        setActionNeedsRefresh(true);
        try {
          const latest = await api.friendConnections();
          setConnections(latest);
          setPeople(current => current.filter(person => !latest.some(connection => connection.person.userId === person.userId)));
          setActionNeedsRefresh(false);
        } catch { setActionError(`${reason} ยังตรวจสถานะล่าสุดไม่ได้ กรุณากดอัปเดตคำชวนก่อนลองอีกครั้ง`); }
      }
    }
    finally { setBusy(''); }
  };
  const incoming = connections.filter(item => item.status === 'pending' && item.direction === 'incoming');
  const outgoing = connections.filter(item => item.status === 'pending' && item.direction === 'outgoing');
  const history = connections.filter(item => item.status !== 'pending');
  const blockedRecipients = new Set(connections.filter(connection =>
    connection.status === 'accepted' || connection.status === 'pending'
    || (connection.status === 'declined' && connection.direction === 'incoming')
  ).map(connection => connection.person.userId));
  const resendable = new Map<string, FriendConnection>();
  for (const connection of history) {
    const recipient = connection.person.userId;
    if (connection.direction !== 'outgoing' || blockedRecipients.has(recipient)) continue;
    const previous = resendable.get(recipient);
    if (!previous || Number(connection.connectionId) > Number(previous.connectionId)) resendable.set(recipient, connection);
  }
  const resend = (connection: FriendConnection) => act(
    `invite-${connection.person.userId}`,
    () => api.inviteFriend(connection.person.userId),
    'ส่งคำชวนใหม่แล้ว ดูสถานะได้ที่รอเพื่อนตอบ',
  );
  const incomingCount = incoming.length;
  const accepted = connections.filter(item => item.status === 'accepted');
  const sentPending = outgoing.filter(item => matchesSearch(item.person, query));
  const invitationGroups = {
    incoming: { label: 'รอฉันตอบ', title: 'คำชวนที่รอคุณตอบ', description: 'เมื่อตอบรับ ทั้งสองฝ่ายจะเห็น LINE อีเมล และเบอร์โทรและ Instagram', items: incoming, empty: 'ไม่มีคำชวนรอคุณตอบ', emptyText: 'เมื่อมีคนชวนคุณหาห้องด้วยกัน คำชวนจะแสดงที่นี่' },
    outgoing: { label: 'รอเพื่อนตอบ', title: 'คำชวนที่คุณส่ง', description: 'รออีกฝ่ายตอบรับก่อนแชร์ LINE อีเมล และเบอร์โทร แล้วเริ่มหาห้องด้วยกัน', items: outgoing, empty: 'ยังไม่มีคำชวนรอเพื่อนตอบ', emptyText: 'เริ่มจากโปรไฟล์ที่สนใจ แล้วชวนเพื่อนหาห้องด้วยกัน' },
    history: { label: 'ประวัติ', title: 'ประวัติคำชวน', description: 'คำชวนที่ตอบรับ ปฏิเสธ หรือถอนแล้ว เพื่อนที่ตอบรับกันยังอยู่ในแท็บเพื่อนของฉัน', items: history, empty: 'ยังไม่มีประวัติคำชวน', emptyText: 'เมื่อมีการตอบรับ ปฏิเสธ หรือถอนคำชวน จะแสดงในประวัติ' },
  };
  const activeInvitation = invitationGroups[invitationView];
  const openInvitations = (preferred?: InvitationView) => {
    updateParams({ view: 'invitations', invitations: preferred ?? (incoming.length ? 'incoming' : outgoing.length ? 'outgoing' : history.length ? 'history' : 'incoming') }); setActionError('');
  };
  const tabs: { value: View; label: string; count?: number }[] = [
    { value: 'discover', label: 'ทำความรู้จัก' }, { value: 'invitations', label: 'คำชวน', count: incomingCount },
    { value: 'friends', label: 'เพื่อนของฉัน', count: accepted.length },
  ];

  return <div className="page friends-page">
    <PageHeader title="ค้นหาเพื่อนใหม่" subtitle="เจอคนที่อยากแชร์ชีวิตประจำวันด้วย แล้วค่อยเลือกห้องไปด้วยกัน" actions={<Button className="friend-refresh" aria-label="อัปเดตคำชวน" variant="quiet" disabled={loading || Boolean(busy)} onClick={() => { setActionError(''); setReload(current => current + 1); }}><RefreshCw size={17}/><span>อัปเดตคำชวน</span></Button>}/>
    <div className="friends-note"><span><HeartHandshake size={25}/></span><p>เริ่มจากทำความรู้จัก ไม่ต้องมีห้องก่อน<br/><small>ช่องทางติดต่อจะแชร์เมื่อทั้งสองฝ่ายตอบรับเป็นเพื่อนกัน</small></p><Link to="/profile">เติมโปรไฟล์ของฉัน</Link></div>
    <nav ref={tabsRef} className="friend-tabs" aria-label="หมวดหาเพื่อน">{tabs.map(tab => <button key={tab.value} aria-pressed={view === tab.value} className={view === tab.value ? 'selected' : ''} onClick={() => { if (tab.value === 'invitations') openInvitations(); else { setView(tab.value); setActionError(''); } }}>{tab.label}{Boolean(tab.count) && <span>{tab.count}</span>}</button>)}</nav>
    {view === 'invitations' && <><nav ref={invitationFilters} className="invitation-filters" aria-label="ประเภทคำชวน">{(Object.keys(invitationGroups) as InvitationView[]).map(key => <button key={key} className={invitationView === key ? 'selected' : ''} aria-pressed={invitationView === key} onClick={() => { setInvitationView(key); setActionError(''); }}>{invitationGroups[key].label}<span>{invitationGroups[key].items.length}</span></button>)}</nav><div className="invitation-heading"><h2>{activeInvitation.title}</h2><p>{activeInvitation.description}</p></div></>}
    {view === 'friends' && !loading && !error && connections.some(item => item.status === 'accepted') && <p className="inline-note"><FriendSearchExplanation/></p>}
    {view === 'discover' && <label className="friend-search"><Search size={20}/><input aria-label="ค้นหาเพื่อน" placeholder="ค้นหาชื่อ มหาวิทยาลัย หรือไลฟ์สไตล์" maxLength={100} disabled={Boolean(busy)} value={query} onChange={event => setQuery(event.target.value)}/>{query && <button disabled={Boolean(busy)} onClick={() => setQuery('')} aria-label="ล้างคำค้นหาเพื่อน"><X size={18}/></button>}</label>}
    {actionNeedsRefresh && !selected && !actionError && <p className="inline-note" role="status">กรุณาอัปเดตคำชวนเพื่อตรวจสถานะล่าสุดก่อนดำเนินการต่อ</p>}
    {actionError && !selected && <p ref={actionFeedback} tabIndex={-1} className="form-alert" role="alert">{actionError}</p>}
    {loading ? <Skeleton variant="friends"/>
      : error ? <EmptyState icon={<RefreshCw/>} title="โหลดข้อมูลเพื่อนไม่สำเร็จ" text={error} action={<Button onClick={() => setReload(current => current + 1)}>ลองอีกครั้ง</Button>}/>
      : view === 'discover' ? people.length || sentPending.length ? <><p className="friends-result" aria-live="polite">{people.length > 0 && `ทำความรู้จักได้ ${people.length} คน`}{people.length > 0 && sentPending.length > 0 && ' · '}{sentPending.length > 0 && `ส่งคำชวนแล้ว ${sentPending.length} คน`}</p><div className="friend-grid">
        {sentPending.map(connection => <PersonCard key={`sent-${connection.connectionId}`} person={connection.person} onView={() => openProfile(connection.person)} badge={<span className="status pending"><Check size={15}/>ส่งคำชวนแล้ว · รอตอบรับ</span>} actions={<Button variant="secondary" className="w-full" onClick={() => openInvitations('outgoing')}>ดูคำชวนที่ส่ง</Button>}/>)}
        {people.map(person => <PersonCard key={person.userId} person={person} onView={() => openProfile(person)} actions={<Button className="w-full" loading={busy === `invite-${person.userId}`} disabled={Boolean(busy) || actionNeedsRefresh} onClick={() => act(`invite-${person.userId}`, () => api.inviteFriend(person.userId), 'ส่งคำชวนแล้ว ดูสถานะได้ที่แท็บคำชวน')}><UserRoundPlus size={18}/>ส่งคำชวนเป็นเพื่อน</Button>}/>)}</div></>
        : <EmptyState icon={<Search/>} title={query ? 'ไม่พบเพื่อนที่ตรงกับคำค้น' : 'ยังไม่มีคนใหม่ให้ทำความรู้จัก'} text={query ? 'ลองค้นหาชื่อ มหาวิทยาลัย หรือไลฟ์สไตล์อื่น' : 'ดูคำชวนที่ส่งไว้ หรือกลับมาดูเมื่อมีสมาชิกใหม่'} action={<Button variant="secondary" onClick={() => query ? setQuery('') : openInvitations()}>{query ? 'ล้างคำค้น' : 'ดูคำชวน'}</Button>}/>
      : view === 'invitations' ? activeInvitation.items.length ? <div className="friend-grid">{activeInvitation.items.map(connection => <PersonCard key={connection.connectionId} person={connection.person} onView={() => openProfile(connection.person)} badge={<><span className={`status ${connection.status === 'accepted' ? 'available' : connection.status === 'pending' ? 'pending' : 'unavailable'}`}>{invitationLabel(connection)}</span><small className="invitation-date">{connection.status === 'cancelled' ? 'ถอนเมื่อ ' : connection.respondedAt ? 'ตอบเมื่อ ' : 'ส่งเมื่อ '}{new Date(connection.respondedAt || connection.createdAt).toLocaleDateString('th-TH', {day:'numeric',month:'short',year:'numeric'})}</small></>} actions={connection.status === 'pending' && connection.direction === 'incoming' ? <><Button loading={busy === connection.connectionId} disabled={Boolean(busy) || actionNeedsRefresh} onClick={() => act(connection.connectionId, () => api.decideFriend(connection.connectionId, 'accepted'), 'ตอบรับแล้ว เริ่มหาห้องด้วยกันได้เลย')}><Check size={17}/>ตอบรับคำชวน</Button><Button variant="quiet" disabled={Boolean(busy) || actionNeedsRefresh} onClick={() => act(connection.connectionId, () => api.decideFriend(connection.connectionId, 'declined'), 'ปฏิเสธคำชวนแล้ว')}>ปฏิเสธ</Button></> : connection.status === 'pending' ? <Button variant="quiet" disabled={Boolean(busy)} onClick={() => openWithdrawal(connection)}><X size={16}/>ถอนคำชวน</Button> : connection.status === 'accepted' ? <Button variant="secondary" className="w-full" onClick={() => setView('friends')}>ดูเพื่อนของฉัน</Button> : connection.direction === 'outgoing' && resendable.get(connection.person.userId)?.connectionId === connection.connectionId ? <Button variant="secondary" loading={busy === `invite-${connection.person.userId}`} disabled={Boolean(busy) || actionNeedsRefresh} onClick={() => resend(connection)}>ส่งคำชวนใหม่</Button> : <p className="friend-waiting">เก็บไว้ในประวัติคำชวน</p>}/>)}</div>
        : <EmptyState icon={<Send/>} title={activeInvitation.empty} text={activeInvitation.emptyText} action={invitationView === 'incoming' && outgoing.length > 0 ? <Button onClick={() => openInvitations('outgoing')}>ดูคำชวนที่ส่ง</Button> : <Button onClick={() => setView('discover')}>ทำความรู้จักเพื่อน</Button>}/>
      : accepted.length ? <div className="friend-grid">{accepted.map(connection => <PersonCard key={connection.connectionId} person={connection.person} accepted onView={() => openProfile(connection.person)} badge={<span className="status available"><HeartHandshake size={15}/>ตอบรับกันแล้ว</span>} actions={<Link className="button button-secondary w-full" to={`/rooms?withFriend=${connection.person.userId}`}>ค้นหาห้องด้วยกัน</Link>}/>)}</div>
        : <EmptyState icon={<HeartHandshake/>} title="ยังไม่มีเพื่อนที่ตอบรับ" text="เมื่ออีกฝ่ายตอบรับคำชวน คุณจะเห็นช่องทางติดต่อและเริ่มหาห้องด้วยกันได้ที่นี่" action={<Button onClick={() => setView('discover')}>เริ่มหาเพื่อน</Button>}/>}
    {withdrawalConnection && <div className="friend-cancel-dialog" aria-busy={Boolean(busy)}><Modal title="ถอนคำชวนหาเพื่อน?" onClose={closeWithdrawal} actions={<>
      <Button variant="quiet" disabled={Boolean(busy)} onClick={closeWithdrawal}>{withdrawalConnection.status === 'pending' ? 'เก็บคำชวนไว้' : 'กลับไปดูสถานะ'}</Button>
      <Button variant="danger" loading={Boolean(busy)} disabled={withdrawalConnection.status !== 'pending'} onClick={withdrawInvitation}>ยืนยันถอนคำชวน</Button>
    </>}>
      <p>{withdrawalConnection.status === 'pending' ? 'ถอนคำชวนที่ส่งให้' : 'คำชวนถึง'} <strong>{withdrawalConnection.person.firstName} {withdrawalConnection.person.lastName}</strong>{withdrawalConnection.status === 'pending' && ' ใช่ไหม?'}</p>
      {withdrawalConnection.status === 'pending' && <p>คำชวนจะย้ายไปประวัติ คุณส่งคำชวนใหม่ได้จากที่นั่น ช่องทางติดต่อจะแชร์เมื่อทั้งสองฝ่ายตอบรับเป็นเพื่อนกัน</p>}
      {withdrawalConnection.status !== 'pending' && !withdrawalError && <p className="inline-note" role="status">สถานะล่าสุด: {invitationLabel(withdrawalConnection)}</p>}
      {withdrawalError && <p ref={withdrawalFeedback} tabIndex={-1} className="form-alert" role="alert">{withdrawalConnection.status === 'accepted' ? 'เพื่อนตอบรับคำชวนแล้ว ถอนคำชวนไม่ได้ ความเป็นเพื่อนยังอยู่' : withdrawalConnection.status === 'declined' ? 'เพื่อนปฏิเสธคำชวนแล้ว ดูรายการนี้ได้ในประวัติ' : withdrawalConnection.status === 'cancelled' ? 'คำชวนนี้ถูกถอนแล้ว ประวัติยังอยู่และยังไม่เปิดเผย LINE เบอร์โทร และอีเมล' : withdrawalError}</p>}
    </Modal></div>}
    {selectedPerson && <div ref={profileDialog} aria-busy={Boolean(busy)}><RoommateProfileModal title="ทำความรู้จักเพื่อน" person={selectedPerson} onClose={closeProfile} actions={<>{actionNeedsRefresh && <Button variant="secondary" disabled={loading || Boolean(busy)} onClick={() => setReload(current => current + 1)}>อัปเดตคำชวน</Button>}{actionError && <p ref={actionFeedback} tabIndex={-1} className="form-alert" role="alert">{actionError}</p>}{
      !selectedConnection ? <Button className="w-full" loading={Boolean(busy)} disabled={actionNeedsRefresh} onClick={() => act(`invite-${selectedPerson.userId}`, () => api.inviteFriend(selectedPerson.userId), 'ส่งคำชวนแล้ว ดูสถานะได้ที่แท็บคำชวน')}><UserRoundPlus size={18}/>ชวนหาห้องด้วยกัน</Button>
        : selectedConnection.status === 'accepted' ? <Link className="button button-primary w-full" to={`/rooms?withFriend=${selectedPerson.userId}`}>ค้นหาห้องด้วยกัน</Link>
          : selectedConnection.status === 'pending' && selectedConnection.direction === 'incoming' ? <><Button variant="quiet" loading={busy === `decline-${selectedConnection.connectionId}`} disabled={Boolean(busy) || actionNeedsRefresh} onClick={() => act(`decline-${selectedConnection.connectionId}`, () => api.decideFriend(selectedConnection.connectionId, 'declined'), 'ปฏิเสธคำชวนแล้ว')}>ปฏิเสธ</Button><Button loading={busy === `accept-${selectedConnection.connectionId}`} disabled={Boolean(busy) || actionNeedsRefresh} onClick={() => act(`accept-${selectedConnection.connectionId}`, () => api.decideFriend(selectedConnection.connectionId, 'accepted'), 'ตอบรับแล้ว เริ่มหาห้องด้วยกันได้เลย')}>ตอบรับคำชวน</Button></>
          : selectedConnection.status === 'pending' && selectedConnection.direction === 'outgoing' ? <Button variant="quiet" disabled={Boolean(busy)} onClick={() => openWithdrawal(selectedConnection, true)}><X size={16}/>ถอนคำชวน</Button>
            : <Button variant="secondary" onClick={() => { closeProfile(); openInvitations(selectedConnection.status === 'pending' ? 'outgoing' : 'history'); }}>ดูสถานะคำชวน</Button>
    }</>}>{selectedConnection?.status === 'pending' && selectedConnection.direction === 'outgoing' && <p className="friend-waiting" role="status">ส่งคำชวนแล้ว · รอเพื่อนตอบรับ</p>}{selectedConnection?.status === 'cancelled' && <p className="friend-waiting">{invitationLabel(selectedConnection)} ยังไม่เปิดเผย LINE เบอร์โทร และอีเมล</p>}{selectedConnection?.status === 'declined' && <p className="friend-waiting">คำชวนนี้ถูกปฏิเสธแล้ว</p>}{selectedConnection?.status === 'accepted' && (selectedPerson.lineId || selectedPerson.instagram || selectedPerson.email || selectedPerson.phone) && <ContactActions {...selectedPerson}/>}</RoommateProfileModal></div>}
  </div>;
}
