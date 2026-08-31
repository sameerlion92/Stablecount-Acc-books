import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getObject } from "./storage";

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type InvoiceDocument = {
  invoiceNo: string;
  invoiceKind: string;
  direction: string;
  title: string;
  accentColor: string;
  headerText: string;
  sellerName: string;
  sellerAddress: string;
  sellerEmail: string;
  sellerPhone: string;
  clientName: string;
  clientAddress: string;
  clientContact: string;
  clientEmail: string;
  clientPhone: string;
  issueDate: string;
  dueDate: string;
  orderNo: string;
  reference: string;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountAmount: number;
  shippingAmount: number;
  total: number;
  notes: string;
  taxRegistration: string;
  paymentTerms: string;
  footer: string;
  clientBankLines: string[];
  companyBankLines: string[];
  partyBankLabel: string;
  companyBankLabel: string;
  customFields: Array<{ label: string; value: string }>;
  lineItems: InvoiceLineItem[];
  logoDataUri: string;
  footerImageDataUri: string;
};

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
const richText = (value: unknown) => esc(value).replace(/\n/g, "<br>");

function publicAssetCandidates(relativePath: string) {
  const cwd = process.cwd();
  const clean = relativePath.replace(/^\/+/, "");
  return [
    path.join(cwd, "public", clean),
    path.join(cwd, "..", "public", clean),
  ];
}

async function readPublicAsset(relativePath: string) {
  for (const filePath of publicAssetCandidates(relativePath)) {
    if (!existsSync(filePath)) continue;
    const buffer = await readFile(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/png";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  }
  return "";
}

async function readStoredAsset(raw: string) {
  const src = String(raw ?? "").trim();
  if (!src || src.startsWith("/")) return "";
  const object = await getObject(src);
  if (!object) return "";
  const buffer = Buffer.from(await new Response(object.stream).arrayBuffer());
  const contentType = object.contentType || "image/png";
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function resolveInvoiceImageDataUri(raw: unknown, fallbackRelative = "/stablecount-logo.png") {
  const src = String(raw ?? "").trim();
  if (src.startsWith("data:")) return src;
  if (src.startsWith("/")) {
    const embedded = await readPublicAsset(src);
    if (embedded) return embedded;
  }
  if (src) {
    const embedded = await readStoredAsset(src);
    if (embedded) return embedded;
  }
  if (!fallbackRelative) return "";
  return readPublicAsset(fallbackRelative);
}

function amount(value: unknown, currency: unknown) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: String(currency || "RUB") }).format(Number(value || 0));
}

function accentRgb(accent: string) {
  const hex = /^#[0-9a-f]{6}$/i.test(accent) ? accent.slice(1) : "176f8f";
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ] as [number, number, number];
}

function imageFormat(dataUri: string): "PNG" | "JPEG" {
  if (/^data:image\/jpe?g/i.test(dataUri)) return "JPEG";
  return "PNG";
}

function joinLines(lines: string[]) {
  return lines.filter((line) => line.trim()).join("\n");
}

export function buildInvoiceHtml(doc: InvoiceDocument, options?: { showActions?: boolean }) {
  const showActions = options?.showActions ?? true;
  const headerBlock = doc.headerText ? `<section class="doc-header-text">${richText(doc.headerText)}</section>` : "";
  const footerBlock = [
    `<p class="footer">${richText(doc.footer || "Thank you for your business")}</p>`,
    doc.footerImageDataUri ? `<section class="doc-footer-image"><img src="${doc.footerImageDataUri}" alt="Footer"/></section>` : "",
  ].join("");
  const logoBlock = doc.logoDataUri ? `<img class="logo" src="${doc.logoDataUri}" alt="Logo">` : "";
  const clientBankHtml = doc.clientBankLines.length ? doc.clientBankLines.map((line) => esc(line)).join("<br>") : "—";
  const companyBankHtml = doc.companyBankLines.length ? doc.companyBankLines.map((line) => esc(line)).join("<br>") : "—";
  const lineRows = doc.lineItems.map((item) => `<tr><td>${esc(item.description)}</td><td>${esc(item.quantity)}</td><td>${amount(item.unitPrice, doc.currency)}</td><td>${amount(item.amount, doc.currency)}</td></tr>`).join("");
  const customHtml = doc.customFields.map((entry) => `<p class="label">${esc(entry.label)}</p><p>${esc(entry.value)}</p>`).join("");
  const kindLabel = doc.invoiceKind === "proforma" ? "Proforma" : "Commercial";

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.invoiceNo)}</title><style>
      :root{--accent:${doc.accentColor}}*{box-sizing:border-box}body{margin:0;background:#eef3f4;color:#173744;font:14px Arial,sans-serif}.sheet{width:min(900px,calc(100% - 32px));margin:28px auto;padding:48px;background:white;box-shadow:0 12px 36px #17374420}.doc-header-text{margin:0 0 18px;padding:14px 16px;border:1px solid #dce5e8;border-radius:10px;background:#f7fafb;color:#35515d;line-height:1.65;font-size:13px}.doc-footer-image{margin-top:18px;text-align:center}.doc-footer-image img{max-width:100%;max-height:120px;object-fit:contain}.top{display:flex;justify-content:space-between;gap:30px;border-bottom:4px solid var(--accent);padding-bottom:24px;margin-top:4px}.logo{width:235px;max-height:72px;object-fit:contain;object-position:left;display:block}.title{text-align:right}.title h1{margin:0;color:var(--accent);font-size:34px}.title b{display:block;margin-top:8px}.title small{display:block;margin-top:6px;color:#6f838b;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin:30px 0}.label{color:#6f838b;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em}.address{white-space:pre-line;line-height:1.6}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px}.meta span{padding:10px;background:#f4f8f9}.meta b{display:block;margin-top:4px}table{width:100%;border-collapse:collapse;margin:24px 0}th{background:var(--accent);color:white;text-align:left;padding:12px}td{padding:13px 12px;border-bottom:1px solid #dce5e8}th:last-child,td:last-child{text-align:right}.totals{width:min(390px,100%);margin-left:auto}.totals p{display:flex;justify-content:space-between;margin:0;padding:9px 0;border-bottom:1px solid #e1e8ea}.totals .grand{color:var(--accent);font-size:20px;font-weight:bold;border-bottom:3px double var(--accent)}.details{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:34px;padding-top:22px;border-top:1px solid #dce5e8}.details p{white-space:pre-line;line-height:1.6}.footer{text-align:center;margin-top:35px;color:#6b7d84;line-height:1.65}.actions{position:fixed;top:16px;right:16px}.actions button{border:0;border-radius:8px;background:var(--accent);color:white;padding:11px 16px;font-weight:bold;cursor:pointer}@media(max-width:650px){.sheet{padding:24px}.top,.grid,.details{grid-template-columns:1fr;display:grid}.title{text-align:left}}@media print{body{background:white}.sheet{width:100%;margin:0;box-shadow:none}.actions{display:none}}
  </style></head><body>${showActions ? '<div class="actions"><button onclick="window.print()">Print / Save PDF</button></div>' : ""}<main class="sheet">${headerBlock}<section class="top">${logoBlock}<div class="title"><h1>${esc(doc.title)}</h1><b>${esc(doc.invoiceNo)}</b><small>${esc(kindLabel)}</small></div></section><section class="grid"><div><p class="label">From</p><h2>${esc(doc.sellerName)}</h2><p class="address">${esc(doc.sellerAddress)}\n${esc(doc.sellerEmail)}\n${esc(doc.sellerPhone)}</p></div><div><p class="label">Bill to</p><h2>${esc(doc.clientName)}</h2><p class="address">${esc(doc.clientAddress)}\n${esc(doc.clientContact)}\n${esc(doc.clientEmail)}\n${esc(doc.clientPhone)}</p><div class="meta"><span>Invoice date<b>${esc(doc.issueDate)}</b></span><span>Due date<b>${esc(doc.dueDate)}</b></span><span>Order<b>${esc(doc.orderNo || "—")}</b></span><span>Reference<b>${esc(doc.reference || "—")}</b></span></div></div></section><table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${lineRows}</tbody></table><section class="totals"><p><span>Subtotal</span><b>${amount(doc.subtotal, doc.currency)}</b></p><p><span>Tax (${esc(doc.taxRate)}%)</span><b>${amount(doc.taxAmount, doc.currency)}</b></p><p><span>Discount</span><b>− ${amount(doc.discountAmount, doc.currency)}</b></p><p><span>Shipping</span><b>${amount(doc.shippingAmount, doc.currency)}</b></p><p class="grand"><span>Total</span><b>${amount(doc.total, doc.currency)}</b></p></section><section class="details"><div><p class="label">${esc(doc.partyBankLabel)}</p><p>${clientBankHtml}</p><p class="label">${esc(doc.companyBankLabel)}</p><p>${companyBankHtml}</p><p class="label">Tax registration</p><p>${esc(doc.taxRegistration || "Not specified")}</p></div><div><p class="label">Payment terms</p><p>${esc(doc.paymentTerms)}</p><p class="label">Notes</p><p>${esc(doc.notes || "—")}</p>${customHtml}</div></section>${footerBlock}</main></body></html>`;
}

function writeWrappedText(pdf: import("jspdf").jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight = 12) {
  const lines = pdf.splitTextToSize(text, maxWidth);
  pdf.text(lines, x, y);
  return y + lines.length * lineHeight;
}

export async function buildInvoicePdf(doc: InvoiceDocument) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const margin = 42;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const contentWidth = pageWidth - margin * 2;
  const accent = accentRgb(doc.accentColor);
  let y = margin;

  if (doc.logoDataUri) {
    try {
      pdf.addImage(doc.logoDataUri, imageFormat(doc.logoDataUri), margin, y, 150, 42);
    } catch {
      /* skip broken logo */
    }
  }

  pdf.setTextColor(accent[0], accent[1], accent[2]);
  pdf.setFontSize(24);
  pdf.text(doc.title, pageWidth - margin, y + 18, { align: "right" });
  pdf.setFontSize(11);
  pdf.setTextColor(40, 40, 40);
  pdf.text(doc.invoiceNo, pageWidth - margin, y + 36, { align: "right" });
  pdf.setFontSize(9);
  pdf.setTextColor(111, 131, 139);
  pdf.text(doc.invoiceKind === "proforma" ? "PROFORMA" : "COMMERCIAL", pageWidth - margin, y + 50, { align: "right" });
  y += 58;

  pdf.setDrawColor(accent[0], accent[1], accent[2]);
  pdf.setLineWidth(2);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 24;

  if (doc.headerText.trim()) {
    pdf.setFontSize(10);
    pdf.setTextColor(53, 81, 93);
    y = writeWrappedText(pdf, doc.headerText, margin, y, contentWidth, 12) + 8;
  }

  const columnWidth = (contentWidth - 24) / 2;
  pdf.setFontSize(9);
  pdf.setTextColor(111, 131, 139);
  pdf.text("FROM", margin, y);
  pdf.text("BILL TO", margin + columnWidth + 24, y);
  y += 14;

  pdf.setFontSize(12);
  pdf.setTextColor(23, 55, 68);
  pdf.text(doc.sellerName, margin, y);
  pdf.text(doc.clientName, margin + columnWidth + 24, y);
  y += 16;

  pdf.setFontSize(10);
  pdf.setTextColor(60, 80, 88);
  const fromLines = joinLines([doc.sellerAddress, doc.sellerEmail, doc.sellerPhone]);
  const billLines = joinLines([doc.clientAddress, doc.clientContact, doc.clientEmail, doc.clientPhone]);
  const fromHeight = pdf.splitTextToSize(fromLines, columnWidth).length * 12;
  const billHeight = pdf.splitTextToSize(billLines, columnWidth).length * 12;
  writeWrappedText(pdf, fromLines, margin, y, columnWidth, 12);
  writeWrappedText(pdf, billLines, margin + columnWidth + 24, y, columnWidth, 12);
  y += Math.max(fromHeight, billHeight) + 16;

  pdf.setFontSize(9);
  pdf.setTextColor(80, 96, 104);
  pdf.text(`Invoice date: ${doc.issueDate}`, margin, y);
  pdf.text(`Due date: ${doc.dueDate}`, margin + 150, y);
  pdf.text(`Order: ${doc.orderNo || "—"}`, margin + 300, y);
  y += 14;
  pdf.text(`Reference: ${doc.reference || "—"}`, margin, y);
  y += 18;

  autoTable(pdf, {
    startY: y,
    head: [["Description", "Qty", "Unit price", "Amount"]],
    body: doc.lineItems.map((item) => [
      item.description,
      String(item.quantity),
      amount(item.unitPrice, doc.currency),
      amount(item.amount, doc.currency),
    ]),
    styles: { fontSize: 9, cellPadding: 6 },
    headStyles: { fillColor: accent, textColor: [255, 255, 255] },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
    },
    margin: { left: margin, right: margin },
  });

  y = ((pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 18;
  const totalsX = pageWidth - margin - 180;
  const totals = [
    ["Subtotal", amount(doc.subtotal, doc.currency)],
    [`Tax (${doc.taxRate}%)`, amount(doc.taxAmount, doc.currency)],
    ["Discount", `− ${amount(doc.discountAmount, doc.currency)}`],
    ["Shipping", amount(doc.shippingAmount, doc.currency)],
    ["Total", amount(doc.total, doc.currency)],
  ];
  pdf.setFontSize(10);
  for (const [label, value] of totals) {
    pdf.setTextColor(80, 96, 104);
    pdf.text(label, totalsX, y);
    pdf.setTextColor(label === "Total" ? accent[0] : 23, label === "Total" ? accent[1] : 55, label === "Total" ? accent[2] : 68);
    pdf.text(value, pageWidth - margin, y, { align: "right" });
    y += label === "Total" ? 18 : 14;
  }

  y += 10;
  pdf.setDrawColor(220, 226, 232);
  pdf.setLineWidth(1);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 18;

  pdf.setFontSize(9);
  pdf.setTextColor(111, 131, 139);
  pdf.text(doc.partyBankLabel.toUpperCase(), margin, y);
  pdf.text("PAYMENT TERMS", margin + columnWidth + 24, y);
  y += 14;
  pdf.setFontSize(10);
  pdf.setTextColor(60, 80, 88);
  const clientBank = joinLines(doc.clientBankLines) || "—";
  const paymentTerms = doc.paymentTerms || "—";
  const leftHeight = pdf.splitTextToSize(clientBank, columnWidth).length * 12;
  const rightHeight = pdf.splitTextToSize(paymentTerms, columnWidth).length * 12;
  writeWrappedText(pdf, clientBank, margin, y, columnWidth, 12);
  writeWrappedText(pdf, paymentTerms, margin + columnWidth + 24, y, columnWidth, 12);
  y += Math.max(leftHeight, rightHeight) + 16;

  pdf.setFontSize(9);
  pdf.setTextColor(111, 131, 139);
  pdf.text(doc.companyBankLabel.toUpperCase(), margin, y);
  pdf.text("NOTES", margin + columnWidth + 24, y);
  y += 14;
  pdf.setFontSize(10);
  pdf.setTextColor(60, 80, 88);
  writeWrappedText(pdf, joinLines(doc.companyBankLines) || "—", margin, y, columnWidth, 12);
  writeWrappedText(pdf, doc.notes || "—", margin + columnWidth + 24, y, columnWidth, 12);

  if (doc.footer.trim()) {
    pdf.setFontSize(9);
    pdf.setTextColor(107, 125, 132);
    pdf.text(doc.footer, pageWidth / 2, pdf.internal.pageSize.getHeight() - 28, { align: "center", maxWidth: contentWidth });
  }

  return pdf.output("arraybuffer");
}
