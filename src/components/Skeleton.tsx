import type { CSSProperties, ReactNode } from 'react';
import './Skeleton.css';

type SkeletonVariant = 'rooms' | 'listings' | 'room-detail' | 'profile' | 'listing-form' | 'requests' | 'friends' | 'matches' | 'requester-profile' | 'members' | 'friend-context';

function Block({ className = '', width }: { className?: string; width?: CSSProperties['width'] }) {
  return <span className={`skeleton-block ${className}`} style={width ? { width } : undefined}/>;
}

function Lines({ short = false }: { short?: boolean }) {
  return <div className="skeleton-lines"><Block width={short ? '66%' : '86%'}/><Block width={short ? '44%' : '64%'}/></div>;
}

function Heading() {
  return <div className="skeleton-heading"><Block className="skeleton-title" width="min(72%, 330px)"/><Block width="min(90%, 440px)"/></div>;
}

function BackLink() {
  return <div className="skeleton-back-link"><Block width="160px"/></div>;
}

function PersonHeader() {
  return <div className="skeleton-person"><Block className="skeleton-avatar"/><div><Block className="skeleton-name" width="68%"/><Lines/></div></div>;
}

function Actions() {
  return <div className="skeleton-actions"><Block className="skeleton-button"/><Block className="skeleton-button skeleton-tint-blue"/></div>;
}

function RoomCards() {
  return <div className="room-grid">{Array.from({ length: 6 }, (_, index) => <div className="skeleton-surface skeleton-room-card" key={index}>
    <div className="skeleton-room-image"><Block/><span className="skeleton-heart"/></div>
    <div className="skeleton-room-copy"><Block className="skeleton-name" width="85%"/><Block className="skeleton-price" width="35%"/><Lines/><div className="skeleton-card-footer"><Block width="50%"/><Block width="28%"/></div></div>
  </div>)}</div>;
}

function Listings() {
  return <div className="skeleton-listings">{[0, 1, 2].map(index => <div className="skeleton-surface skeleton-listing" key={index}>
    <Block className="skeleton-listing-image"/><div className="skeleton-listing-copy"><Block className="skeleton-pill skeleton-tint-mint"/><Block className="skeleton-name" width="76%"/><Lines short/></div><div className="skeleton-listing-actions"><Block className="skeleton-price"/><Actions/></div>
  </div>)}</div>;
}

function RequestCards() {
  return <div className="skeleton-surface skeleton-request-panel"><Block className="skeleton-name" width="32%"/>{[0, 1, 2].map(index => <div className="skeleton-request-row" key={index}>
    <Block className="skeleton-avatar"/><div className="skeleton-request-copy"><Block className="skeleton-pill skeleton-tint-mint"/><Block className="skeleton-name" width="58%"/><Lines/></div><Actions/>
  </div>)}</div>;
}

function PersonCards({ matches = false }: { matches?: boolean }) {
  return <div className={matches ? 'match-grid' : 'friend-grid'}>{[0, 1].map(index => <div className={`skeleton-surface skeleton-person-card ${matches ? 'skeleton-match-card' : ''}`} key={index}>
    {matches && <div className="skeleton-match-heading"><Block className="skeleton-icon skeleton-tint-yellow"/><Lines/></div>}
    <PersonHeader/>{!matches && <Lines/>}
    <div className="skeleton-info skeleton-tint-mint"><Block width="28%"/><Block width="70%"/></div>
    <div className="skeleton-info skeleton-tint-peach"><Block width="32%"/><Block width="55%"/></div>
    {matches ? <><Members/><Block className="skeleton-button skeleton-tint-blue"/></> : <Actions/>}
  </div>)}</div>;
}

function Profile() {
  return <><Heading/><div className="skeleton-surface skeleton-profile-banner"><PersonHeader/><Block className="skeleton-button"/></div>
    <div className="skeleton-profile-columns">{[0, 1, 2].map(index => <div className="skeleton-surface skeleton-profile-panel" key={index}><Block className="skeleton-name" width="60%"/>{(index < 2 ? [0, 1, 2, 3] : [0, 1, 2]).map(field => <div className="skeleton-info" key={field}><Block width="35%"/><Block width="72%"/></div>)}</div>)}</div>
  </>;
}

function RoomDetail() {
  return <><BackLink/><Heading/><div className="skeleton-gallery"><Block className="skeleton-gallery-main"/><div className="skeleton-gallery-thumbs"><Block/><Block/><Block/></div></div>
    <div className="skeleton-detail-columns"><div className="skeleton-detail-copy"><div className="skeleton-surface skeleton-detail-panel"><Block className="skeleton-name" width="35%"/><Lines/><Lines short/></div><div className="skeleton-surface skeleton-detail-panel"><Block className="skeleton-name" width="42%"/><Lines/></div></div>
      <div className="skeleton-surface skeleton-detail-panel"><Block className="skeleton-price" width="44%"/><Block className="skeleton-pill skeleton-tint-mint"/><PersonHeader/><Block className="skeleton-button skeleton-tint-blue"/></div>
    </div></>;
}

function ListingForm() {
  return <><BackLink/><Heading/><div className="skeleton-form">{[0, 1, 2].map(index => <div className="skeleton-surface skeleton-form-section" key={index}>
    <div className="skeleton-form-aside"><Block className="skeleton-icon"/><Lines/></div><div className="skeleton-form-fields">{[0, 1, 2].map(field => <div className="skeleton-field" key={field}><Block width="26%"/><Block className={field === 1 && index === 0 ? 'skeleton-textarea' : 'skeleton-input'}/></div>)}</div>
  </div>)}</div></>;
}

function RequesterProfile() {
  return <div className="skeleton-requester"><PersonHeader/><Block width="80%"/>{[0, 1, 2].map(index => <div className={index === 2 ? 'skeleton-info skeleton-tint-yellow' : 'skeleton-requester-section'} key={index}><Block className="skeleton-name" width="30%"/><Lines/></div>)}</div>;
}

function Members() {
  return <div className="skeleton-members"><Block width="120px"/><div className="skeleton-member-avatars">{[0, 1, 2].map(index => <Block className="skeleton-avatar" key={index}/>)}</div></div>;
}

const labels: Record<SkeletonVariant, string> = {
  rooms: 'กำลังโหลดห้อง', listings: 'กำลังโหลดประกาศของคุณ', 'room-detail': 'กำลังโหลดรายละเอียดห้อง',
  profile: 'กำลังโหลดโปรไฟล์', 'listing-form': 'กำลังโหลดข้อมูลประกาศ', requests: 'กำลังโหลดคำขอ',
  friends: 'กำลังโหลดเพื่อน', matches: 'กำลังโหลดสมาชิกห้อง', 'requester-profile': 'กำลังโหลดโปรไฟล์ผู้ขอเข้าพัก',
  members: 'กำลังโหลดรายชื่อสมาชิก', 'friend-context': 'กำลังโหลดข้อมูลเพื่อน',
};

function Region({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={`skeleton-region ${className}`} role="status" aria-label={label}>
    <span className="skeleton-announcement">{label}</span><div className="skeleton-content" aria-hidden="true">{children}</div>
  </div>;
}

export function Skeleton({ variant, label }: { variant: SkeletonVariant; label?: string }) {
  let content: ReactNode;
  switch (variant) {
    case 'rooms': content = <RoomCards/>; break;
    case 'listings': content = <Listings/>; break;
    case 'requests': content = <RequestCards/>; break;
    case 'friends': content = <PersonCards/>; break;
    case 'matches': content = <PersonCards matches/>; break;
    case 'profile': content = <Profile/>; break;
    case 'room-detail': content = <RoomDetail/>; break;
    case 'listing-form': content = <ListingForm/>; break;
    case 'requester-profile': content = <RequesterProfile/>; break;
    case 'members': content = <Members/>; break;
    case 'friend-context': content = <Lines/>; break;
  }
  return <Region label={label ?? labels[variant]} className={`skeleton-view-${variant}`}>{content}</Region>;
}

// Keep the shared room-grid import used by Rooms and Favorites compatible.
export function SkeletonGrid() { return <Skeleton variant="rooms"/>; }

export function SessionSkeleton() {
  return <main className="route-loading skeleton-session"><div className="skeleton-session-brand">ROOMMATCH</div>
    <Region label="กำลังเตรียมพื้นที่ให้คุณ"><Heading/><div className="skeleton-surface skeleton-session-card"><PersonHeader/><Lines/><div className="skeleton-info skeleton-tint-blue"><Lines/></div></div></Region>
  </main>;
}
