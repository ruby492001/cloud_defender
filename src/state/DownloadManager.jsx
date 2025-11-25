import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'

function computeEtaFromBytes({ startedAt, loaded, total, fallbackTotal }) {
    if (!startedAt) return null;
    if (!loaded || loaded <= 0) return null;
    const target = total || fallbackTotal;
    if (!target || target <= 0) return null;
    const elapsed = (Date.now() - startedAt) / 1000;
    if (elapsed <= 0) return null;
    const speed = loaded / elapsed;
    if (!Number.isFinite(speed) || speed <= 0) return null;
    const remaining = Math.max(0, target - loaded);
    if (remaining === 0) return 0;
    return remaining / speed;
}

function computeEtaFromPercent({ startedAt, percent }) {
    if (!startedAt) return null;
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) return null;
    const ratio = percent / 100;
    const elapsed = (Date.now() - startedAt) / 1000;
    if (elapsed <= 0) return null;
    return (elapsed / ratio) * (1 - ratio);
}

const DownloadCtx = createContext(null)
export function useDownload(){ const ctx = useContext(DownloadCtx); if(!ctx) throw new Error('useDownload outside provider'); return ctx }

let seq = 0
const newTaskId = () => `dlt-${Date.now()}-${++seq}`
const INTEGRITY_ERROR_CODE = 'INTEGRITY_ERROR'
const INTEGRITY_ERROR_MESSAGE = 'Data integrity corrupted'

const savedOnce = new Set()

export function DownloadProvider({ api, children }){
    const [tasks, setTasks] = useState([])
    const running = useRef(0)
    const concurrency = 2
    const chunkConcurrency = 4
    const [dockVisible, setDockVisible] = useState(false)

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
        const startTime = Date.now()
        next.startedAt = next.startedAt ?? startTime
        next.etaSeconds = null
        setTasks(ts => ts.map(t => t.id === next.id ? { ...t, status:'running', abort: controller, startedAt: t.startedAt ?? startTime, etaSeconds: null } : t))

        try{
            if(next.kind === 'folder'){
                await downloadFolderTask(next, controller.signal)
            } else {
                await downloadFileTask(next, controller.signal)
            }
            setTasks(ts => ts.map(t => t.id === next.id ? { ...t, status:'done', progress:100, abort: undefined, etaSeconds: 0 } : t))
        }catch(e){
            if(e?.name==='AbortError'){
                setTasks(ts => ts.map(t => t.id === next.id ? { ...t, status:'canceled', abort: undefined, etaSeconds: null } : t))
            } else {
                const integrityFailure = e?.code === INTEGRITY_ERROR_CODE
                const message = integrityFailure ? INTEGRITY_ERROR_MESSAGE : (e?.message||'')
                setTasks(ts => ts.map(t => t.id === next.id ? {
                    ...t,
                    status:'error',
                    error: message,
                    integrityCorrupted: integrityFailure,
                    abort: undefined,
                    etaSeconds: null
                } : t))
            }
        } finally {
            running.current -= 1
        }
    }

    useEffect(()=>{ startNext() /* eslint-disable-line */ }, [tasks])

    const patchTask = (taskId, patch)=>{
        setTasks(ts => ts.map(t => {
            if(t.id !== taskId) return t
            const merged = { ...t, ...patch }
            if(patch?.crypto){
                merged.crypto = { ...(t.crypto||{}), ...patch.crypto }
            }
            return merged
        }))
    }

    const downloadFileTask = async (task, signal)=>{
        task.crypto = task.crypto || { uploadSession: null, downloadSession: null }
        const { blob, name, session } = await api.downloadInChunks({
            id: task.fileId,
            name: task.name,
            size: task.size ?? undefined,
            session: task.crypto?.downloadSession,
            signal,
            concurrency: chunkConcurrency,
            onProgress: (loaded, total)=>{
                setTasks(ts => ts.map(t => {
                    if(t.id !== task.id) return t
                    const totalBytes = total || task.size || t.size || 0
                    const startedAt = t.startedAt || task.startedAt || Date.now()
                    let nextProgress = t.progress
                    if(totalBytes > 0){
                        nextProgress = Math.min(100, Math.round((loaded / totalBytes) * 100))
                    }
                    const etaSeconds = computeEtaFromBytes({ startedAt, loaded, total, fallbackTotal: totalBytes })
                    return { ...t, progress: totalBytes > 0 ? nextProgress : t.progress, etaSeconds: Number.isFinite(etaSeconds) ? etaSeconds : null }
                }))
            }
        })
        if(session){
            task.crypto.downloadSession = session
            patchTask(task.id, { crypto: { downloadSession: session } })
        }
        saveBlobOnce(task.id, name, blob)
    }

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
        task.crypto = task.crypto || { uploadSession: null, downloadSession: null }
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
                concurrency: chunkConcurrency,
                onProgress: (loaded, total)=>{
                    const base = totalBytesKnown
                        ? (acc + Math.min(loaded, total || loaded)) / Math.max(totalBytes, 1)
                        : acc / Math.max(files.length, 1)
                    const clamped = Math.max(0, Math.min(base, 0.99))
                    const percent = Math.min(99, Math.round(clamped * 100))
                    setTasks(ts => ts.map(t => {
                        if(t.id !== task.id) return t
                        const startedAt = t.startedAt || task.startedAt || Date.now()
                        const etaSeconds = computeEtaFromPercent({ startedAt, percent })
                        return { ...t, progress: percent, etaSeconds: Number.isFinite(etaSeconds) ? etaSeconds : null }
                    }))
                }
            })
            const arrBuf = await blob.arrayBuffer()
            zip.file(f.path, arrBuf)
            acc += totalBytesKnown ? (size ?? arrBuf.byteLength) : 1
            const pct = totalBytesKnown ? Math.min(99, Math.round((acc/totalBytes)*100))
                : Math.min(99, Math.round((acc/files.length)*100))
            setTasks(ts => ts.map(t => {
                if(t.id !== task.id) return t
                const startedAt = t.startedAt || task.startedAt || Date.now()
                const etaSeconds = computeEtaFromPercent({ startedAt, percent: pct })
                return { ...t, progress: pct, etaSeconds: Number.isFinite(etaSeconds) ? etaSeconds : null }
            }))
        }

        const zipBlob = await zip.generateAsync({ type:'blob' })
        saveBlobOnce(task.id, `${task.name}.zip`, zipBlob)
    }

    const enqueue = (file)=>{
        setDockVisible(true)
        const baseMeta = { id: file.id, name: file.name, size: file.size }
        const downloadSession = (file?.cryptoContext?.downloadSession) || (api.createDownloadSession ? api.createDownloadSession(baseMeta) : null)
        setTasks(ts => {
            const kind = file.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file'
            const task = {
                id: newTaskId(),
                fileId: file.id,
                name: file.name,
                size: file.size? Number(file.size): undefined,
                progress: 0,
                status: 'queued',
                startedAt: null,
                etaSeconds: null,
                kind,
                crypto: { uploadSession: null, downloadSession }
            }
            return [...ts, task]
        })
    }

    const enqueueMany = (files)=> { for(const f of files) enqueue(f) }

    const cancel = (taskId)=> setTasks(ts => ts.map(t => t.id===taskId ? (t.abort?.abort(), { ...t, status: t.status==='done' ? 'done' : 'canceled', abort: undefined, etaSeconds: null }) : t))
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
