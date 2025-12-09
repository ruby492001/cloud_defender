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

  .workspace-shell{ min-height:100vh; padding:20px; display:flex; flex-direction:column; gap:12px; background: radial-gradient(120% 120% at 20% 20%, rgba(59,130,246,.08), transparent 40%), var(--bg); }
  .session-bar{ display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; padding:1rem 1.25rem; background:var(--panel); border:1px solid #1f2937; border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,.35); }
  .page-title{ margin:.2rem 0; font-size:22px; }
  .session-meta{ margin:0; color:var(--muted); }
  .session-user{ color:var(--text); font-weight:700; }
  .session-actions{ display:flex; align-items:center; gap:.5rem; }
  .eyebrow{ margin:0; text-transform:uppercase; letter-spacing:.08em; font-size:12px; color:var(--muted); }

  .auth-shell{ min-height:100vh; display:grid; place-items:center; padding:48px 20px; background: radial-gradient(140% 140% at 20% 20%, rgba(59,130,246,.14), transparent 40%), radial-gradient(120% 120% at 80% 0%, rgba(14,165,233,.12), transparent 42%), var(--bg); }
  .auth-card{ width:min(520px, 100%); background:#0f172a; border:1px solid #1f2937; border-radius:16px; padding:18px; box-shadow:0 25px 70px rgba(0,0,0,.35); }
  .auth-single{ display:flex; flex-direction:column; gap:12px; }
  .auth-card h2, .auth-card h3{ margin:0; }
  .auth-card-head{ display:flex; align-items:center; justify-content:space-between; gap:.75rem; margin-bottom:12px; }
  .form{ display:flex; flex-direction:column; gap:12px; }
  .field{ display:flex; flex-direction:column; gap:6px; }
  .field span{ color:var(--muted); font-size:14px; }
  .input{ height:46px; background:#0b1120; border:1px solid #1f2937; border-radius:10px; padding:0 12px; color:var(--text); font-size:15px; }
  .input:focus{ outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(59,130,246,.25); }
  .field-error{ color:#fca5a5; font-size:12px; }
  .form-actions{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .register-card.collapsed{ max-height:0; overflow:hidden; opacity:0; pointer-events:none; transform:translateY(-8px); transition:all .25s ease; }
  .register-card.open{ max-height:800px; opacity:1; transform:translateY(0); transition:all .25s ease; }
  .alert{ padding:12px 14px; border-radius:12px; background:rgba(239,68,68,.12); border:1px solid rgba(239,68,68,.35); color:#fecdd3; }
  .helper-text{ color:var(--muted); font-size:12px; }
  .register-modal{ display:flex; align-items:center; justify-content:center; padding:16px; }
  .register-dialog{ width:min(520px, 90vw); background:#0f172a; border:1px solid #1f2937; border-radius:16px; padding:18px; box-shadow:0 30px 80px rgba(0,0,0,.45); }
  .google-select{ display:flex; align-items:center; gap:10px; }
  .status-dot{ width:12px; height:12px; border-radius:50%; background:var(--danger); border:1px solid rgba(255,255,255,.08); box-shadow:0 0 0 3px rgba(239,68,68,.15); }
  .status-dot.ok{ background:var(--success); box-shadow:0 0 0 3px rgba(34,197,94,.18); }

  .storage-menu{ position:relative; }
  .storage-menu .avatar{ width:44px; height:44px; border-radius:50%; background:linear-gradient(145deg, #1f2937, #0b1220); color:#e5e7eb; border:1px solid #263244; font-weight:700; letter-spacing:.02em; }
  .storage-menu .avatar:hover{ border-color:#3b82f6; }
  .storage-menu-popup{ position:absolute; right:0; top:110%; width:260px; background:#0f172a; border:1px solid #1f2937; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,.5); padding:12px; z-index:3000; display:flex; flex-direction:column; gap:8px; }
  .storage-menu-list{ max-height:220px; overflow:auto; display:flex; flex-direction:column; gap:6px; }
  .storage-item{ width:100%; text-align:left; background:#111827; border:1px solid #1f2937; color:var(--text); border-radius:10px; padding:8px 10px; display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .storage-item.active{ border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,.12); }
  .storage-delete{ color:var(--muted); font-weight:700; cursor:pointer; padding:2px 6px; border-radius:6px; }
  .storage-delete:hover{ background:rgba(239,68,68,.12); color:var(--danger); }
  .storage-menu-actions{ display:flex; gap:8px; }
  .confirm-modal{ display:flex; align-items:center; justify-content:center; padding:16px; }
  .confirm-dialog{ width:min(480px, 90vw); background:#0f172a; border:1px solid #1f2937; border-radius:16px; padding:18px; box-shadow:0 30px 80px rgba(0,0,0,.45); }
  .confirm-actions{ display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
`; 
document.head.appendChild(style)

createRoot(document.getElementById('root')).render(
  <StrictMode>
      <GoogleOAuthProvider clientId={CLIENT_ID}>
          <App />
      </GoogleOAuthProvider>
  </StrictMode>,
)





