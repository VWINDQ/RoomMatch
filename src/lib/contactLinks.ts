export function instagramProfileUrl(value: string): string | null {
  const input = value.trim();
  let username = input.replace(/^@/, '');
  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      if (!['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
      const profile = /^\/([a-zA-Z0-9._]+)\/?$/.exec(url.pathname);
      if (!profile) return null;
      username = profile[1];
    } catch { return null; }
  }
  // Construct our own HTTPS destination; never turn arbitrary stored text into a link.
  if (!/^[a-zA-Z0-9._]+$/.test(username) || username === '.' || username === '..') return null;
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}
