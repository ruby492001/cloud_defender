// Очередь скачиваний: файлы и папки (zip).
// Теперь ПОЛНОСТЬЮ разрешены дубликаты — каждая команда добавляет новую задачу.
// Безопасность сохранения обеспечивается тем, что сохранение делается один раз на taskId.

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'

const DownloadCtx = createContext(null)
export function useDownload(){ const ctx = useContext(DownloadCtx); if(!ctx) throw new Error('useDownload outside provider'); return ctx }

// Генератор уникальных taskId
let seq = 0
const newTaskId = () => `dlt-${Date.now()}-${++seq}`

// Реестр уже сохранённых задач (по taskId)
const savedOnce = new Set()

export function DownloadProvider({ api, children }){
    // Задача: { id:taskId, fileId, name, size, kind:'file'|'folder', progress, status, abort, removed }
    const [tasks, setTasks] = useState([])
    const running = useRef(0)
    const concurrency = 2
    const [dockVisible, setDockVisible] = useState(false)

    // Одноразовое сохранение Blob по taskId
    const saveBlobOnce = (taskId, name, blob)=>{
        if(savedOnce.has(taskId)) return
        savedOnce.add(taskId)
        const url = URL.createObjectURL(blob)
        requestAnimationFrame(()=>{
            try{
                const a = document.createElement('a')
                a.href = url
                a.download = name
                a.rel = 'noopener'
                a.target = '_self'
                a.style.display = 'none'
                document.body.appendChild(a)
                a.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, view:window }))
                a.remove()
            } finally {
                setTimeout(()=> URL.revokeObjectURL(url), 0)
            }
        })
    }

    const startNext = async ()=>{
        if(running.current >= concurrency) return
        const next = tasks.find(t => t.status === 'queued')
        if(!next) return
        running.current += 1
        const controller = new AbortController()
        setTasks(ts => ts.map(t => t.id === next.id ? { ...t, status:'running', abort: controller } : t))

        try{
            if(next.kind === 'folder'){
                await downloadFolderTask(next, controller.signal)
            } else {
                await downloadFileTask(next, controller.signal)
            }
            setTasks(ts => ts.map(t => t.id === next.id ? { ...t, status:'done', progress:100, abort: undefined } : t))
        }catch(e){
            if(e?.name==='AbortError'){
                setTasks(ts => ts.map(t => t.id === next.id ? { ...t, status:'canceled', abort: undefined } : t))
            } else {
                setTasks(ts => ts.map(t => t.id === next.id ? { ...t, status:'error', error: e?.message||'Ошибка', abort: undefined } : t))
            }
        } finally {
            running.current -= 1
            // Не вызываем вручную startNext — эффект ниже сам подхватит очередь
        }
    }

    // Автозапуск следующей задачи при изменении очереди
    useEffect(()=>{ startNext() /* eslint-disable-line */ }, [tasks])

    // === Скачивание файла ===
    const downloadFileTask = async (task, signal)=>{
        const { blob, name } = await api.downloadInChunks({
            id: task.fileId,
            name: task.name,
            size: task.size ?? undefined,
            signal,
            onProgress: (loaded, total)=>{
                setTasks(ts => ts.map(t => t.id === task.id ? { ...t, progress: total? Math.min(100, Math.round(loaded/total*100)) : t.progress } : t))
            }
        })
        saveBlobOnce(task.id, name, blob)
    }

    // === Рекурсивный обход папки и скачивание в ZIP ===
    const walkFolder = async (folderId, basePath, onEntry) => {
        let pageToken = undefined
        do{
            const { files, nextPageToken } = await api.listFolder(folderId, pageToken)
            for(const it of (files||[])){
                if(it.mimeType === 'application/vnd.google-apps.folder'){
                    await walkFolder(it.id, `${basePath}${it.name}/`, onEntry)
                } else {
                    await onEntry({ ...it, path: `${basePath}${it.name}` })
                }
            }
            pageToken = nextPageToken
        } while(pageToken)
    }

    const downloadFolderTask = async (task, signal)=>{
        const zip = new JSZip()
        const files = []
        await walkFolder(task.fileId, `${task.name}/`, async (entry)=> { files.push(entry) })

        const totalBytesKnown = files.every(f => !!f.size)
        const totalBytes = totalBytesKnown ? files.reduce((a,f)=> a + Number(f.size||0), 0) : files.length
        let acc = 0

        for(const f of files){
            if(signal?.aborted) throw new DOMException('aborted','AbortError')
            const { blob, size } = await api.downloadInChunks({
                id: f.id, name: f.name, size: f.size ?? undefined, signal,
                onProgress: (loaded, total)=>{
                    if(totalBytesKnown){
                        const current = (acc + Math.min(loaded, total || loaded)) / totalBytes
                        setTasks(ts => ts.map(t => t.id === task.id ? { ...t, progress: Math.min(99, Math.round(current*100)) } : t))
                    } else {
                        setTasks(ts => ts.map(t => t.id === task.id ? { ...t, progress: Math.min(99, Math.round((acc/files.length)*100)) } : t))
                    }
                }
            })
            const arrBuf = await blob.arrayBuffer()
            zip.file(f.path, arrBuf)
            acc += totalBytesKnown ? (size ?? arrBuf.byteLength) : 1
            const pct = totalBytesKnown ? Math.min(99, Math.round((acc/totalBytes)*100))
                : Math.min(99, Math.round((acc/files.length)*100))
            setTasks(ts => ts.map(t => t.id === task.id ? { ...t, progress: pct } : t))
        }

        const zipBlob = await zip.generateAsync({ type:'blob' })
        saveBlobOnce(task.id, `${task.name}.zip`, zipBlob)
    }

    // === Публичные методы ===

    /**
     * Поставить файл/папку в очередь.
     * ДЕДУПЛИКАЦИИ НЕТ: любые повторные команды создают новую задачу с новым taskId.
     */
    const enqueue = (file)=>{
        setDockVisible(true)
        setTasks(ts => {
            const kind = file.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file'
            const task = {
                id: newTaskId(),            // уникальный taskId
                fileId: file.id,            // id файла/папки в Drive
                name: file.name,
                size: file.size? Number(file.size): undefined,
                progress: 0,
                status: 'queued',
                kind
            }
            return [...ts, task]
        })
    }

    const enqueueMany = (files)=> { for(const f of files) enqueue(f) }

    // Управление задачами по taskId
    const cancel = (taskId)=> setTasks(ts => ts.map(t => t.id===taskId ? (t.abort?.abort(), { ...t, status: t.status==='done' ? 'done' : 'canceled', abort: undefined }) : t))
    const remove = (taskId)=> setTasks(ts => ts.map(t => t.id===taskId ? { ...t, removed:true } : t))
    const clearFinished = ()=> setTasks(ts => ts.map(t => (t.status==='done'||t.status==='canceled'||t.status==='error') ? { ...t, removed:true } : t))

    const visibleTasks = tasks.filter(t => !t.removed)
    const hasVisible = visibleTasks.length > 0
    useEffect(()=>{ if(!hasVisible) setDockVisible(false) }, [hasVisible])

    const value = useMemo(()=>({
        tasks:visibleTasks, enqueue, enqueueMany, cancel, remove, clearFinished, setDockVisible, dockVisible
    }), [visibleTasks, dockVisible])

    return (
        <DownloadCtx.Provider value={value}>
            {children}
        </DownloadCtx.Provider>
    )
}