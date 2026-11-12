import React from "react";

export function IconFileGeneric(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export function IconFileText(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <line x1="8" y1="9" x2="11" y2="9" />
    </svg>
  );
}

export function IconFilePdf(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M8 13h2a1.5 1.5 0 0 1 0 3H8v-3z" />
      <path d="M14 13h1.5a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H14v-3z" />
    </svg>
  );
}

export function IconFileArchive(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="10" y1="2" x2="10" y2="8" />
      <line x1="10" y1="12" x2="10" y2="12.01" />
      <line x1="10" y1="16" x2="10" y2="16.01" />
      <rect x="8.5" y="10" width="3" height="8" rx="1" />
    </svg>
  );
}

export function IconFileSpreadsheet(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <rect x="7" y="12" width="10" height="7" rx="0.5" />
      <line x1="7" y1="15.5" x2="17" y2="15.5" />
      <line x1="12" y1="12" x2="12" y2="19" />
    </svg>
  );
}

export function IconFileVideo(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <polygon points="9,12 9,18 16,15" />
    </svg>
  );
}

export function IconFileAudio(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <circle cx="9.5" cy="17.5" r="1.5" />
      <path d="M11 17.5V12l5-1v4.5" />
    </svg>
  );
}

export function IconFileCode(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <polyline points="9,13 7,15 9,17" />
      <polyline points="15,13 17,15 15,17" />
    </svg>
  );
}

export function FileTypeIcon({ mimeType, extension }: { mimeType: string; extension: string }): React.JSX.Element {
  const ext = extension.toLowerCase();
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("video/")) return <IconFileVideo />;
  if (mime.startsWith("audio/")) return <IconFileAudio />;
  if (mime === "application/pdf" || ext === "pdf") return <IconFilePdf />;
  if (mime.includes("zip") || mime.includes("rar") || mime.includes("tar") || mime.includes("7z") ||
      ext === "zip" || ext === "rar" || ext === "gz" || ext === "tar" || ext === "7z") return <IconFileArchive />;
  if (mime.includes("spreadsheet") || mime.includes("excel") || ext === "xls" || ext === "xlsx" || ext === "csv") return <IconFileSpreadsheet />;
  if (mime.includes("word") || mime.includes("wordprocessing") || ext === "doc" || ext === "docx" || ext === "odt") return <IconFileText />;
  if (mime.includes("powerpoint") || mime.includes("presentation") || ext === "ppt" || ext === "pptx" || ext === "odp") return <IconFileGeneric />;
  if (mime.startsWith("text/") || ext === "txt" || ext === "md" || ext === "log") return <IconFileText />;
  if (["js", "ts", "jsx", "tsx", "py", "java", "go", "rb", "php", "css", "html", "json", "xml", "sh", "yaml", "yml"].includes(ext)) return <IconFileCode />;
  return <IconFileGeneric />;
}

export function IconExternalLink(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3.5" />
      <path d="M11 3h6v6" />
      <line x1="17" y1="3" x2="10" y2="10" />
    </svg>
  );
}

export function IconDownload(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="10" y1="3" x2="10" y2="13" />
      <polyline points="6,9 10,13 14,9" />
      <line x1="4" y1="16" x2="16" y2="16" />
    </svg>
  );
}

export function IconClose(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="4" x2="16" y2="16" />
      <line x1="16" y1="4" x2="4" y2="16" />
    </svg>
  );
}

export function IconZoomOut(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5" />
      <line x1="17" y1="17" x2="13" y2="13" />
      <line x1="6" y1="8.5" x2="11" y2="8.5" />
    </svg>
  );
}

export function IconZoomIn(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5" />
      <line x1="17" y1="17" x2="13" y2="13" />
      <line x1="8.5" y1="6" x2="8.5" y2="11" />
      <line x1="6" y1="8.5" x2="11" y2="8.5" />
    </svg>
  );
}

export function IconFitScreen(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3,8 3,3 8,3" />
      <polyline points="17,8 17,3 12,3" />
      <polyline points="3,12 3,17 8,17" />
      <polyline points="17,12 17,17 12,17" />
    </svg>
  );
}

export function IconMaximize(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3,8 3,3 8,3" />
      <polyline points="17,8 17,3 12,3" />
      <polyline points="3,12 3,17 8,17" />
      <polyline points="17,12 17,17 12,17" />
      <line x1="3" y1="3" x2="7.5" y2="7.5" />
      <line x1="17" y1="3" x2="12.5" y2="7.5" />
      <line x1="3" y1="17" x2="7.5" y2="12.5" />
      <line x1="17" y1="17" x2="12.5" y2="12.5" />
    </svg>
  );
}
