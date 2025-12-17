// Контекстное меню: авто-коррекция позиции, чтобы не выходить за пределы окна (без скроллов)
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

export default function ContextMenu({ x, y, onClose, items }){
    const ref = useRef(null)
    const [pos, setPos] = useState({ left: x, top: y })

    // Клик вне меню / Esc — закрыть
    useEffect(()=>{
        const onDoc = (e)=>{ if(ref.current && !ref.current.contains(e.target)) onClose() }
        const onEsc = (e)=>{ if(e.key==='Escape') onClose() }
        document.addEventListener('mousedown', onDoc)
        document.addEventListener('keydown', onEsc)
        return ()=>{ document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) }
    }, [onClose])

    // После монтирования — замерить и скорректировать позицию, чтобы меню было полностью в вьюпорте
    useLayoutEffect(()=>{
        const el = ref.current
        if(!el) return
        const rect = el.getBoundingClientRect()
        const margin = 8
        const vw = window.innerWidth
        const vh = window.innerHeight

        let left = x
        let top  = y

        // если не влезает по ширине — двигаем влево
        if (left + rect.width + margin > vw) left = Math.max(margin, vw - rect.width - margin)
        if (left < margin) left = margin

        // если не влезает по высоте — двигаем вверх
        if (top + rect.height + margin > vh) top = Math.max(margin, vh - rect.height - margin)
        if (top < margin) top = margin

        setPos({ left, top })
    }, [x, y, items?.length])

    return (
        <div ref={ref} className="menu" style={{ left: pos.left, top: pos.top, position: 'fixed' }}>
            {items.map((it)=> (
                <button
                    key={it.id}
                    onClick={()=> { it.onClick?.(); onClose() }}
                    style={{ color: it.danger? 'var(--danger)': undefined }}
                >
                    {it.label}
                </button>
            ))}
        </div>
    )
}