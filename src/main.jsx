import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import {GoogleOAuthProvider} from "@react-oauth/google";

const CLIENT_ID = "37619748711-r9mango8rmvoj0o19obcsgjkjgv2bp53.apps.googleusercontent.com";

// Inject shared styles via JS (keeps layout consistent without a standalone CSS file)
const style = document.createElement('style')
style.innerHTML = `
  :root { --bg:#0b0e12; --panel:#121821; --muted:#6b7280; --text:#e5e7eb; --accent:#3b82f6; --danger:#ef4444; --success:#22c55e; }
  *{ box-sizing: border-box; }
  html, body, #root { height: 100%; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial; }
  button{ cursor:pointer; }

  .app{ display:flex; flex-direction:column; height:100%; }

  .toolbar{ display:flex; align-items:center; gap:.75rem; padding:.75rem 1rem; background:var(--panel); border-bottom:1px solid #1f2937; }
  .toolbar-actions{ display:flex; align-items:center; gap:.5rem; }
  .btn{ display:inline-flex; align-items:center; justify-content:center; gap:.35rem; background:#1f2937; color:var(--text); border:1px solid #263244; border-radius:.65rem; padding:.5rem 1rem; font-size:14px; font-weight:500; line-height:1.1; transition:background .2s ease, border-color .2s ease, color .2s ease; }
  .btn:hover{ background:#1f2a3a; border-color:#334155; }
  .btn:disabled{ opacity:.5; cursor:not-allowed; background:#1f2937; border-color:#334155; color:#94a3b8; }
  .btn.primary{ background:var(--accent); border-color:var(--accent); color:#fff; }
  .btn.primary:disabled{ background:#3b82f6; color:rgba(255,255,255,0.6); }
  .btn.primary:hover{ background:#2563eb; border-color:#2563eb; }
  .btn.secondary{ background:#1f2937; border-color:#334155; color:var(--text); }
  .btn.secondary:hover{ background:#273244; }
  .btn.ghost{ background:transparent; border-color:#334155; color:var(--text); }
  .btn.ghost:hover{ background:rgba(59,130,246,.12); border-color:#3b82f6; color:var(--text); }
  .btn.icon{ width:42px; height:42px; padding:0; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; }
  .btn.icon svg{ width:20px; height:20px; }
  .search{ flex:1; height:42px; background:#0f172a; border:1px solid #1f2937; padding:.45rem .75rem; border-radius:.65rem; color:var(--text); font-size:15px; }
  .checkbox{ width:16px; height:16px; }

  .row{ display:grid; grid-template-columns: 28px 1.5fr .8fr 1fr 40px; align-items:center; padding:.5rem .5rem; border-bottom:1px solid #1f2937; }
  .row:hover{ background:#0f1420; }
  .th{ position:sticky; top:0; background:var(--panel); z-index:3; user-select:none; }
  .th .sort{ cursor:pointer; display:flex; align-items:center; gap:4px; }
  .sort-arrow{ font-size:12px; opacity:.7; }
  .type-icon{ width:20px; height:20px; }
  .list{ overflow:auto; height:100%; }
  .empty{ padding:2rem; color:var(--muted); text-align:center; }
  .kebab{ width:28px; height:28px; border-radius:.5rem; display:inline-flex; align-items:center; justify-content:center; background:transparent; border:1px solid #263244; }

  .breadcrumb{ display:flex; gap:.35rem; align-items:center; padding:.5rem .75rem; background:var(--panel); border-bottom:1px solid #1f2937; }
  .breadcrumb a{ color:var(--text); text-decoration:none; opacity:.9; }
  .breadcrumb a:hover{ text-decoration:underline; }

  .menu{ position:absolute; background:#0f172a; border:1px solid #263244; border-radius:.5rem; min-width:200px; padding:.25rem; box-shadow:0 10px 30px rgba(0,0,0,.5); z-index:2000; }
  .menu button{ width:100%; text-align:left; padding:.5rem .75rem; background:transparent; border:none; color:var(--text); border-radius:.35rem; }
  .menu button:hover{ background:#111827; }


  .modal{ position:fixed; inset:0; z-index:3000; display:grid; place-items:center; background:rgba(0,0,0,.5); }
  .dialog{ width:min(900px,90vw); height:min(70vh,700px); background:var(--panel); border:1px solid #263244; border-radius:12px; display:flex; flex-direction:column; }
  .dialog-head{ display:flex; align-items:center; justify-content:space-between; gap:.5rem; padding:.6rem .8rem; border-bottom:1px solid #263244; }
  .dialog-body{ flex:1; display:flex; flex-direction:column; }
  .dialog-foot{ display:flex; justify-content:flex-end; gap:.5rem; padding:.6rem .8rem; border-top:1px solid #263244; }
`;
document.head.appendChild(style)

createRoot(document.getElementById('root')).render(
  <StrictMode>
      <GoogleOAuthProvider clientId={CLIENT_ID}>
          <App />
      </GoogleOAuthProvider>
  </StrictMode>,
)





