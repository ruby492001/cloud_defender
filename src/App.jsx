import { useEffect, useState, useCallback } from "react";
import { useGoogleLogin, hasGrantedAllScopesGoogle } from "@react-oauth/google";

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

export default function App() {
    const login = useGoogleLogin({
        onSuccess: codeResponse => onSuccessLogin(codeResponse),
        flow: 'auth-code',
        scope: scopes.join(' ')
    });

   let tryLogin = () => {
       login();
    }

    return (
        <div style={{ padding: 20, fontFamily: "roboto-mono, sans-serif" }}>
            <h2>Google Drive React Demo</h2>
            <button onClick={tryLogin}>Login with Google</button>
        </div>
    );
}