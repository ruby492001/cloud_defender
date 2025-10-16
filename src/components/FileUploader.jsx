import React, { useRef } from "react";

export default function FileUploader({ uploadManager, className = "" }) {
    const inputRef = useRef(null);

    const openPicker = () => inputRef.current?.click();

    const onChange = (e) => {
        uploadManager.addFiles(e.target.files);
        e.target.value = "";
    };

    const buttonClass = ["btn primary", className].filter(Boolean).join(" ");

    return (
        <>
            <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={onChange} />
            <button type="button" className={buttonClass} onClick={openPicker}>
                Upload files
            </button>
        </>
    );
}
