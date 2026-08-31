"use client";

import { useI18n } from "../i18n";

type Row = Record<string, string | number | boolean | null> & { id: number };

export type ViewerTarget =
  | { kind: "document"; id: number; fileName: string; contentType: string }
  | { kind: "invoice"; id: number; fileName: string }
  | { kind: "template"; src: string; fileName: string; contentType?: string };

export function canPreviewInline(contentType: string) {
  return /^(application\/pdf|image\/|text\/plain)/i.test(contentType);
}

export function formatDocumentBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function viewerUrl(target: ViewerTarget) {
  if (target.kind === "document") return `/api/documents?id=${target.id}&view=1`;
  if (target.kind === "invoice") return `/api/invoices?id=${target.id}`;
  return `/api/template-assets?src=${encodeURIComponent(target.src)}`;
}

function downloadUrl(target: ViewerTarget) {
  if (target.kind === "document") return `/api/documents?id=${target.id}`;
  if (target.kind === "invoice") return `/api/invoices?id=${target.id}&download=1`;
  return viewerUrl(target);
}

function previewContentType(target: ViewerTarget) {
  if (target.kind === "template") return target.contentType || "image/png";
  if (target.kind === "invoice") return "text/html";
  return target.contentType || "application/octet-stream";
}

export function DocumentFileActions({
  target,
  onView,
  canDelete,
  onDelete,
}: {
  target: ViewerTarget;
  onView: () => void;
  canDelete?: boolean;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  return (
    <span className="row-actions document-actions">
      <button type="button" className="table-action" onClick={onView}>{t("View")}</button>
      <a className="table-action" href={downloadUrl(target)}>{t("Download")}</a>
      {canDelete && onDelete && <button type="button" className="delete-link" onClick={onDelete}>{t("Delete")}</button>}
    </span>
  );
}

export function DocumentViewerModal({ target, onClose }: { target: ViewerTarget; onClose: () => void }) {
  const { t } = useI18n();
  const url = viewerUrl(target);
  const contentType = previewContentType(target);
  const inline = canPreviewInline(contentType) || target.kind === "invoice";
  const isImage = /^image\//i.test(contentType);
  const isText = /^text\/plain/i.test(contentType);

  return (
    <div className="document-viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="document-viewer" role="dialog" aria-modal="true" aria-label={target.fileName}>
        <header className="document-viewer-head">
          <div>
            <p className="eyebrow">{target.kind === "invoice" ? t("Generated invoice") : target.kind === "template" ? t("Template image") : t("Uploaded document")}</p>
            <h2>{target.fileName}</h2>
          </div>
          <span className="document-viewer-tools">
            <a className="secondary-button small" href={downloadUrl(target)}>{t("Download")}</a>
            <button type="button" className="modal-close" onClick={onClose} aria-label={t("Close")}>×</button>
          </span>
        </header>
        <div className="document-viewer-body">
          {!inline ? (
            <div className="document-viewer-fallback">
              <p>{t("Preview is not available for this file type.")}</p>
              <a className="primary-button" href={downloadUrl(target)}>{t("Download file")}</a>
            </div>
          ) : target.kind === "invoice" || contentType === "application/pdf" ? (
            <iframe title={target.fileName} src={url} className="document-viewer-frame" />
          ) : isImage ? (
            <img src={url} alt={target.fileName} className="document-viewer-image" />
          ) : isText ? (
            <iframe title={target.fileName} src={url} className="document-viewer-frame" />
          ) : (
            <iframe title={target.fileName} src={url} className="document-viewer-frame" />
          )}
        </div>
      </section>
    </div>
  );
}

export function documentViewerTarget(file: Row): ViewerTarget {
  return {
    kind: "document",
    id: file.id,
    fileName: String(file.file_name || "Document"),
    contentType: String(file.content_type || "application/octet-stream"),
  };
}

export function invoiceViewerTarget(invoice: Row): ViewerTarget {
  return {
    kind: "invoice",
    id: invoice.id,
    fileName: String(invoice.invoice_no || "Invoice"),
  };
}
