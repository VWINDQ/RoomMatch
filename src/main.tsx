import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import './styles.css';
import './ux.css';

// Keep the existing descendant routes; a data router supports navigation blockers.
const router = createBrowserRouter([{ path: '*', element: <App/> }]);
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><RouterProvider router={router}/></React.StrictMode>);
