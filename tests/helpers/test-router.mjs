import { createElement, Fragment, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

// Match the application's data router so navigation blockers run in component tests.
export function TestRouter({ children, initialEntries = ['/'], initialIndex }) {
  const [router] = useState(() => createMemoryRouter([
    { path: '*', element: createElement(Fragment, null, children) },
  ], { initialEntries, initialIndex }));
  return createElement(RouterProvider, { router });
}
