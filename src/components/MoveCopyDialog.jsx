// Диалог выбора папки назначения для перемещения/копирования.
// Содержит мини-эксплорер: хлебные крошки + список только папок.
import React, { useEffect, useRef, useState } from 'react'

export default function MoveCopyDialog({ api, open, mode, onClose, onConfirm, startFolder='root' }){
    const [stack, setStack] = useState([{ id:startFolder, name:'Мой диск' }]) // путь для хлебных крошек
    const [items, setItems] = useState([])   // только папки
    const [loading, setLoading] = useState(false)
    const listRef = useRef(null)

    useEffect(()=>{ if(open) void load(startFolder, true) }, [open])

    // Загрузка папок для текущего уровня
    const load = async (fid, replace=false)=>{
        setLoading(true)
        try{
            const res = await api.listOnlyFolders(fid); setItems(res.files||[])
            if(replace) setStack([{ id: fid, name: fid==='root'?'Мой диск':'…' }])
        } finally { setLoading(false) }
    }

    const openFolder = async (f)=>{ setStack(prev=> [...prev, { id:f.id, name:f.name }]); await load(f.id) }
    const upTo = async (id)=>{ const idx = stack.findIndex(x=> x.id===id); if(idx>=0){ setStack(stack.slice(0, idx+1)); await load(id) } }

    if(!open) return null
    return (
        <div className="modal" onMouseDown={(e)=>{ if(e.target.classList.contains('modal')) onClose() }}>
            <div className="dialog" onMouseDown={(e)=> e.stopPropagation()}>
                <div className="dialog-head">
                    <div style={{fontWeight:700}}>{mode==='move'?'Перемещение':'Копирование'} — выберите папку назначения</div>
                    <button className="btn" onClick={onClose}>Закрыть</button>
                </div>

                <div className="dialog-body">
                    {/* Хлебные крошки внутри модалки */}
                    <div className="breadcrumb" style={{ borderBottom:'none', padding:'.4rem .75rem' }}>
                        {stack.map((bc,i)=> (
                            <span key={bc.id}>
                <a href="#" onClick={(e)=>{e.preventDefault(); upTo(bc.id)}}>{bc.name}</a>
                                {i<stack.length-1 && <span style={{ color:'var(--muted)' }}> / </span>}
              </span>
                        ))}
                    </div>

                    {/* Список только папок */}
                    <div ref={listRef} className="list" style={{ borderTop:'1px solid #263244' }}>
                        <div className="row th">
                            <div></div><div style={{fontWeight:700}}>Имя папки</div><div></div><div></div><div></div>
                        </div>
                        {items.length===0 && !loading && <div className="empty">Нет папок</div>}
                        {items.map(it=> (
                            <div key={it.id} className="row" onDoubleClick={()=> openFolder(it)}>
                                <div></div>
                                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                    <img className="type-icon" src={folderSvg} alt="Папка"/>
                                    <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{it.name}</div>
                                </div>
                                <div></div><div></div><div></div>
                            </div>
                        ))}
                        {loading && <div className="empty">Загрузка...</div>}
                    </div>
                </div>

                <div className="dialog-foot">
                    <button className="btn" onClick={onClose}>Отмена</button>
                    <button className="btn" onClick={()=> onConfirm(stack[stack.length-1].id)}>
                        {mode==='move'?'Переместить сюда':'Копировать сюда'}
                    </button>
                </div>
            </div>
        </div>
    )
}

// Встроенная иконка папки
const folderSvg = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='%23f59e0b'><path d='M10 4H4a2 2 0 0 0-2 2v2h20V8a2 2 0 0 0-2-2h-8l-2-2z'/><path d='M22 10H2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8z'/></svg>`
