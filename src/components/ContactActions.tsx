import { AtSign, Check, Copy, ExternalLink, Mail, MessageCircle, Phone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { instagramProfileUrl } from '../lib/contactLinks';
import './ContactActions.css';

type ContactDetails = { lineId?: string; instagram?: string; email?: string; phone?: string };
type CopyFeedback = { field: string; value: string; failed: boolean };

export function ContactActions({ lineId, instagram, email, phone }: ContactDetails) {
  const [copying, setCopying] = useState(false);
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);
  const instagramUrl = instagram ? instagramProfileUrl(instagram) : null;
  useEffect(() => {
    if (!feedback || feedback.failed) return;
    const timer = window.setTimeout(() => setFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const copyContact = async (field: string, value: string) => {
    if (copying) return;
    setCopying(true); setFeedback(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setFeedback({ field, value, failed: false });
    } catch { setFeedback({ field, value, failed: true }); }
    finally { setCopying(false); }
  };
  const copyButton = (field: string, value: string) => <button type="button" className="contact-action" disabled={copying} aria-label={`คัดลอก ${field}`} onClick={() => copyContact(field, value)}>
    {feedback?.field === field && !feedback.failed ? <Check size={15}/> : <Copy size={15}/>}คัดลอก
  </button>;

  return <div className="contact-actions" aria-label="ช่องทางติดต่อ">
    {lineId && <div className="contact-actions-row contact-actions-line"><MessageCircle size={17}/><div className="contact-actions-value"><small>LINE</small><span>{lineId}</span></div>{copyButton('LINE', lineId)}</div>}
    {instagram && <div className="contact-actions-row contact-actions-instagram"><AtSign size={17}/><div className="contact-actions-value"><small>Instagram</small><span>{instagram}</span></div>{instagramUrl
      ? <a className="contact-action" href={instagramUrl} target="_blank" rel="noopener noreferrer" aria-label="เปิด Instagram ในแท็บใหม่">เปิด<ExternalLink size={15}/></a>
      : copyButton('Instagram', instagram)}</div>}
    {email && <a className="contact-actions-row contact-actions-email" href={`mailto:${encodeURIComponent(email)}`}><Mail size={17}/><span>{email}</span></a>}
    {phone && <div className="contact-actions-row contact-actions-phone"><Phone size={17}/><span>{phone}</span></div>}
    {!lineId && !instagram && !email && !phone && <p className="contact-actions-empty">ยังไม่ได้เพิ่มช่องทางติดต่อ</p>}
    {feedback && (feedback.failed ? <div className="contact-actions-fallback"><p role="alert">คัดลอกอัตโนมัติไม่ได้ เลือกข้อความด้านล่างเพื่อคัดลอกเอง</p><input aria-label={`${feedback.field} สำหรับคัดลอกเอง`} value={feedback.value} readOnly onFocus={event => event.currentTarget.select()}/></div>
      : <p className="contact-actions-feedback" role="status">คัดลอก {feedback.field} แล้ว</p>)}
  </div>;
}
