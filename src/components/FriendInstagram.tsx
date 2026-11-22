import { ExternalLink } from 'lucide-react';
import { instagramProfileUrl } from '../lib/contactLinks';

export function FriendInstagram({ instagram }: { instagram?: string }) {
  const value = instagram?.trim();
  const url = value ? instagramProfileUrl(value) : null;
  const label = url ? `@${new URL(url).pathname.slice(1, -1)}` : value || 'ยังไม่ได้ระบุ';
  const content = <><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg><span><small>Instagram</small><strong>{label}</strong></span>{url && <ExternalLink size={17} aria-hidden="true"/>}</>;
  return url
    ? <a className="friend-instagram" href={url} target="_blank" rel="noopener noreferrer" aria-label={`เปิด Instagram ${label} ในแท็บใหม่`}>{content}</a>
    : <div className="friend-instagram">{content}</div>;
}
