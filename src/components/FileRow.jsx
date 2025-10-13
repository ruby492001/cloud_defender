// Строка таблицы: чекбокс, имя (с иконкой), размер, дата изменения, кнопка-меню
import React from 'react'

// Преобразование байт в читаемый вид
function fmtSize(s){
    if(!s) return ''
    const n = Number(s); if(Number.isNaN(n)) return ''
    const u = ['B','KB','MB','GB','TB']; let i=0,v=n
    while(v>=1024 && i<u.length-1){ v/=1024; i++ }
    return `${v.toFixed(1)} ${u[i]}`
}

export default function FileRow({ item, selected, onSelect, onDoubleClick, onMenu, onContext }){
    const isFolder = item.mimeType === 'application/vnd.google-apps.folder'
    return (
        <div
            className="row"
            onDoubleClick={()=> onDoubleClick(item)}
            onContextMenu={(e)=> { e.preventDefault(); onContext?.(e, item) }}
        >
            {/* чекбокс выделения элемента */}
            <div><input className="checkbox" type="checkbox" checked={selected} onChange={e=> onSelect(e.target.checked, item)} /></div>

            {/* имя + иконка типа */}
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <img className="type-icon" alt={isFolder? 'Папка':'Файл'} src={isFolder? folderSvg: fileSvg} />
                <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.name}</div>
            </div>

            {/* размер для файлов */}
            <div>{isFolder? '' : fmtSize(item.size)}</div>

            {/* дата изменения */}
            <div>{item.modifiedTime ? new Date(item.modifiedTime).toLocaleString() : ''}</div>

            {/* кнопка контекстного меню справа */}
            <div style={{ display:'flex', justifyContent:'flex-end' }}>
                <button
                    className="kebab"
                    aria-label="Меню"
                    onClick={(e)=> {
                        e.stopPropagation()
                        const r = e.currentTarget.getBoundingClientRect()
                        onMenu({ x:r.left+window.scrollX, y:r.bottom+6+window.scrollY, item })
                    }}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/>
                    </svg>
                </button>
            </div>
        </div>
    )
}

// Встроенные иконки
const folderSvg = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='%23f59e0b'><path d='M10 4H4a2 2 0 0 0-2 2v2h20V8a2 2 0 0 0-2-2h-8l-2-2z'/><path d='M22 10H2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8z'/></svg>`
const fileSvg   = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='%239ca3af'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6'/></svg>`
