import { ImageOff } from 'lucide-react';
import { useState } from 'react';

export function RoomPhoto({ src, alt, className = '', priority = false }: { src?: string; alt: string; className?: string; priority?: boolean }) {
  const [failedSource, setFailedSource] = useState<string | undefined>();
  const [failedOptimizedSource, setFailedOptimizedSource] = useState<string>();
  if (!src || failedSource === src) return <div className={`photo-fallback ${className}`} role="img" aria-label={src ? `โหลดรูปไม่สำเร็จ: ${alt}` : 'ยังไม่มีรูปภาพห้อง'}><ImageOff aria-hidden="true"/><span>{src ? 'โหลดรูปไม่สำเร็จ' : 'ยังไม่มีรูปภาพ'}</span></div>;
  // Existing demo records retain their PNG URLs; use the compact copy without a DB rewrite.
  const isLocalDemo = /^(?:https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?)?\/assets\/room-main\.png$/.test(src);
  const optimized = isLocalDemo && failedOptimizedSource !== src;
  return <img className={className} src={optimized ? src.replace(/\.png$/, '.webp') : src} alt={alt}
    loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} decoding="async"
    onError={() => optimized ? setFailedOptimizedSource(src) : setFailedSource(src)}/>;
}
