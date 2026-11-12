import { AtSign, Check, HeartHandshake, Mail, MessageCircle, Phone, RefreshCw, Search, Send, UserRoundPlus, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { PageHeader } from '../components/Layout';
import { Button, EmptyState, Modal } from '../components/UI';
import { api } from '../lib/api';
import type { FriendConnection, FriendProfile } from '../types';

type View = 'discover' | 'invitations' | 'friends';

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

function budgetLabel(person: FriendProfile) {
  if (person.budgetMin === null && person.budgetMax === null) return 'ยังไม่ได้ระบุงบประมาณ';
  if (person.budgetMin === null) return `ไม่เกิน ฿${person.budgetMax!.toLocaleString('th-TH')} / เดือน`;
  if (person.budgetMax === null) return `ตั้งแต่ ฿${person.budgetMin.toLocaleString('th-TH')} / เดือน`;
  return `฿${person.budgetMin.toLocaleString('th-TH')}–${person.budgetMax.toLocaleString('th-TH')} / เดือน`;
}

function PersonCard({ person, badge, actions, onView, contact = false }: {
  person: FriendProfile; badge?: ReactNode; actions: ReactNode; onView: () => void; contact?: boolean;
}) {
  return <article className="friend-card">
    <header><FriendAvatar person={person}/><div><h2>{person.firstName} {person.lastName}</h2><p>{person.university || 'ยังไม่ได้ระบุมหาวิทยาลัย'}</p></div></header>
    {badge && <div className="friend-status">{badge}</div>}
    <p className="friend-bio">{person.bio || 'ยังไม่ได้เขียนแนะนำตัว ลองทำความรู้จักกันก่อนตัดสินใจแชร์ห้อง'}</p>
    <dl className="friend-facts"><div><dt>ไลฟ์สไตล์</dt><dd>{person.lifestyle || 'ยังไม่ได้ระบุ'}</dd></div><div><dt>งบค่าห้องที่ตั้งไว้</dt><dd>{budgetLabel(person)}</dd></div></dl>
    {contact && <Contacts person={person}/>}
    <button className="friend-profile-link" onClick={onView}>ดูโปรไฟล์เต็ม</button>
    <footer>{actions}</footer>
  </article>;
}

function Contacts({ person }: { person: FriendProfile }) {
  return <div className="friend-contacts" aria-label="ช่องทางติดต่อหลังตอบรับ">
    {person.lineId && <span><MessageCircle size={16}/>LINE: {person.lineId}</span>}
    {person.instagram && <span><AtSign size={16}/>Instagram: {person.instagram}</span>}
    {person.email && <a href={`mailto:${person.email}`}><Mail size={16}/>{person.email}</a>}
    {person.phone && <span><Phone size={16}/>{person.phone}</span>}
    {!person.lineId && !person.instagram && !person.email && !person.phone && <span>ยังไม่ได้เพิ่มช่องทางติดต่อ</span>}
  </div>;
}

export function FriendsPage() {
  const { notify } = useApp();
  const [view, setView] = useState<View>('discover');
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<FriendProfile[]>([]);
  const [connections, setConnections] = useState<FriendConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<FriendProfile | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      Promise.all([api.friends(query.trim()), api.friendConnections()])
        .then(([profiles, relationships]) => { if (active) { setPeople(profiles); setConnections(relationships); } })
        .catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'โหลดเพื่อนไม่สำเร็จ'); })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, reload]);

  const act = async (key: string, operation: () => Promise<FriendConnection>, message: string) => {
    if (busy) return;
    setBusy(key); setActionError('');
    try {
      const result = await operation();
      setConnections(current => [result, ...current.filter(item => item.connectionId !== result.connectionId)]);
      setPeople(current => current.filter(person => person.userId !== result.person.userId));
      notify(message);
      if (result.status === 'accepted') setView('friends');
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'ดำเนินการไม่สำเร็จ'); }
    finally { setBusy(''); }
  };
  const incomingCount = connections.filter(item => item.status === 'pending' && item.direction === 'incoming').length;
  const accepted = connections.filter(item => item.status === 'accepted');
  const invitations = connections.filter(item => item.status !== 'accepted');
  const sentPending = connections.filter(item => item.status === 'pending' && item.direction === 'outgoing' && matchesSearch(item.person, query));
  const tabs: { value: View; label: string; count?: number }[] = [
    { value: 'discover', label: 'ทำความรู้จัก' }, { value: 'invitations', label: 'คำชวน', count: incomingCount },
    { value: 'friends', label: 'เพื่อนของฉัน', count: accepted.length },
  ];

  return <div className="page friends-page">
    <PageHeader title="หาเพื่อนก่อนหาห้อง" subtitle="เจอคนที่อยากแชร์ชีวิตประจำวันด้วย แล้วค่อยเลือกห้องไปด้วยกัน" actions={<Button className="friend-refresh" aria-label="อัปเดตคำชวน" variant="quiet" disabled={loading || Boolean(busy)} onClick={() => { setActionError(''); setReload(current => current + 1); }}><RefreshCw size={17}/><span>อัปเดตคำชวน</span></Button>}/>
    <div className="friends-note"><span><HeartHandshake size={25}/></span><p>เริ่มจากทำความรู้จัก ไม่ต้องมีห้องก่อน<br/><small>ช่องทางติดต่อจะแชร์เมื่ออีกฝ่ายตอบรับคำชวนเท่านั้น</small></p><Link to="/profile">เติมโปรไฟล์ของฉัน</Link></div>
    <nav className="friend-tabs" aria-label="หมวดหาเพื่อน">{tabs.map(tab => <button key={tab.value} aria-pressed={view === tab.value} className={view === tab.value ? 'selected' : ''} onClick={() => { setView(tab.value); setActionError(''); }}>{tab.label}{Boolean(tab.count) && <span>{tab.count}</span>}</button>)}</nav>
    {view === 'discover' && <label className="friend-search"><Search size={20}/><input aria-label="ค้นหาเพื่อน" placeholder="ค้นหาชื่อ มหาวิทยาลัย หรือไลฟ์สไตล์" maxLength={100} disabled={Boolean(busy)} value={query} onChange={event => setQuery(event.target.value)}/>{query && <button disabled={Boolean(busy)} onClick={() => setQuery('')} aria-label="ล้างคำค้นหาเพื่อน"><X size={18}/></button>}</label>}
    {actionError && <p className="form-alert" role="alert">{actionError}</p>}
    {loading ? <div className="friend-grid" aria-label="กำลังโหลดเพื่อน"><div className="match-skeleton"/><div className="match-skeleton"/></div>
      : error ? <EmptyState icon={<RefreshCw/>} title="โหลดข้อมูลเพื่อนไม่สำเร็จ" text={error} action={<Button onClick={() => setReload(current => current + 1)}>ลองอีกครั้ง</Button>}/>
      : view === 'discover' ? people.length || sentPending.length ? <><p className="friends-result" aria-live="polite">{people.length > 0 && `ทำความรู้จักได้ ${people.length} คน`}{people.length > 0 && sentPending.length > 0 && ' · '}{sentPending.length > 0 && `ส่งคำชวนแล้ว ${sentPending.length} คน`}</p><div className="friend-grid">
        {sentPending.map(connection => <PersonCard key={`sent-${connection.connectionId}`} person={connection.person} onView={() => setSelected(connection.person)} badge={<span className="status pending"><Check size={15}/>ส่งคำชวนแล้ว · รอตอบรับ</span>} actions={<Button variant="secondary" className="w-full" onClick={() => setView('invitations')}>ดูคำชวนที่ส่ง</Button>}/>)}
        {people.map(person => <PersonCard key={person.userId} person={person} onView={() => setSelected(person)} actions={<Button className="w-full" loading={busy === `invite-${person.userId}`} disabled={Boolean(busy)} onClick={() => act(`invite-${person.userId}`, () => api.inviteFriend(person.userId), 'ส่งคำชวนแล้ว ดูสถานะได้ที่แท็บคำชวน')}><UserRoundPlus size={18}/>ชวนหาห้องด้วยกัน</Button>}/>)}</div></>
        : <EmptyState icon={<Search/>} title={query ? 'ไม่พบเพื่อนที่ตรงกับคำค้น' : 'ยังไม่มีคนใหม่ให้ทำความรู้จัก'} text={query ? 'ลองค้นหาชื่อ มหาวิทยาลัย หรือไลฟ์สไตล์อื่น' : 'ดูคำชวนที่ส่งไว้ หรือกลับมาดูเมื่อมีสมาชิกใหม่'} action={<Button variant="secondary" onClick={() => query ? setQuery('') : setView('invitations')}>{query ? 'ล้างคำค้น' : 'ดูคำชวน'}</Button>}/>
      : view === 'invitations' ? invitations.length ? <div className="friend-grid">{invitations.map(connection => <PersonCard key={connection.connectionId} person={connection.person} onView={() => setSelected(connection.person)} badge={<span className={`status ${connection.status === 'declined' ? 'unavailable' : 'pending'}`}>{connection.status === 'declined' ? 'คำชวนไม่ได้รับการตอบรับ' : connection.direction === 'incoming' ? 'ชวนคุณหาห้องด้วยกัน' : 'รอเพื่อนตอบรับ'}</span>} actions={connection.status === 'pending' && connection.direction === 'incoming' ? <><Button loading={busy === connection.connectionId} disabled={Boolean(busy)} onClick={() => act(connection.connectionId, () => api.decideFriend(connection.connectionId, 'accepted'), 'ตอบรับแล้ว เริ่มหาห้องด้วยกันได้เลย')}><Check size={17}/>ตอบรับ</Button><Button variant="quiet" disabled={Boolean(busy)} onClick={() => act(connection.connectionId, () => api.decideFriend(connection.connectionId, 'declined'), 'ปฏิเสธคำชวนแล้ว')}>ปฏิเสธ</Button></> : <p className="friend-waiting"><Send size={16}/>{connection.status === 'declined' ? 'ยังไม่มีการแชร์ช่องทางติดต่อ' : 'เมื่อเพื่อนตอบรับ จะปรากฏในเพื่อนของฉัน'}</p>}/>)}</div>
        : <EmptyState icon={<Send/>} title="ยังไม่มีคำชวน" text="เริ่มจากโปรไฟล์ที่คุณสนใจ แล้วส่งคำชวนหาห้องด้วยกัน" action={<Button onClick={() => setView('discover')}>ทำความรู้จักเพื่อน</Button>}/>
      : accepted.length ? <div className="friend-grid">{accepted.map(connection => <PersonCard key={connection.connectionId} person={connection.person} contact onView={() => setSelected(connection.person)} badge={<span className="status available"><HeartHandshake size={15}/>ตอบรับกันแล้ว</span>} actions={<Link className="button button-secondary w-full" to={`/rooms?withFriend=${connection.person.userId}`}>ค้นหาห้องด้วยกัน</Link>}/>)}</div>
        : <EmptyState icon={<HeartHandshake/>} title="ยังไม่มีเพื่อนที่ตอบรับ" text="เมื่ออีกฝ่ายตอบรับคำชวน คุณจะเห็นช่องทางติดต่อและเริ่มหาห้องด้วยกันได้ที่นี่" action={<Button onClick={() => setView('discover')}>เริ่มหาเพื่อน</Button>}/>}
    {selected && <Modal title="ทำความรู้จักเพื่อน" onClose={() => setSelected(null)}><div className="friend-full-profile"><FriendAvatar person={selected}/><h2>{selected.firstName} {selected.lastName}</h2><p>{selected.university || 'ยังไม่ได้ระบุมหาวิทยาลัย'}</p><h3>เกี่ยวกับฉัน</h3><p>{selected.bio || 'ยังไม่ได้เขียนแนะนำตัว'}</p><h3>ไลฟ์สไตล์</h3><p>{selected.lifestyle || 'ยังไม่ได้ระบุ'}</p><h3>งบค่าห้องที่ตั้งไว้</h3><p>{budgetLabel(selected)}</p>{selected.email && <Contacts person={selected}/>}</div></Modal>}
  </div>;
}
