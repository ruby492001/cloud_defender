// Хук-агрегатор логики: тек. папка, список, пагинация, поиск, сортировка, хлебные крошки
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DriveApi } from '../api/drive.js'
import GoogleCryptoApi from '../api/GoogleCryptoApi.js'

export function useDrive(token, options = {}){
    const { requestPassword, pbkdf2Iterations, pbkdf2Hash, onStorageInitStart, onStorageInitFinish } = options || {}
    const coreApi = useMemo(()=> new DriveApi(token), [token])
    const api = useMemo(()=> new GoogleCryptoApi(coreApi, {
        promptPassword: requestPassword,
        pbkdf2Iterations,
        pbkdf2Hash,
        onStorageInitStart,
        onStorageInitFinish,
    }), [coreApi, requestPassword, pbkdf2Iterations, pbkdf2Hash, onStorageInitStart, onStorageInitFinish])
    const [configReady, setConfigReady] = useState(false)
    useEffect(()=>{
        let cancelled = false
        ;(async()=>{
            try{
                await api.ensureConfigLoaded()
            }catch(e){
            }finally{
                if(!cancelled) setConfigReady(true)
            }
        })()
        return ()=>{ cancelled = true }
    }, [api])

    // Навигация
    const [currentFolder, setCurrentFolder] = useState('root')
    const [breadcrumb, setBreadcrumb] = useState([{ id:'root', name:'Мой диск' }])

    // Данные/состояния
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [nextPageToken, setNextPageToken] = useState(undefined)

    // Поиск и сортировка
    const [search, setSearch] = useState('')
    const [sort, setSort] = useState({ field:'name', dir:'asc' })

    // Первая загрузка
    useEffect(()=>{ (async()=>{ await loadMore('root', undefined, '', true) })() }, [])

    // Листинг с поддержкой пагинации и замены списка
    const loadMore = useCallback(async (folderId = currentFolder, pageToken, searchText, replace)=>{
        if(!folderId || loading) return
        setLoading(true)
        try{
            const res = await api.listFolder(folderId, pageToken ?? nextPageToken, searchText ?? search)
            setItems(prev => replace ? (res.files||[]) : [...prev, ...(res.files||[])])
            setNextPageToken(res.nextPageToken)
            setError(null)
        }catch(e){ setError(e?.message||'Ошибка загрузки') } finally{ setLoading(false) }
    }, [api, currentFolder, nextPageToken, search, loading])

    // Переключение сортировки: field + направление
    const setSortBy = useCallback((field)=>{
        setSort(prev => ({ field, dir: prev.field===field && prev.dir==='asc' ? 'desc' : 'asc' }))
    }, [])

    // Открыть папку/подняться назад
    const openFolder = useCallback(async (folder)=>{
        setBreadcrumb(prev => {
            const idx = prev.findIndex(x => x.id === folder.id)
            if(idx >= 0) return prev.slice(0, idx+1)
            return [...prev, { id: folder.id, name: folder.name }]
        })
        setItems([]); setNextPageToken(undefined); setCurrentFolder(folder.id)
        await loadMore(folder.id, undefined, search, true)
    }, [loadMore, search])

    const upTo = useCallback(async (id)=>{
        const idx = breadcrumb.findIndex(x => x.id === id)
        if(idx >= 0){
            setBreadcrumb(breadcrumb.slice(0, idx+1))
            setItems([]); setNextPageToken(undefined); setCurrentFolder(id)
            await loadMore(id, undefined, search, true)
        }
    }, [breadcrumb, loadMore, search])

    // Принудительное обновление текущей папки
    const refresh = useCallback(async ()=>{
        if(currentFolder){ setItems([]); setNextPageToken(undefined); await loadMore(currentFolder, undefined, search, true) }
    }, [currentFolder, loadMore, search])

    return { api, items, loading, error, currentFolder, nextPageToken, loadMore, openFolder, upTo, breadcrumb, setSearch, refresh, sort, setSortBy, configReady }
}
