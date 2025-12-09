import React, { forwardRef, useImperativeHandle, useRef } from "react";

const FileUploader = forwardRef(function FileUploader(
    { uploadManager, parentId, className = "", showButton = true },
    ref
) {
    const inputRef = useRef(null);

    const openPicker = () => inputRef.current?.click();

    useImperativeHandle(ref, () => ({
        open: openPicker,
    }));

    const onChange = (e) => {
        uploadManager.addFiles(e.target.files, parentId);
        e.target.value = "";
    };

    const buttonClass = ["btn primary", className].filter(Boolean).join(" ");

    return (
        <>
            <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={onChange} />
            {showButton && (
                <button type="button" className={buttonClass} onClick={openPicker}>
                    Upload files
                </button>
            )}
        </>
    );
});

export default FileUploader;
