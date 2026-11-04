import { useState } from 'react';

export function ProfilePhoto({ src, fallback }: { src: string; fallback: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return src && failedSource !== src
    ? <img src={src} alt="" onError={() => setFailedSource(src)}/>
    : <>{fallback}</>;
}
