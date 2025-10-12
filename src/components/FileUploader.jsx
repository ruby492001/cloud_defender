import React, { useRef } from "react";

export default function FileUploader({ uploadManager }) {
    const inputRef = useRef(null);
    const openPicker = () => inputRef.current?.click();

    function onChange(e) {
        uploadManager.addFiles(e.target.files);
        e.target.value = "";
    }

    return (
        <div>
            <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={onChange} />
            <button
                onClick={openPicker}
                style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #ddd", background: "white", cursor: "pointer" }}
            >
                Загрузить файлы в Google Drive
            </button>
        </div>
    );
}
