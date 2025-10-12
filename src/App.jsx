import { useEffect, useState, useCallback } from "react";
import { useGoogleLogin, hasGrantedAllScopesGoogle } from "@react-oauth/google";
import FileUploader from "./components/FileUploader";
import FolderUploader from "./components/FolderUploader";
import UploadOverlay from "./components/UploadOverlay";
import useUploadManager from "./logic/useUploadManager";
import useGlobalDrop from "./dnd/useGlobalDrop.jsx";
import DropHintOverlay from "./components/DropHintOverlay.jsx";

const scopes = ["openid",
                        "email",
                        "profile",
                        "https://www.googleapis.com/auth/drive.appdata",
                        "https://www.googleapis.com/auth/drive.file",
                        "https://www.googleapis.com/auth/drive.install"]
// const SCOPES = "openid email profile https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.install";
//const SCOPES = "openid";

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

const accessToken = "ya29.a0AQQ_BDTAg5L7Fy59kOA2tXxC80Ae1gJK50s8-y0nqZ59nr1I9S876WWGekknUpWKR8j4pzdaF0ReH5ocejkpHYS6c85ur8B7hDX5t2kAmZ38mqCDLhqZJ44BDbOhx82JeUVOqunlWoo4iVh6E8nhvVBgZjJJwdFID6NICEIa0XEOUgvlFkGkJjoc_I5SbSer2_DBrfEyaCgYKAX0SARASFQHGX2Mijshz_vIm1oklBObj_6B6rg0207"

export default function App() {
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
        chunkSize: 1024 * 1024,
        concurrency: 2,
    });

    // Подключаем ГЛОБАЛЬНЫЙ drag & drop
    const { isOver } = useGlobalDrop({ accessToken, uploadManager });

    return (
        <div style={{ padding: 20, fontFamily: "roboto-mono, sans-serif" }}>
            <h2>Google Drive React Demo</h2>
            <button onClick={tryLogin}>Login with Google</button>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <FileUploader uploadManager={uploadManager} />
                <FolderUploader accessToken={accessToken} uploadManager={uploadManager} />
            </div>

            {/* Необязательный визуальный хинт во время перетаскивания */}
            <DropHintOverlay visible={isOver} />

            {/* ЕДИНЫЙ оверлей в потоке страницы, без fixed */}
            <UploadOverlay
                tasks={uploadManager.tasks}      // теперь даже если вдруг undefined, компонент сам защитится
                groups={uploadManager.groups}
                hidden={uploadManager.hidden}
                allDone={uploadManager.allDone}
                onCancelTask={uploadManager.cancelTask}
                onRemoveTask={uploadManager.removeTask}
                onCancelGroup={uploadManager.cancelGroup}
                onRemoveGroup={uploadManager.removeGroup}
                onClose={uploadManager.closePanel}
            />

        </div>
    );
}