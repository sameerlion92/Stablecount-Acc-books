"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { downloadOrderRegisterExcel, downloadOrderRegisterPdf } from "../lib/order-register-export";
import { filterOrders, orderFilterLabel, orderRegisterRow } from "../lib/order-register";
import { useI18n } from "../i18n";

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
}: {
  data: Snapshot;
  money: (value: unknown, currency?: string, user?: Row | null) => string;
  selectedOrderId: number | null;
  setSelectedOrderId: (id: number | null) => void;
  editOrder: (row: Row) => void;
  upload: (event: FormEvent<HTMLFormElement>) => void;
  removeDocument: (id: number) => void;
  removeRecord: (type: string, id: number, label: string) => void;
  post: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const user = data.currentUser;
  const [clientFilter, setClientFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  const clients = useMemo(
    () => data.clients.filter((row) => row.kind === "customer" || row.kind === "both"),
    [data.clients],
  );
  const suppliers = useMemo(
    () => data.clients.filter((row) => row.kind === "vendor" || row.kind === "both"),
    [data.clients],
  );

  const filters = useMemo(
    () => ({ clientId: clientFilter, supplierId: supplierFilter, dateFrom, dateTo, includeCancelled }),
    [clientFilter, supplierFilter, dateFrom, dateTo, includeCancelled],
  );

  const filteredOrders = useMemo(() => filterOrders(data.orders, filters), [data.orders, filters]);
  const registerRows = useMemo(() => filteredOrders.map(orderRegisterRow), [filteredOrders]);
  const filterLabel = useMemo(() => orderFilterLabel(filters), [filters]);
  const filtersActive = clientFilter !== "all" || supplierFilter !== "all" || !!dateFrom || !!dateTo || includeCancelled;

  const order = data.orders.find((row) => row.id === selectedOrderId) || filteredOrders[0] || null;
  const files = order ? data.documents.filter((file) => file.order_id === order.id) : [];

  useEffect(() => {
    if (!filteredOrders.length) {
      if (selectedOrderId !== null) setSelectedOrderId(null);
      return;
    }
    if (!selectedOrderId || !filteredOrders.some((row) => row.id === selectedOrderId)) {
      setSelectedOrderId(filteredOrders[0].id);
    }
  }, [filteredOrders, selectedOrderId, setSelectedOrderId]);

  async function handleExport(format: "pdf" | "excel") {
    setExporting(format);
    try {
      const input = {
        rows: registerRows,
        filterLabel,
        formatAmount: (value: number, currency?: string) => money(value, currency, user),
      };
      if (format === "pdf") await downloadOrderRegisterPdf(input);
      else await downloadOrderRegisterExcel(input);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="order-workspace">
      <section className="panel order-register-filters">
        <div className="bookkeeping-toolbar">
          <div className="bookkeeping-toolbar-filters order-register-filter-grid">
            <label className="bookkeeping-field">
              <span>{t("Filter by client")}</span>
              <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
                <option value="all">{t("All clients")}</option>
                {clients.map((client) => (
                  <option key={client.id} value={String(client.id)}>{client.name}</option>
                ))}
              </select>
            </label>
            <label className="bookkeeping-field">
              <span>{t("Filter by supplier")}</span>
              <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
                <option value="all">{t("All suppliers")}</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={String(supplier.id)}>{supplier.name}</option>
                ))}
              </select>
            </label>
            <label className="bookkeeping-field">
              <span>{t("From date")}</span>
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label className="bookkeeping-field">
              <span>{t("To date")}</span>
              <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} />
            </label>
            <label className="bookkeeping-field order-register-check">
              <span>{t("Status scope")}</span>
              <label className="setting-check">
                <input type="checkbox" checked={includeCancelled} onChange={(event) => setIncludeCancelled(event.target.checked)} />
                {t("Include cancelled orders")}
              </label>
            </label>
            <div className="bookkeeping-period-chip">
              <span>{t("Showing")}</span>
              <strong>{filteredOrders.length} / {data.orders.length}</strong>
            </div>
          </div>
          <div className="bookkeeping-export-actions">
            <button type="button" className="secondary-button bookkeeping-export-button" disabled={!!exporting || registerRows.length === 0} onClick={() => void handleExport("excel")}>
              {exporting === "excel" ? t("Preparing Excel…") : t("Download Excel")}
            </button>
            <button type="button" className="primary-button bookkeeping-export-button" disabled={!!exporting || registerRows.length === 0} onClick={() => void handleExport("pdf")}>
              {exporting === "pdf" ? t("Preparing PDF…") : t("Download PDF")}
            </button>
          </div>
        </div>
      </section>

      <div className="order-layout">
        <section className="panel order-index">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{t("Order register")}</p>
              <h2>{filtersActive ? `${filteredOrders.length} / ${data.orders.length}` : filteredOrders.length} {t("orders")}</h2>
            </div>
          </div>
          {filteredOrders.length === 0 ? (
            <div className="empty-state">{filtersActive ? t("No orders match these filters.") : t("Create an order from a client profile or use New order.")}</div>
          ) : (
            <div className="table-wrap order-register-table-wrap">
              <table className="order-register-table">
                <thead>
                  <tr>
                    <th>{t("Order")}</th>
                    <th>{t("Client")}</th>
                    <th>{t("Supplier")}</th>
                    <th>{t("Created")}</th>
                    <th>{t("Expected")}</th>
                    <th>{t("Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((row) => (
                    <tr key={row.id} className={order?.id === row.id ? "selected" : ""} onClick={() => setSelectedOrderId(row.id)}>
                      <td><strong>{row.order_no}</strong><small className="cell-sub">{row.description}</small></td>
                      <td>{row.client_name}</td>
                      <td>{row.supplier_name || "—"}</td>
                      <td>{String(row.created_at || "").slice(0, 10) || "—"}</td>
                      <td>{String(row.expected_date || "").slice(0, 10) || "—"}</td>
                      <td>{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                      <a className="table-action" href={`/api/documents?id=${file.id}&view=1`} target="_blank" rel="noreferrer">{t("View")}</a>
                      <a className="table-action" href={`/api/documents?id=${file.id}`}>{t("Download")}</a>
                      {data.currentUser?.role !== "operator" && (
                        <button className="delete-link" type="button" onClick={() => removeDocument(file.id)}>{t("Delete")}</button>
                      )}
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
    </div>
  );
}
