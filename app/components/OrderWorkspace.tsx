"use client";

import { FormEvent, useMemo } from "react";
import { useI18n } from "../i18n";
import { DocumentFileActions, documentViewerTarget, type ViewerTarget } from "./DocumentViewer";

type Row = Record<string, string | number | boolean | null> & { id: number };
type Snapshot = {
  clients: Row[];
  orders: Row[];
  documents: Row[];
  currentUser: Row | null;
};

const DOCUMENT_TYPES = [
  "Purchase invoice", "Sales invoice", "Purchase contract", "Sales contract", "Purchase order", "Sales order",
  "Purchase packing list", "Sales packing list", "Inward SWIFT", "Inward MT 103", "Outward SWIFT", "Outward MT 103",
  "Purchase AWB", "Sales AWB", "Purchase Bill of Lading", "Sales Bill of Lading", "HAWB",
];

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isActiveOrder(order: Row) {
  return String(order.status) !== "Cancelled";
}

export function OrderWorkspace({
  data,
  money,
  selectedOrderId,
  setSelectedOrderId,
  editOrder,
  upload,
  removeDocument,
  removeRecord,
  post,
  openViewer,
}: {
  data: Snapshot;
  money: (value: unknown, currency?: string, user?: Row | null) => string;
  selectedOrderId: number | null;
  setSelectedOrderId: (id: number) => void;
  editOrder: (row: Row) => void;
  upload: (event: FormEvent<HTMLFormElement>) => void;
  removeDocument: (id: number) => void;
  removeRecord: (type: string, id: number, label: string) => void;
  post: (payload: Record<string, unknown>) => Promise<unknown>;
  openViewer: (target: ViewerTarget) => void;
}) {
  const { t } = useI18n();
  const user = data.currentUser;
  const activeOrders = useMemo(() => data.orders.filter(isActiveOrder), [data.orders]);
  const order = data.orders.find((row) => row.id === selectedOrderId) || activeOrders[0] || null;
  const files = order ? data.documents.filter((file) => file.order_id === order.id) : [];

  return (
    <div className="order-layout">
      <section className="panel order-index">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t("Active orders")}</p>
            <h2>
              {activeOrders.length} {t("active")}
              {data.orders.length !== activeOrders.length ? ` · ${data.orders.length - activeOrders.length} ${t("cancelled")}` : ""}
            </h2>
          </div>
        </div>
        {activeOrders.length === 0 ? (
          <div className="empty-state">
            {data.orders.length > 0
              ? t("All orders are cancelled. Create a new order to continue.")
              : t("Create an order from a client profile or use New order.")}
          </div>
        ) : (
          activeOrders.map((row) => (
            <button
              key={row.id}
              type="button"
              className={`order-index-row ${order?.id === row.id ? "selected" : ""}`}
              onClick={() => setSelectedOrderId(row.id)}
            >
              <span>
                <strong>{row.order_no}</strong>
                <small>{row.client_name}</small>
              </span>
              <b>{row.status}</b>
            </button>
          ))
        )}
      </section>

      {order ? (
        <section className="order-detail">
          <div className="action-toolbar order-toolbar">
            <span>{order.order_no} · {order.status}</span>
            <span className="toolbar-actions">
              <button className="secondary-button" type="button" onClick={() => editOrder(order)}>{t("Edit order")}</button>
              {data.currentUser?.role !== "operator" && (
                <button className="danger-button" type="button" onClick={() => removeRecord("order", order.id, String(order.order_no))}>{t("Delete")}</button>
              )}
            </span>
          </div>
          <article className="panel order-hero">
            <div>
              <p className="eyebrow">{t("Client")}</p>
              <h2>{order.client_name}</h2>
              <span>{order.description}</span>
            </div>
            <label>
              {t("Status")}
              <select className="status-select" value={String(order.status)} onChange={(event) => void post({ action: "status", entityType: "order", entityId: order.id, status: event.target.value })}>
                <option>Confirmed</option>
                <option>In production</option>
                <option>Ready to ship</option>
                <option>Complete</option>
                <option>Cancelled</option>
              </select>
            </label>
          </article>
          <div className="order-finance-grid">
            <article><span>{t("Supplier")}</span><strong>{order.supplier_name || t("Not selected")}</strong></article>
            <article><span>{t("Purchase price")}</span><strong>{money(order.purchase_price, String(order.purchase_currency), user)}</strong></article>
            <article><span>{t("Sale price")}</span><strong>{money(order.sale_price, String(order.sale_currency), user)}</strong></article>
            <article>
              <span>{t("Commission")}</span>
              <strong>{Number(order.commission_percent || 0).toLocaleString()}%</strong>
              <small>{money(Number(order.purchase_price || 0) * Number(order.commission_percent || 0) / 100, String(order.purchase_currency), user)}</small>
            </article>
          </div>
          <div className="invoice-detail-grid">
            <article className="panel">
              <p className="eyebrow">{t("Purchase invoice details")}</p>
              <p>{order.purchase_invoice_details || t("No purchase invoice details entered.")}</p>
            </article>
            <article className="panel">
              <p className="eyebrow">{t("Sales invoice details")}</p>
              <p>{order.sales_invoice_details || t("No sales invoice details entered.")}</p>
            </article>
          </div>
          <section className="panel order-documents">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{t("Order document vault")}</p>
                <h2>{files.length} {t("uploaded files")}</h2>
              </div>
            </div>
            <form className="order-upload" onSubmit={upload}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="clientId" value={order.client_id} />
              <label>
                {t("Document type")}
                <select name="category">{DOCUMENT_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
              </label>
              <label className="file-drop">
                <input name="file" type="file" multiple required />
                <span>{t("Select as many files as needed · 25 MB each")}</span>
              </label>
              <button className="primary-button" type="submit">{t("Upload files")}</button>
            </form>
            <div className="order-files">
              {files.length === 0 ? (
                <div className="empty-state">{t("No files uploaded for this order.")}</div>
              ) : (
                files.map((file) => (
                  <article key={file.id}>
                    <span className="file-icon">▧</span>
                    <span>
                      <strong>{file.file_name}</strong>
                      <small>{file.category} · {formatBytes(Number(file.size))} · {file.uploaded_by}</small>
                    </span>
                    <DocumentFileActions
                      target={documentViewerTarget(file)}
                      onView={() => openViewer(documentViewerTarget(file))}
                      canDelete={data.currentUser?.role !== "operator"}
                      onDelete={() => removeDocument(file.id)}
                    />
                  </article>
                ))
              )}
            </div>
          </section>
        </section>
      ) : (
        <section className="panel empty-state">{t("Create an order from a client profile or use New order.")}</section>
      )}
    </div>
  );
}
