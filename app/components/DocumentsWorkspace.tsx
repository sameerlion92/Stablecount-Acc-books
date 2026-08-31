"use client";

import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { DocumentFileActions, documentViewerTarget, formatDocumentBytes, type ViewerTarget } from "./DocumentViewer";

type Row = Record<string, string | number | boolean | null> & { id: number };
type Snapshot = {
  clients: Row[];
  orders: Row[];
  documents: Row[];
  currentUser: Row | null;
};

function documentContext(file: Row) {
  if (file.order_id) return { type: "order" as const, label: String(file.order_no || `#${file.order_id}`) };
  if (file.client_id) {
    const name = String(file.client_name || `#${file.client_id}`);
    return { type: "party" as const, label: name };
  }
  return { type: "other" as const, label: "—" };
}

export function DocumentsWorkspace({
  data,
  onView,
  removeDocument,
  setView,
  setSelectedPartyId,
  setSelectedOrderId,
}: {
  data: Snapshot;
  onView: (target: ViewerTarget) => void;
  removeDocument: (id: number) => void;
  setView: (view: "clients" | "suppliers" | "orders") => void;
  setSelectedPartyId: (id: number) => void;
  setSelectedOrderId: (id: number) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const canDelete = data.currentUser?.role !== "operator";
  const categories = useMemo(
    () => Array.from(new Set(data.documents.map((file) => String(file.category || "Other")))).sort((a, b) => a.localeCompare(b)),
    [data.documents],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.documents.filter((file) => {
      if (clientFilter !== "all" && String(file.client_id || "") !== clientFilter) return false;
      if (categoryFilter !== "all" && String(file.category || "Other") !== categoryFilter) return false;
      if (!needle) return true;
      const haystack = [
        file.file_name,
        file.category,
        file.client_name,
        file.order_no,
        file.uploaded_by,
        file.status,
      ].map((value) => String(value || "").toLowerCase()).join(" ");
      return haystack.includes(needle);
    });
  }, [data.documents, query, clientFilter, categoryFilter]);

  const openLinkedRecord = (file: Row) => {
    if (file.order_id) {
      setSelectedOrderId(Number(file.order_id));
      setView("orders");
      return;
    }
    if (file.client_id) {
      const client = data.clients.find((row) => row.id === Number(file.client_id));
      const kind = String(client?.kind || "customer");
      setSelectedPartyId(Number(file.client_id));
      setView(kind === "vendor" ? "suppliers" : "clients");
    }
  };

  return (
    <section className="panel documents-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{t("Workspace files")}</p>
          <h2>{filtered.length} / {data.documents.length} {t("uploaded files")}</h2>
        </div>
      </div>
      <div className="documents-filters">
        <label className="documents-filter-field">
          <span>{t("Search files")}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("File name, client, order, category…")} />
        </label>
        <label className="documents-filter-field">
          <span>{t("Filter by client")}</span>
          <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
            <option value="all">{t("All clients")}</option>
            {data.clients.filter((row) => row.kind !== "vendor").map((row) => (
              <option key={row.id} value={String(row.id)}>{row.name}</option>
            ))}
          </select>
        </label>
        <label className="documents-filter-field">
          <span>{t("Document type")}</span>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">{t("All types")}</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("File")}</th>
              <th>{t("Linked to")}</th>
              <th>{t("Document type")}</th>
              <th>{t("Uploaded by")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5}><div className="empty-state">{t("No files match these filters.")}</div></td></tr>
            ) : filtered.map((file) => {
              const context = documentContext(file);
              return (
                <tr key={file.id}>
                  <td>
                    <strong>{file.file_name}</strong>
                    <small className="cell-sub">{formatDocumentBytes(Number(file.size))} · {file.status}</small>
                  </td>
                  <td>
                    {context.label === "—" ? "—" : (
                      <button type="button" className="table-action linkish" onClick={() => openLinkedRecord(file)}>
                        {context.type === "order" ? `${t("Order")} ${context.label}` : context.label}
                      </button>
                    )}
                  </td>
                  <td>{file.category}</td>
                  <td>{file.uploaded_by}</td>
                  <td>
                    <DocumentFileActions
                      target={documentViewerTarget(file)}
                      onView={() => onView(documentViewerTarget(file))}
                      canDelete={canDelete}
                      onDelete={() => removeDocument(file.id)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
