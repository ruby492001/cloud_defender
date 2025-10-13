// Верхняя панель: только строка поиска (уменьшенная) и кнопка «обновить».
import React from 'react'

export default function Toolbar({ query, onQueryChange, onRefresh }) {
    return (
        <div className="toolbar">
            {/* Поиск по имени — компактный: ~ ширина 5 кнопок «обновить» */}
            <input
                className="search"
                placeholder="Поиск по имени"
                value={query}
                onChange={e=> onQueryChange(e.target.value)}
            />

            {/* Квадратная кнопка «обновить» справа от поиска */}
            <button className="btn icon" title="Обновить" onClick={onRefresh} aria-label="Обновить">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke="currentColor" fill="none" strokeWidth="2"/>
                    <path d="M21 3v6h-6" stroke="currentColor" fill="none" strokeWidth="2"/>
                </svg>
            </button>
        </div>
    )
}
