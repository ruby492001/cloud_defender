import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import {GoogleOAuthProvider} from "@react-oauth/google";

const CLIENT_ID = "37619748711-r9mango8rmvoj0o19obcsgjkjgv2bp53.apps.googleusercontent.com";

createRoot(document.getElementById('root')).render(
  <StrictMode>
      <GoogleOAuthProvider clientId={CLIENT_ID}>
          <App />
      </GoogleOAuthProvider>
  </StrictMode>,
)
