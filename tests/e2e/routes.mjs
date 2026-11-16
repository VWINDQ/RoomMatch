import { readFileSync } from 'node:fs';

// Deliberately explicit so a new route requires a layout fixture and assertion.
export const routes = [
  { path: '/login', actor: 'guest', ready: 'form', name: 'login' },
  { path: '/register', actor: 'guest', ready: 'form', name: 'register' },
  { path: '/rooms', actor: 'owner', ready: '.room-card', name: 'rooms' },
  { path: '/rooms/:id', url: '/rooms/1', actor: 'owner', ready: '.gallery', name: 'detail-owner' },
  { path: '/favorites', actor: 'owner', ready: '.room-card', name: 'favorites' },
  { path: '/my-listings', actor: 'owner', ready: '.my-listing', name: 'my-listings' },
  { path: '/my-listings/new', actor: 'owner', ready: 'form', name: 'create' },
  { path: '/my-listings/:id/edit', url: '/my-listings/1/edit', actor: 'owner', ready: 'form', name: 'edit' },
  { path: '/requests', url: '/requests?view=incoming', actor: 'owner', ready: '.request-card', name: 'requests' },
  { path: '/matches', actor: 'member', ready: '.match-card', name: 'matches' },
  { path: '/friends', actor: 'owner', ready: '.friend-card', name: 'friends' },
  { path: '/profile', actor: 'owner', ready: '.profile-summary', name: 'profile' },
];

export function declaredRoutes() {
  return [...readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8').matchAll(/<Route\s+path="([^"]+)"/g)]
    .map(match => match[1]).filter(path => path !== '*').sort();
}

export const breakpointWidths = [380, 381, 420, 421, 480, 481, 640, 641, 700, 701, 767, 768,
  900, 901, 1023, 1024, 1100, 1101, 1180, 1181, 1499, 1500, 1579, 1580];
