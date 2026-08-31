import { buildInvoiceHtml, buildInvoicePdf, resolveInvoiceImageDataUri, type InvoiceDocument, type InvoiceLineItem } from "../../lib/invoice-document";
import { logAudit } from "../../lib/audit";
import { authenticate, database, prepareDatabase } from "../workspace/route";

function field(snapshot: Record<string, unknown>, invoice: Record<string, unknown>, snapshotKey: string, currentKey: string, fallback = "") {
  return snapshot[snapshotKey] ?? invoice[currentKey] ?? fallback;
}

function bankLines(values: unknown[]) {
  return values.map((line) => String(line ?? "").trim()).filter(Boolean);
}

async function buildInvoiceDocument(
  invoice: Record<string, unknown>,
  items: Record<string, unknown>[],
  headerImageRaw: unknown,
  footerImageRaw: unknown,
): Promise<InvoiceDocument> {
  let snapshot: Record<string, unknown> = {};
  try { snapshot = JSON.parse(String(invoice.template_snapshot || "{}")) as Record<string, unknown>; } catch { /* ignore */ }

  let custom: Array<{ label: string; value: string }> = [];
  try { custom = JSON.parse(String(field(snapshot, invoice, "custom_fields_json", "current_custom_fields", "[]"))); } catch { /* ignore */ }

  const accent = /^#[0-9a-f]{6}$/i.test(String(field(snapshot, invoice, "accent_color", "current_accent_color")))
    ? String(field(snapshot, invoice, "accent_color", "current_accent_color"))
    : "#176f8f";

  const lineItems: InvoiceLineItem[] = items.length
    ? items.map((item) => ({
        description: String(item.description || invoice.order_description || ""),
        quantity: Number(item.quantity || 1),
        unitPrice: Number(item.unit_price || 0),
        amount: Number(item.quantity || 0) * Number(item.unit_price || 0),
      }))
    : [{
        description: String(invoice.order_description || "Invoice item"),
        quantity: 1,
        unitPrice: Number(invoice.subtotal || 0),
        amount: Number(invoice.subtotal || 0),
      }];

  const [logoDataUri, footerImageDataUri] = await Promise.all([
    resolveInvoiceImageDataUri(headerImageRaw),
    footerImageRaw ? resolveInvoiceImageDataUri(footerImageRaw, "") : Promise.resolve(""),
  ]);

  return {
    invoiceNo: String(invoice.invoice_no || ""),
    direction: String(invoice.direction || "sale"),
    title: String(field(snapshot, invoice, "title", "current_title", invoice.direction === "purchase" ? "BILL" : "INVOICE")),
    accentColor: accent,
    headerText: String(field(snapshot, invoice, "header_text", "current_header_text", "")).trim(),
    sellerName: String(field(snapshot, invoice, "seller_name", "current_seller_name", "StableCount")),
    sellerAddress: String(field(snapshot, invoice, "seller_address", "current_seller_address", "")),
    sellerEmail: String(field(snapshot, invoice, "seller_email", "current_seller_email", "")),
    sellerPhone: String(field(snapshot, invoice, "seller_phone", "current_seller_phone", "")),
    clientName: String(invoice.client_name || ""),
    clientAddress: String(invoice.client_address || ""),
    clientContact: String(invoice.client_contact || ""),
    clientEmail: String(invoice.client_email || ""),
    clientPhone: String(invoice.client_phone || ""),
    issueDate: String(invoice.issue_date || ""),
    dueDate: String(invoice.due_date || ""),
    orderNo: String(invoice.order_no || ""),
    reference: String(invoice.reference || ""),
    currency: String(invoice.currency || "RUB"),
    subtotal: Number(invoice.subtotal || 0),
    taxRate: Number(invoice.tax_rate || 0),
    taxAmount: Number(invoice.tax_amount || 0),
    discountAmount: Number(invoice.discount_amount || 0),
    shippingAmount: Number(invoice.shipping_amount || 0),
    total: Number(invoice.total || 0),
    notes: String(invoice.notes || ""),
    taxRegistration: String(field(snapshot, invoice, "tax_registration", "current_tax_registration", "Not specified")),
    paymentTerms: String(field(snapshot, invoice, "payment_terms", "current_payment_terms", "")),
    footer: String(field(snapshot, invoice, "footer", "current_footer", "Thank you for your business")),
    partyBankLabel: invoice.direction === "purchase" ? "Supplier bank account" : "Client bank account",
    companyBankLabel: invoice.direction === "purchase" ? "Your paying account" : "Your receiving account",
    clientBankLines: bankLines([
      invoice.client_beneficiary || invoice.client_name,
      invoice.client_bank_name,
      invoice.client_account,
      invoice.client_swift ? `SWIFT ${invoice.client_swift}` : "",
      invoice.client_bank_address,
    ]),
    companyBankLines: bankLines([
      field(snapshot, invoice, "bank_details", "current_bank_details", ""),
      invoice.company_account_name,
      invoice.receiving_bank,
      invoice.company_account_number || invoice.account_last4
        ? `Account ${invoice.company_account_number || `•••• ${invoice.account_last4}`}`
        : "",
      invoice.company_account_type,
      invoice.company_swift ? `SWIFT ${invoice.company_swift}` : "",
      invoice.company_ifsc ? `IFSC ${invoice.company_ifsc}` : "",
      invoice.company_bank_address,
      invoice.bank_currency,
    ]),
    customFields: custom,
    lineItems,
    logoDataUri,
    footerImageDataUri: footerImageDataUri || "",
  };
}

export async function GET(request: Request) {
  try {
    await prepareDatabase();
    const actor = await authenticate(request);
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) throw new Error("Invoice is required");

    const invoice = await database().prepare(`SELECT i.*,c.name AS client_name,c.address AS client_address,c.email AS client_email,c.phone AS client_phone,c.contact_person AS client_contact,c.beneficiary_name AS client_beneficiary,c.bank_name AS client_bank_name,c.bank_account_number AS client_account,c.bank_address AS client_bank_address,c.swift_code AS client_swift,c.inn AS client_inn,c.kpp AS client_kpp,c.ogrn AS client_ogrn,o.order_no,o.description AS order_description,b.nickname AS bank_nickname,b.bank_name AS receiving_bank,b.currency AS bank_currency,b.account_last4,b.account_number AS company_account_number,b.account_name AS company_account_name,b.bank_address AS company_bank_address,b.swift_code AS company_swift,b.ifsc_code AS company_ifsc,b.account_type AS company_account_type,t.name AS current_template_name,t.title AS current_title,t.header_text AS current_header_text,t.header_image_url AS current_header_image_url,t.seller_name AS current_seller_name,t.seller_address AS current_seller_address,t.seller_email AS current_seller_email,t.seller_phone AS current_seller_phone,t.tax_registration AS current_tax_registration,t.bank_details AS current_bank_details,t.payment_terms AS current_payment_terms,t.footer AS current_footer,t.footer_image_url AS current_footer_image_url,t.accent_color AS current_accent_color,t.custom_fields_json AS current_custom_fields FROM invoices i JOIN clients c ON c.id=i.client_id JOIN bank_accounts b ON b.id=i.bank_account_id LEFT JOIN orders o ON o.id=i.order_id LEFT JOIN invoice_templates t ON t.id=i.template_id WHERE i.id=?`).bind(id).first<Record<string, unknown>>();
    if (!invoice) return Response.json({ error: "Invoice not found" }, { status: 404 });

    const download = url.searchParams.get("download") === "1";
    await logAudit(actor.id, download ? "downloaded" : "viewed", "invoice", id, `${actor.displayName} ${download ? "downloaded" : "viewed"} ${invoice.invoice_no}`, { invoiceNo: invoice.invoice_no, mode: download ? "download" : "view" });

    const items = (await database().prepare("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id").bind(id).all()).results as Record<string, unknown>[];
    let snapshot: Record<string, unknown> = {};
    try { snapshot = JSON.parse(String(invoice.template_snapshot || "{}")) as Record<string, unknown>; } catch { /* ignore */ }

    const document = await buildInvoiceDocument(
      invoice,
      items,
      field(snapshot, invoice, "header_image_url", "current_header_image_url", ""),
      field(snapshot, invoice, "footer_image_url", "current_footer_image_url", ""),
    );

    const fileName = `${String(invoice.invoice_no).replace(/[^\w.-]+/g, "-")}.pdf`;

    if (download) {
      const pdf = await buildInvoicePdf(document);
      return new Response(pdf, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }

    const html = buildInvoiceHtml(document);
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(String(invoice.invoice_no) + ".html")}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to generate invoice" }, { status: 400 });
  }
}
