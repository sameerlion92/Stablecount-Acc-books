"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { buildInvoiceLines, InvoiceLineGrid } from "./InvoiceLineGrid";

type Row = Record<string, string | number | boolean | null> & { id: number };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function clientBankLabel(client: Row) {
  const parts = [
    String(client.beneficiary_name || client.name || ""),
    client.bank_name ? String(client.bank_name) : "",
    client.bank_account_number ? String(client.bank_account_number) : "",
    client.swift_code ? `SWIFT ${client.swift_code}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function companyBankLabel(bank: Row) {
  const accountNumber = String(bank.account_number || "");
  const displayAccount = accountNumber || (bank.account_last4 ? `•••• ${bank.account_last4}` : "");
  const parts = [
    bank.account_name ? String(bank.account_name) : String(bank.nickname || ""),
    bank.bank_name ? String(bank.bank_name) : "",
    displayAccount,
    bank.account_type ? String(bank.account_type) : "",
    bank.swift_code ? `SWIFT ${bank.swift_code}` : "",
    bank.ifsc_code ? `IFSC ${bank.ifsc_code}` : "",
    bank.currency ? String(bank.currency) : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

export function InvoiceFormFields({
  data,
  editingInvoice,
  defaultInvoiceCurrency,
  today = todayIso(),
}: {
  data: {
    clients: Row[];
    orders: Row[];
    invoiceTemplates: Row[];
    invoiceItems: Row[];
    banks: Row[];
  };
  editingInvoice: Row | null;
  defaultInvoiceCurrency: string;
  today?: string;
}) {
  const { t } = useI18n();
  const customers = useMemo(
    () => data.clients.filter((row) => row.kind === "customer" || row.kind === "both"),
    [data.clients],
  );
  const suppliers = useMemo(
    () => data.clients.filter((row) => row.kind === "vendor" || row.kind === "both"),
    [data.clients],
  );

  const [templateId, setTemplateId] = useState(String(editingInvoice?.template_id || ""));
  const [clientId, setClientId] = useState(String(editingInvoice?.client_id || ""));
  const [orderId, setOrderId] = useState(String(editingInvoice?.order_id || ""));
  const [invoiceCurrency, setInvoiceCurrency] = useState(String(editingInvoice?.currency || defaultInvoiceCurrency));
  const [invoiceKind, setInvoiceKind] = useState(String(editingInvoice?.invoice_kind || "commercial"));

  useEffect(() => {
    setTemplateId(String(editingInvoice?.template_id || ""));
    setClientId(String(editingInvoice?.client_id || ""));
    setOrderId(String(editingInvoice?.order_id || ""));
    setInvoiceCurrency(String(editingInvoice?.currency || defaultInvoiceCurrency));
    setInvoiceKind(String(editingInvoice?.invoice_kind || "commercial"));
  }, [editingInvoice?.id, editingInvoice?.template_id, editingInvoice?.client_id, editingInvoice?.order_id, editingInvoice?.currency, editingInvoice?.invoice_kind, defaultInvoiceCurrency]);

  const selectedTemplate = data.invoiceTemplates.find((row) => row.id === Number(templateId)) || null;
  const direction = String(selectedTemplate?.direction || "sale") === "purchase" ? "purchase" : "sale";
  const partyOptions = direction === "purchase" ? suppliers : customers;
  const filteredOrders = useMemo(
    () => data.orders.filter((row) => !clientId || String(row.client_id) === clientId),
    [data.orders, clientId],
  );
  const selectedClient = data.clients.find((row) => row.id === Number(clientId)) || null;
  const defaultCompanyBank = data.banks.find((row) => row.is_default) || data.banks[0] || null;

  useEffect(() => {
    if (!clientId) return;
    if (orderId && !filteredOrders.some((row) => row.id === Number(orderId))) setOrderId("");
  }, [clientId, filteredOrders, orderId]);

  useEffect(() => {
    if (!templateId) return;
    const allowed = new Set(partyOptions.map((row) => row.id));
    if (clientId && !allowed.has(Number(clientId))) {
      setClientId("");
      setOrderId("");
    }
  }, [templateId, partyOptions, clientId]);

  return (
    <>
      {editingInvoice && <input type="hidden" name="invoiceId" value={editingInvoice.id} />}
      <label>
        {t("Invoice template")}
        <select name="templateId" required value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
          <option value="">{t("Select template")}</option>
          {data.invoiceTemplates.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </label>
      <label>
        {t("Invoice type")}
        <select name="invoiceKind" required value={invoiceKind} onChange={(event) => setInvoiceKind(event.target.value)}>
          <option value="commercial">{t("Commercial invoice")}</option>
          <option value="proforma">{t("Proforma invoice")}</option>
        </select>
      </label>
      <label>
        {t("Invoice number")}
        <input
          name="invoiceNo"
          defaultValue={editingInvoice?.invoice_no == null ? "" : String(editingInvoice.invoice_no)}
          placeholder={selectedTemplate ? `${String(selectedTemplate.number_prefix || "INV")}-0001` : t("Leave blank to auto-number")}
        />
      </label>
      <label>
        {t("Invoice date")}
        <input name="issueDate" type="date" required defaultValue={String(editingInvoice?.issue_date || today)} />
      </label>
      <label>
        {t("Due date")}
        <input name="dueDate" type="date" required defaultValue={String(editingInvoice?.due_date || today)} />
      </label>
      <label>
        {direction === "purchase" ? t("Supplier") : t("Client")}
        <select name="clientId" required value={clientId} onChange={(event) => { setClientId(event.target.value); setOrderId(""); }}>
          <option value="">{direction === "purchase" ? t("Select supplier") : t("Select client")}</option>
          {partyOptions.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </label>
      <label>
        {t("Related order")}
        <select name="orderId" value={orderId} onChange={(event) => setOrderId(event.target.value)}>
          <option value="">{t("Not selected")}</option>
          {filteredOrders.map((row) => (
            <option key={row.id} value={row.id}>{row.order_no} · {row.description}</option>
          ))}
        </select>
      </label>
      <label className="wide invoice-client-bank">
        {direction === "purchase" ? t("Supplier bank account") : t("Client bank account")}
        <output>
          {selectedClient
            ? (clientBankLabel(selectedClient) || t("No bank details entered for this party."))
            : t("Select a client or supplier to see bank details.")}
        </output>
      </label>
      <label>
        {direction === "purchase" ? t("Your paying account (ledger)") : t("Your receiving account (ledger)")}
        <select
          name="bankAccountId"
          required
          defaultValue={String(editingInvoice?.bank_account_id || defaultCompanyBank?.id || "")}
        >
          {data.banks.length === 0 ? (
            <option value="">{t("Add a bank account under Bank accounts first")}</option>
          ) : (
            data.banks.map((row) => (
              <option key={row.id} value={row.id}>
                {companyBankLabel(row)}
              </option>
            ))
          )}
        </select>
      </label>
      <label className="wide">
        {t("Reference / purchase order")}
        <input name="reference" defaultValue={editingInvoice?.reference == null ? "" : String(editingInvoice.reference)} />
      </label>
      <label>
        {t("Invoice currency")}
        <select name="currency" value={invoiceCurrency} onChange={(event) => setInvoiceCurrency(event.target.value)}>
          {["RUB", "USD", "EUR", "GBP", "CNY", "AED", "TRY", "KZT"].map((code) => (
            <option key={code} value={code}>{code}</option>
          ))}
        </select>
      </label>
      <InvoiceLineGrid
        key={String(editingInvoice?.id ?? "new")}
        initialLines={buildInvoiceLines(editingInvoice?.id, data.invoiceItems, editingInvoice)}
        currency={invoiceCurrency}
      />
      <label>
        {t("Tax rate %")}
        <input name="taxRate" type="number" step="any" defaultValue={editingInvoice?.tax_rate == null ? "" : String(editingInvoice.tax_rate)} />
      </label>
      <label>
        {t("Discount amount")}
        <input name="discountAmount" type="number" step="any" defaultValue={editingInvoice?.discount_amount == null ? "" : String(editingInvoice.discount_amount)} />
      </label>
      <label>
        {t("Shipping amount")}
        <input name="shippingAmount" type="number" step="any" defaultValue={editingInvoice?.shipping_amount == null ? "" : String(editingInvoice.shipping_amount)} />
      </label>
      <label className="wide">
        {t("Notes")}
        <textarea name="notes" rows={4} defaultValue={editingInvoice?.notes == null ? "" : String(editingInvoice.notes)} />
      </label>
    </>
  );
}
