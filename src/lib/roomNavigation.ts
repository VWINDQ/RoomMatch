export function roomReturn(state: unknown) {
  const input = state && typeof state === 'object' ? state as { from?: unknown; focusReturnId?: unknown } : {};
  const from = input.from;
  const allowed = ['/rooms', '/favorites', '/my-listings', '/matches', '/requests'];
  const to = typeof from === 'string' && allowed.some(path => from === path || from.startsWith(`${path}?`)) ? from : '/rooms';
  const label = to.startsWith('/matches') ? 'กลับไปสมาชิกห้อง' : to.startsWith('/requests') ? 'กลับไปคำขอ' : to.startsWith('/my-listings') ? 'กลับไปประกาศของฉัน' : to.startsWith('/favorites') ? 'กลับไปห้องโปรด' : 'กลับไปดูห้องทั้งหมด';
  return { to, label, focusTarget: typeof input.focusReturnId === 'string' ? input.focusReturnId : undefined };
}

export function listingReturn(state: unknown) {
  const back = roomReturn(state);
  const from = state && typeof state === 'object' ? (state as { from?: unknown }).from : undefined;
  if (back.to === '/rooms' && from !== '/rooms') return { to: '/my-listings', label: 'กลับไปประกาศของฉัน', focusTarget: undefined };
  return back;
}
