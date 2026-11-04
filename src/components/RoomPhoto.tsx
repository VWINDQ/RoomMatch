import { ImageOff } from 'lucide-react';
import { useState } from 'react';

export function RoomPhoto({ src, alt, className = '' }: { src?: string; alt: string; className?: string }) {
  const [failedSource, setFailedSource] = useState<string | undefined>();
  if (!src || failedSource === src) return <div className={`photo-fallback ${className}`} role="img" aria-label={src ? `โหลดรูปไม่สำเร็จ: ${alt}` : 'ยังไม่มีรูปภาพห้อง'}><ImageOff aria-hidden="true"/><span>{src ? 'โหลดรูปไม่สำเร็จ' : 'ยังไม่มีรูปภาพ'}</span></div>;
  return <img className={className} src={src} alt={alt} onError={() => setFailedSource(src)}/>;
}
