import {useEffect, useState, useCallback, useRef, useMemo} from "react";
import { useGoogleLogin, hasGrantedAllScopesGoogle } from "@react-oauth/google";
import FileUploader from "./components/FileUploader";
import FolderUploader from "./components/FolderUploader";
import useUploadManager from "./logic/useUploadManager";
import useGlobalDrop from "./dnd/useGlobalDrop.jsx";
import DropHintOverlay from "./components/DropHintOverlay.jsx";
import {useDrive} from "./hooks/useDrive.js";
import {DownloadProvider, useDownload} from "./state/DownloadManager.jsx";
import Toolbar from "./components/Toolbar.jsx";
import FileRow from "./components/FileRow.jsx";
import MoveCopyDialog from "./components/MoveCopyDialog.jsx";
import ContextMenu from "./components/ContextMenu.jsx";
import TransferTray from "./components/TransferTray.jsx";

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

const accessToken = "ya29.a0AQQ_BDRkANR8YuezY-mP6wuBSVSCKpluSoasp_5Rqh4PDpVo1iMt-Wth5--uyDCpGOKqI-Lr55jHBu44p5lQ5Z5xtmz_h4KmoBT6uOALh8gp0sQ13WqG3O8n58YRzgpk5GeuVVKlq96JRsyQ7yilFfsuBY56mDqT5OqHxcDhCvEBDnz8W7LkB1KaQhQU0l_cUrjUeNG3aCgYKAZMSARASFQHGX2Mi_S0LMOr98XrE4SgWSORSog0207"

export default function App() {
    const drive = useDrive(accessToken)
    const {api} = drive

    const login = useGoogleLogin({
        onSuccess: codeResponse => onSuccessLogin(codeResponse),
        flow: 'auth-code',
        scope: scopes.join(' ')
    });

    let tryLogin = () => {
        login();
    }

    const uploadManager = useUploadManager({
        accessToken,
        chunkSize: 16 * 1024 * 1024,
        concurrency: 10,
    });

    const {isOver} = useGlobalDrop({accessToken, uploadManager});

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
                          uploadManager, accessToken,
                          api, items, loading, error, currentFolder, nextPageToken,
                          loadMore, openFolder, upTo, breadcrumb, setSearch, refresh, sort, setSortBy
                      }){
        const { enqueue, enqueueMany } = useDownload()

        const [selectedIds, setSelectedIds] = useState(new Set())
        const [menu, setMenu] = useState(null) // {x,y,item?,group?}
        const [dialog, setDialog] = useState({ open:false, mode:null }) // move/copy
        const listRef = useRef(null)
        const sentinelRef = useRef(null)
        const [query, setQuery] = useState('')

        useEffect(()=>{
            const sentinel = sentinelRef.current
            if(!sentinel) return
            const io = new IntersectionObserver((entries)=>{
                for(const e of entries){ if(e.isIntersecting && nextPageToken && !loading){ loadMore() } }
            }, { root: listRef.current, rootMargin: '600px 0px' })
            io.observe(sentinel)
            return ()=> io.disconnect()
        }, [loadMore, loading, nextPageToken])

        useEffect(()=>{ const t = setTimeout(()=> setSearch(query), 300); return ()=> clearTimeout(t) }, [query, setSearch])

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

        const openMenuAt = (pt, item)=>{ setMenu({ x: pt.x, y: pt.y, item }) }
        const openRowMenu = (e, item)=>{ const pos={ x:e.clientX+window.scrollX, y:e.clientY+window.scrollY }; setMenu({ x:pos.x, y:pos.y, item, fromContext:true }) }
        const onListContext = (e)=>{ if(selectedIds.size>0){ e.preventDefault(); setMenu({ x:e.clientX+window.scrollX, y:e.clientY+window.scrollY, item:null, group:true }) } }

        const doRename = async (item)=>{
            const v = prompt('Rename item', item.name);
            if(v && v.trim()){ await api.renameFile(item.id, v.trim()); await refresh() }
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
            clearSelection()
            await refresh()
            setDialog({ open:false, mode:null })
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
                    for(const id of ids){ try{ await api.deleteFile(id) }catch{} }
                    clearSelection(); await refresh()
                }})
            return base
        }

        return (
            <div className="app">
                <Toolbar query={query} onQueryChange={setQuery} onRefresh={refresh}>
                    <FileUploader uploadManager={uploadManager} />
                    <FolderUploader accessToken={accessToken} uploadManager={uploadManager} />
                </Toolbar>

                <div className="breadcrumb">
                    {breadcrumb.map((bc, i)=> (
                        <span key={bc.id}>
            <a href="#" onClick={(e)=> { e.preventDefault(); upTo(bc.id) }}>{bc.name}</a>
                            {i < breadcrumb.length-1 && <span style={{ color:'var(--muted)' }}> / </span>}
          </span>
                    ))}
                </div>

                <div ref={listRef} className="list" onContextMenu={onListContext} onClick={()=> setMenu(null)}>
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
            <h2>Google Drive React Demo</h2>
            <button onClick={tryLogin}>Login with Google</button>
            <DropHintOverlay visible={isOver}/>

            <DownloadProvider api={api}>
                <TransferTrayConnector uploadManager={uploadManager} />
                <AppShell uploadManager={uploadManager} accessToken={accessToken} {...drive} />
            </DownloadProvider>

        </div>
    );
}


