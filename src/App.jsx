import {useEffect, useState, useRef, useMemo, useCallback} from "react";
import { useGoogleLogin, hasGrantedAllScopesGoogle } from "@react-oauth/google";
import FileUploader from "./components/FileUploader";
import FolderUploader from "./components/FolderUploader";
import Toolbar from "./components/Toolbar.jsx";
import FileRow from "./components/FileRow.jsx";
import MoveCopyDialog from "./components/MoveCopyDialog.jsx";
import ContextMenu from "./components/ContextMenu.jsx";
import TransferTray from "./components/TransferTray.jsx";
import useUploadManager from "./logic/useUploadManager";
import useGlobalDrop from "./dnd/useGlobalDrop.jsx";
import DropHintOverlay from "./components/DropHintOverlay.jsx";
import {useDrive} from "./hooks/useDrive.js";
import {DownloadProvider, useDownload} from "./state/DownloadManager.jsx";
import { BusyProvider, useBusy } from "./components/BusyOverlay.jsx";
import { PasswordPromptProvider, usePasswordPrompt } from "./state/PasswordPromptProvider.jsx";
import {CryptoSuite} from "./crypto/CryptoSuite.js";
import createCfbModule from './crypto/wasm/cfb_wasm.js';

const scopes = ["openid",
                        "email",
                        "profile",
                        "https://www.googleapis.com/auth/drive.appdata",
                        "https://www.googleapis.com/auth/drive.file",
                        "https://www.googleapis.com/auth/drive.install"]

function onSuccessLogin(tokenResponse) {
    console.log(tokenResponse);
    if( hasGrantedAllScopesGoogle(tokenResponse, ...scopes))
    {
        console.log("Yes");
        return true;
    }
    console.log("NO!!!!");
    return false;
}

const accessToken = "ya29.a0ATi6K2t3zBYN3wF5Z5_c78YEiZpZ-Ul3KUgOM3KO-tkIF96S2wGrxYvQox42gltZVkXUOuNOHJdG-nrxYVJTXktcIxE_rkXA6Ks2dSYWpjUDShM3Mxe1iOy7mZtKFrogMVhLVCdCFl3Hbe6jrZV1FKu97eKXaAWBJ8N8zh8hC_JKh6snWqAsFNPbLb8iE4U9Km-5oYPm0QaCgYKAb4SARUSFQHGX2MiDJjuewjbTO7AjEClww45vg0209"

function AppContent() {
    const { requestPassword } = usePasswordPrompt();
    const [creatingStorage, setCreatingStorage] = useState(false);
    const handleStorageInitStart = useCallback(() => setCreatingStorage(true), []);
    const handleStorageInitFinish = useCallback(() => setCreatingStorage(false), []);
    const drive = useDrive(accessToken, {
        requestPassword,
        onStorageInitStart: handleStorageInitStart,
        onStorageInitFinish: handleStorageInitFinish,
    });
    const {api, loading: driveLoading, configReady} = drive
    const initStarted = useRef(false);
    const [dataLoaded, setDataLoaded] = useState(false);


    const login = useGoogleLogin({
        onSuccess: codeResponse => onSuccessLogin(codeResponse),
        flow: 'auth-code',
        scope: scopes.join(' ')
    });

    let tryLogin = () => {
        login();
    }

    useEffect(() => {
        if (initStarted.current) return;           // ������ �� �������� ������ (StrictMode/HMR)
        initStarted.current = true;

        CryptoSuite.registerSuite(
            'cfb',
            createCfbModule,
            (p) => p.endsWith('.wasm')
                ? new URL('./crypto/wasm/cfb_wasm.wasm', import.meta.url).href
                : p
        );
        (async () => {
            await CryptoSuite.ready('cfb');
        })();
    }, []);

    useEffect(() => {
        if (!configReady || dataLoaded) return;
        if (!driveLoading) {
            setDataLoaded(true);
        }
    }, [configReady, dataLoaded, driveLoading]);

    const showInitSpinner = creatingStorage || !configReady || !dataLoaded;
    const spinnerMessage = creatingStorage ? "Creating storage" : !configReady ? "Reading settings" : "Encryption";

    const uploadManager = useUploadManager({
        cryptoApi: api,
        chunkSize: 5 * 1024 * 1024,
        concurrency: 10,
        partConcurrency: 4,
    });

    const {isOver} = useGlobalDrop({ api, uploadManager });

    const TransferTrayConnector = useMemo(() => function TransferTrayConnectorInner({ uploadManager }){
        const download = useDownload()
        return (
            <TransferTray
                uploads={{
                    tasks: uploadManager.tasks,
                    groups: uploadManager.groups,
                    hidden: uploadManager.hidden,
                    allDone: uploadManager.allDone,
                    onCancelTask: uploadManager.cancelTask,
                    onRemoveTask: uploadManager.removeTask,
                    onCancelGroup: uploadManager.cancelGroup,
                    onRemoveGroup: uploadManager.removeGroup,
                    onClose: uploadManager.closePanel,
                }}
                downloads={{
                    tasks: download.tasks,
                    visible: download.dockVisible,
                    onCancel: download.cancel,
                    onRemove: download.remove,
                    onClearFinished: download.clearFinished,
                    onHide: () => download.setDockVisible(false),
                }}
            />
        )
    }, []);

    const AppShell = useMemo(() => function AppShellInner({
                          uploadManager,
                          api, items, loading, error, currentFolder, nextPageToken,
                          loadMore, openFolder, upTo, breadcrumb, refresh, sort, setSortBy
                      }){
        const { enqueue, enqueueMany } = useDownload()
        const busy = useBusy()

        const [selectedIds, setSelectedIds] = useState(new Set())
        const [menu, setMenu] = useState(null) // {x,y,item?,group?}
        const [dialog, setDialog] = useState({ open:false, mode:null }) // move/copy
        const listRef = useRef(null)
        const sentinelRef = useRef(null)
        const fileUploadRef = useRef(null)
        const folderUploadRef = useRef(null)
        const [createMenu, setCreateMenu] = useState(null)

        useEffect(()=>{
            const sentinel = sentinelRef.current
            if(!sentinel) return
            const io = new IntersectionObserver((entries)=>{
                for(const e of entries){ if(e.isIntersecting && nextPageToken && !loading){ loadMore() } }
            }, { root: listRef.current, rootMargin: '600px 0px' })
            io.observe(sentinel)
            return ()=> io.disconnect()
        }, [loadMore, loading, nextPageToken])

        const toggleSelect = (checked, it)=>{ setSelectedIds(prev => { const n = new Set(prev); if(checked) n.add(it.id); else n.delete(it.id); return n }) }
        const clearSelection = ()=> setSelectedIds(new Set())
        const allChecked = items.length>0 && items.every(i=> selectedIds.has(i.id))
        const onToggleAll = (checked)=> setSelectedIds(checked? new Set(items.map(i=> i.id)) : new Set())

        const sortedItems = useMemo(()=>{
            const arr = [...items]
            const dir = sort.dir==='asc' ? 1 : -1
            arr.sort((a,b)=>{
                if(sort.field==='name'){
                    const af = a.mimeType==='application/vnd.google-apps.folder'
                    const bf = b.mimeType==='application/vnd.google-apps.folder'
                    if(af!==bf) return -1*dir
                }
                let av, bv
                switch(sort.field){
                    case 'name': av=a.name||''; bv=b.name||''; return av.localeCompare(bv,'ru',{sensitivity:'base'})*dir
                    case 'size': av=Number(a.size||0); bv=Number(b.size||0); return (av-bv)*dir
                    case 'modifiedTime': av=new Date(a.modifiedTime||0).getTime(); bv=new Date(b.modifiedTime||0).getTime(); return (av-bv)*dir
                    default: return 0
                }
            })
            return arr
        }, [items, sort])

        const sortInd = (f)=> sort.field===f ? (sort.dir==='asc' ? '^' : 'v') : ''

        const onDouble = (it)=>{ if(it.mimeType==='application/vnd.google-apps.folder') openFolder(it); else enqueue(it) }

        const openMenuAt = (pt, item)=>{ setCreateMenu(null); setMenu({ x: pt.x, y: pt.y, item }) }
        const openRowMenu = (e, item)=>{ const pos={ x:e.clientX+window.scrollX, y:e.clientY+window.scrollY }; setCreateMenu(null); setMenu({ x:pos.x, y:pos.y, item, fromContext:true }) }
        const onListContext = (e)=>{ if(selectedIds.size>0){ e.preventDefault(); setCreateMenu(null); setMenu({ x:e.clientX+window.scrollX, y:e.clientY+window.scrollY, item:null, group:true }) } }

        const doRename = async (item)=>{
            const v = prompt('Rename item', item.name);
            if(v && v.trim()){
                const trimmed = v.trim()
                const shouldEncrypt = !(api.isExcludedName?.(trimmed))
                await api.renameFile(item.id, trimmed, { encrypted: !shouldEncrypt })
                await refresh()
            }
        }
        const copyFolderRecursive = async (sourceFolderId, sourceName, destParentId) => {
            const created = await api.createFolder(sourceName, destParentId)
            const newFolderId = created.id

            let pageToken = undefined
            do{
                const { files = [], nextPageToken } = await api.listFolder(sourceFolderId, pageToken)
                for(const it of files){
                    if(it.mimeType === 'application/vnd.google-apps.folder'){
                        await copyFolderRecursive(it.id, it.name, newFolderId)
                    } else {
                        await api.copyFile(it.id, it.name, newFolderId)
                    }
                }
                pageToken = nextPageToken
            } while(pageToken)

            return newFolderId
        }

        const confirmMoveCopy = async (destId)=>{
            const ids = dialog.targetIds
            const stopBusy = busy.start?.(dialog.mode === 'move' ? 'move' : 'copy') ?? (()=>{})
            try{
                if(dialog.mode==='move'){
                    for(const id of ids){
                        const it = items.find(x=> x.id===id)
                        const old = it?.parents?.[0]
                        await api.moveFile(id, destId, old)
                    }
                } else if(dialog.mode==='copy'){
                    for(const id of ids){
                        const it = items.find(x=> x.id===id)
                        if(!it) continue
                        if(it.mimeType === 'application/vnd.google-apps.folder'){
                            await copyFolderRecursive(it.id, it.name, destId)
                        } else {
                            await api.copyFile(it.id, it.name, destId)
                        }
                    }
                }
            } finally {
                stopBusy()
            }
            clearSelection()
            await refresh()
            setDialog({ open:false, mode:null })
        }

        const toggleCreateMenu = (event)=>{
            event.preventDefault()
            event.stopPropagation()
            if(createMenu){
                setCreateMenu(null)
                return
            }
            const rect = event.currentTarget.getBoundingClientRect()
            setMenu(null)
            setCreateMenu({
                x: rect.left + window.scrollX,
                y: rect.bottom + 6 + window.scrollY,
            })
        }

        const handleCreateFolder = async ()=>{
            const name = prompt('Folder name')
            const trimmed = name?.trim()
            if(!trimmed) return
            const stopBusy = busy.start?.('create-folder') ?? (()=>{})
            try{
                await api.createFolder(trimmed, currentFolder)
                await refresh()
            }catch(err){
                alert(err?.message || 'Failed to create folder')
            } finally {
                stopBusy()
            }
        }

        const handleUploadFile = ()=>{
            fileUploadRef.current?.open()
        }

        const handleUploadFolder = ()=>{
            folderUploadRef.current?.open()
        }

        const buildMenu = ()=>{
            const base = []
            if(menu?.item){
                base.push({ id:'open', label:'Open', onClick: ()=> onDouble(menu.item) })
                if(menu.item.mimeType === 'application/vnd.google-apps.folder'){
                    base.push({ id:'download-folder', label:'Download as zip', onClick: ()=> enqueue(menu.item) })
                } else {
                    base.push({ id:'download-one', label:'Download', onClick: ()=> enqueue(menu.item) })
                }
                base.push({ id:'rename', label:'Rename', onClick: ()=> doRename(menu.item) })
            }
            base.push({ id:'move', label:'Move', onClick: ()=> setDialog({ open:true, mode:'move', targetIds: menu?.group? [...selectedIds] : [ (menu?.item?.id) || [...selectedIds][0] ] }) })
            base.push({ id:'copy', label:'Copy', onClick: ()=> setDialog({ open:true, mode:'copy', targetIds: menu?.group? [...selectedIds] : [ (menu?.item?.id) || [...selectedIds][0] ] }) })

            if(menu?.group){
                base.push({ id:'download-multi', label:'Download selected (zip)', onClick: ()=> {
                        const sel = [...selectedIds].map(id => items.find(x=> x.id===id)).filter(Boolean)
                        enqueueMany(sel)
                    }})
            } else if(menu?.item){
                base.push({ id:'download', label:'Download', onClick: ()=> enqueue(menu.item) })
            }

            base.push({ id:'delete', label:'Delete', danger:true, onClick: async ()=>{
                    const ids = menu?.group? [...selectedIds] : [menu?.item?.id]
                    const stopBusy = busy.start?.('delete') ?? (()=>{})
                    try{
                        for(const id of ids){
                            try{
                                await api.deleteFile(id)
                            }catch(err){
                                console.error(err)
                            }
                        }
                        clearSelection();
                        await refresh()
                    } finally {
                        stopBusy()
                    }
                }})
            return base
        }

        return (
            <div className="app">
                <Toolbar onRefresh={refresh}>
                    <button className="btn primary" type="button" onClick={toggleCreateMenu}>
                        Create
                    </button>
                    <FileUploader ref={fileUploadRef} uploadManager={uploadManager} showButton={false} />
                    <FolderUploader ref={folderUploadRef} api={api} uploadManager={uploadManager} showButton={false} />
                </Toolbar>

                <div className="breadcrumb">
                    {breadcrumb.map((bc, i)=> (
                        <span key={bc.id}>
            <a href="#" onClick={(e)=> { e.preventDefault(); upTo(bc.id) }}>{bc.name}</a>
                            {i < breadcrumb.length-1 && <span style={{ color:'var(--muted)' }}> / </span>}
          </span>
                    ))}
                </div>

                <div ref={listRef} className="list" onContextMenu={onListContext} onClick={()=> { setMenu(null); setCreateMenu(null); }}>
                    <div className="row th">
                        <div>
                            <input
                                className="checkbox"
                                type="checkbox"
                                checked={allChecked}
                                onChange={e=> onToggleAll(e.target.checked)}
                                aria-label="Select all files"
                            />
                        </div>

                        <div className="sort" style={{ fontWeight:700 }} onClick={()=> setSortBy('name')}>
                            Name <span className="sort-arrow">{sortInd('name')}</span>
                        </div>
                        <div className="sort" style={{ fontWeight:700 }} onClick={()=> setSortBy('size')}>
                            Size <span className="sort-arrow">{sortInd('size')}</span>
                        </div>
                        <div className="sort" style={{ fontWeight:700 }} onClick={()=> setSortBy('modifiedTime')}>
                            Modified <span className="sort-arrow">{sortInd('modifiedTime')}</span>
                        </div>
                        <div></div>
                    </div>

                    {sortedItems.length === 0 && !loading && <div className="empty">Nothing here yet</div>}

                    {sortedItems.map(it => (
                        <FileRow
                            key={it.id}
                            item={it}
                            selected={selectedIds.has(it.id)}
                            onSelect={toggleSelect}
                            onDoubleClick={onDouble}
                            onMenu={(pt)=> openMenuAt(pt, it)}
                            onContext={openRowMenu}
                        />
                    ))}

                    <div ref={sentinelRef} className="sentinel" />
                    {loading && <div className="empty">Loading...</div>}
                    {error && <div className="empty" style={{ color:'var(--danger)' }}>{error}</div>}
                </div>

                {createMenu && (
                    <ContextMenu
                        x={createMenu.x}
                        y={createMenu.y}
                        onClose={()=> setCreateMenu(null)}
                        items={[
                            { id: 'create-folder', label: 'Create folder', onClick: handleCreateFolder },
                            { id: 'upload-file', label: 'Upload file', onClick: handleUploadFile },
                            { id: 'upload-folder', label: 'Upload folder', onClick: handleUploadFolder },
                        ]}
                    />
                )}

                {menu && <ContextMenu x={menu.x} y={menu.y} onClose={()=> setMenu(null)} items={buildMenu()} />}

                <MoveCopyDialog
                    api={api}
                    open={dialog.open}
                    mode={dialog.mode}
                    onClose={()=> setDialog({ open:false, mode:null })}
                    onConfirm={confirmMoveCopy}
                />
            </div>
        )
    }, []);

    return (
        <div style={{padding: 20, fontFamily: "roboto-mono, sans-serif"}}>
            <StartupSpinner visible={showInitSpinner} message={spinnerMessage} />
            <h2>Google Drive React Demo</h2>
            <button onClick={tryLogin}>Login with Google</button>
            <DropHintOverlay visible={isOver}/>

            <DownloadProvider api={api}>
                <TransferTrayConnector uploadManager={uploadManager} />
                <AppShell uploadManager={uploadManager} {...drive} />
            </DownloadProvider>

        </div>
    );
}





export default function App() {
    return (
        <PasswordPromptProvider>
            <BusyProvider>
                <AppContent />
            </BusyProvider>
        </PasswordPromptProvider>
    );
}

function StartupSpinner({ visible, message }) {
    if (!visible) return null;
    return (
        <div style={startupSpinnerStyles.backdrop}>
            <div style={startupSpinnerStyles.card}>
                <div style={startupSpinnerStyles.loader} />
                <div style={startupSpinnerStyles.text}>{message}</div>
            </div>
        </div>
    );
}

const startupSpinnerStyles = {
    backdrop: {
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(6px)",
        display: "grid",
        placeItems: "center",
        zIndex: 6000,
    },
    card: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        padding: "32px 48px",
        borderRadius: 20,
        background: "rgba(15, 23, 42, 0.9)",
        border: "1px solid rgba(148, 163, 184, 0.3)",
        boxShadow: "0 25px 70px rgba(0,0,0,0.6)",
        minWidth: 260,
        color: "#e5e7eb",
        fontSize: 16,
    },
    loader: {
        width: 56,
        height: 56,
        borderRadius: "50%",
        border: "6px solid rgba(148, 163, 184, 0.2)",
        borderTopColor: "#3b82f6",
        animation: "busyspin 0.9s linear infinite",
    },
    text: {
        fontSize: 18,
        fontWeight: 500,
    },
};

