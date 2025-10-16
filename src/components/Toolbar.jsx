import React from 'react';

export default function Toolbar({ query, onQueryChange, onRefresh, children }) {
    return (
        <div className="toolbar">
            <input
                className="search"
                placeholder="Search in Drive"
                value={query}
                onChange={e => onQueryChange(e.target.value)}
            />

            <div className="toolbar-actions">
                {children}
                <button className="btn icon" type="button" title="Refresh" onClick={onRefresh} aria-label="Refresh list">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke="currentColor" fill="none" strokeWidth="2" />
                        <path d="M21 3v6h-6" stroke="currentColor" fill="none" strokeWidth="2" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
