import { CheckCircle2, CircleAlert, Info } from 'lucide-react';
import './Toast.css';

export type ToastTone = 'success' | 'error' | 'info';

export function Toast({ message, tone = 'success' }: { message: string; tone?: ToastTone }) {
  if (!message) return null;
  const Icon = tone === 'error' ? CircleAlert : tone === 'info' ? Info : CheckCircle2;
  return <div className={`toast toast-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><Icon size={18} aria-hidden="true"/>{message}</div>;
}
