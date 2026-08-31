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

export function buildInvoiceHtml(doc: InvoiceDocument, options?: { showActions?: boolean; forPdf?: boolean }) {
  const showActions = options?.showActions ?? true;
  const forPdf = options?.forPdf ?? false;
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
      @page { size:A4; margin:12mm; }
      :root{--accent:${doc.accentColor}}*{box-sizing:border-box}body{margin:0;background:#eef3f4;color:#173744;font:14px/1.5 Arial,Helvetica,sans-serif}body.pdf-export{background:white}.sheet{width:min(900px,calc(100% - 32px));margin:28px auto;padding:48px;background:white;box-shadow:0 12px 36px #17374420}body.pdf-export .sheet{width:100%;max-width:100%;margin:0;padding:0;box-shadow:none}.doc-header-text{margin:0 0 18px;padding:14px 16px;border:1px solid #dce5e8;border-radius:10px;background:#f7fafb;color:#35515d;line-height:1.65;font-size:13px}.doc-footer-image{margin-top:18px;text-align:center}.doc-footer-image img{max-width:100%;max-height:120px;object-fit:contain}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:30px;border-bottom:4px solid var(--accent);padding-bottom:24px;margin-top:4px}.logo{width:235px;max-height:72px;object-fit:contain;object-position:left;display:block}.title{text-align:right;min-width:220px}.title h1{margin:0;color:var(--accent);font-size:34px;line-height:1.1}.title b{display:block;margin-top:8px;font-size:15px;color:#173744}.title small{display:block;margin-top:6px;color:#6f838b;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin:30px 0}.grid h2{margin:0 0 8px;font-size:18px;color:#173744}.label{color:#6f838b;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px}.address{white-space:pre-line;line-height:1.6;margin:0}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px}.meta span{padding:10px;background:#f4f8f9;border-radius:6px;font-size:12px;color:#6f838b}.meta b{display:block;margin-top:4px;color:#173744;font-size:13px}table{width:100%;border-collapse:collapse;margin:24px 0;table-layout:fixed}th{background:var(--accent);color:white;text-align:left;padding:12px;font-size:12px}td{padding:13px 12px;border-bottom:1px solid #dce5e8;vertical-align:top;word-wrap:break-word}th:nth-child(2),td:nth-child(2),th:nth-child(3),td:nth-child(3),th:nth-child(4),td:nth-child(4){text-align:right;width:14%}th:first-child,td:first-child{width:58%}.totals{width:min(390px,100%);margin-left:auto;margin-top:8px}.totals p{display:flex;justify-content:space-between;gap:20px;margin:0;padding:9px 0;border-bottom:1px solid #e1e8ea}.totals .grand{color:var(--accent);font-size:20px;font-weight:bold;border-bottom:3px double var(--accent)}.details{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:34px;padding-top:22px;border-top:1px solid #dce5e8}.details p{white-space:pre-line;line-height:1.6;margin:0 0 14px}.details .label{margin-top:18px}.details .label:first-child{margin-top:0}.footer{text-align:center;margin-top:35px;color:#6b7d84;line-height:1.65}.actions{position:fixed;top:16px;right:16px}.actions button{border:0;border-radius:8px;background:var(--accent);color:white;padding:11px 16px;font-weight:bold;cursor:pointer}@media print{body{background:white}.sheet{width:100%;margin:0;box-shadow:none}.actions{display:none}}
  </style></head><body class="${forPdf ? "pdf-export" : ""}">${showActions && !forPdf ? '<div class="actions"><button onclick="window.print()">Print / Save PDF</button></div>' : ""}<main class="sheet">${headerBlock}<section class="top">${logoBlock}<div class="title"><h1>${esc(doc.title)}</h1><b>${esc(doc.invoiceNo)}</b><small>${esc(kindLabel)}</small></div></section><section class="grid"><div><p class="label">From</p><h2>${esc(doc.sellerName)}</h2><p class="address">${esc(doc.sellerAddress)}\n${esc(doc.sellerEmail)}\n${esc(doc.sellerPhone)}</p></div><div><p class="label">Bill to</p><h2>${esc(doc.clientName)}</h2><p class="address">${esc(doc.clientAddress)}\n${esc(doc.clientContact)}\n${esc(doc.clientEmail)}\n${esc(doc.clientPhone)}</p><div class="meta"><span>Invoice date<b>${esc(doc.issueDate)}</b></span><span>Due date<b>${esc(doc.dueDate)}</b></span><span>Order<b>${esc(doc.orderNo || "—")}</b></span><span>Reference<b>${esc(doc.reference || "—")}</b></span></div></div></section><table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${lineRows}</tbody></table><section class="totals"><p><span>Subtotal</span><b>${amount(doc.subtotal, doc.currency)}</b></p><p><span>Tax (${esc(doc.taxRate)}%)</span><b>${amount(doc.taxAmount, doc.currency)}</b></p><p><span>Discount</span><b>− ${amount(doc.discountAmount, doc.currency)}</b></p><p><span>Shipping</span><b>${amount(doc.shippingAmount, doc.currency)}</b></p><p class="grand"><span>Total</span><b>${amount(doc.total, doc.currency)}</b></p></section><section class="details"><div><p class="label">${esc(doc.partyBankLabel)}</p><p>${clientBankHtml}</p><p class="label">${esc(doc.companyBankLabel)}</p><p>${companyBankHtml}</p><p class="label">Tax registration</p><p>${esc(doc.taxRegistration || "Not specified")}</p></div><div><p class="label">Payment terms</p><p>${esc(doc.paymentTerms)}</p><p class="label">Notes</p><p>${esc(doc.notes || "—")}</p>${customHtml}</div></section>${footerBlock}</main></body></html>`;
}

function writeWrappedText(pdf: import("jspdf").jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight = 11) {
  const clean = String(text ?? "").trim();
  if (!clean) return y;
  const lines = pdf.splitTextToSize(clean, maxWidth);
  pdf.text(lines, x, y);
  return y + lines.length * lineHeight;
}

function drawLabel(pdf: import("jspdf").jsPDF, text: string, x: number, y: number) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(111, 131, 139);
  pdf.text(String(text).toUpperCase(), x, y);
  return y + 13;
}

function drawHeading(pdf: import("jspdf").jsPDF, text: string, x: number, y: number, maxWidth: number) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(23, 55, 68);
  const lines = pdf.splitTextToSize(String(text || "—"), maxWidth);
  pdf.text(lines, x, y);
  return y + lines.length * 13;
}

function drawBodyText(pdf: import("jspdf").jsPDF, text: string, x: number, y: number, maxWidth: number) {
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9.5);
  pdf.setTextColor(60, 80, 88);
  return writeWrappedText(pdf, text, x, y, maxWidth, 11);
}

type PdfLayout = {
  margin: number;
  pageWidth: number;
  pageHeight: number;
  contentWidth: number;
  columnGap: number;
  columnWidth: number;
  rightColumnX: number;
};

function createPdfLayout(pdf: import("jspdf").jsPDF): PdfLayout {
  const margin = 48;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const columnGap = 22;
  const contentWidth = pageWidth - margin * 2;
  const columnWidth = (contentWidth - columnGap) / 2;
  return {
    margin,
    pageWidth,
    pageHeight,
    contentWidth,
    columnGap,
    columnWidth,
    rightColumnX: margin + columnWidth + columnGap,
  };
}

function ensurePageSpace(pdf: import("jspdf").jsPDF, layout: PdfLayout, y: number, needed: number) {
  if (y + needed <= layout.pageHeight - layout.margin) return y;
  pdf.addPage();
  return layout.margin;
}

async function launchPdfBrowser() {
  const puppeteer = await import("puppeteer-core");
  if (process.platform === "linux") {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.default.launch({
      args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === "darwin" && existsSync(macChrome) ? macChrome : "");
  if (!executablePath) throw new Error("No Chromium executable available for PDF rendering");
  return puppeteer.default.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
}

async function renderHtmlToPdf(html: string) {
  const browser = await launchPdfBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    await page.emulateMediaType("print");
    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    });
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  } finally {
    await browser.close();
  }
}

async function buildInvoicePdfFallback(doc: InvoiceDocument) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const layout = createPdfLayout(pdf);
  const accent = accentRgb(doc.accentColor);
  const { margin, pageWidth, contentWidth, columnWidth, rightColumnX } = layout;
  let y = margin;

  const headerBottom = margin + 54;
  if (doc.logoDataUri) {
    try {
      pdf.addImage(doc.logoDataUri, imageFormat(doc.logoDataUri), margin, y, 138, 38);
    } catch {
      /* skip broken logo */
    }
  }

  pdf.setTextColor(accent[0], accent[1], accent[2]);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.text(doc.title, pageWidth - margin, y + 16, { align: "right", maxWidth: columnWidth + 40 });
  pdf.setFontSize(10);
  pdf.setTextColor(40, 40, 40);
  pdf.text(doc.invoiceNo, pageWidth - margin, y + 34, { align: "right" });
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.setTextColor(111, 131, 139);
  pdf.text(doc.invoiceKind === "proforma" ? "PROFORMA" : "COMMERCIAL", pageWidth - margin, y + 48, { align: "right" });
  y = headerBottom;

  pdf.setDrawColor(accent[0], accent[1], accent[2]);
  pdf.setLineWidth(2);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 22;

  if (doc.headerText.trim()) {
    y = ensurePageSpace(pdf, layout, y, 40);
    pdf.setFillColor(247, 250, 251);
    pdf.setDrawColor(220, 229, 232);
    const headerLines = pdf.splitTextToSize(doc.headerText, contentWidth - 24);
    const boxHeight = headerLines.length * 11 + 18;
    pdf.roundedRect(margin, y - 10, contentWidth, boxHeight, 4, 4, "FD");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(53, 81, 93);
    pdf.text(headerLines, margin + 12, y + 2);
    y += boxHeight + 8;
  }

  y = ensurePageSpace(pdf, layout, y, 120);
  let leftY = drawLabel(pdf, "From", margin, y);
  let rightY = drawLabel(pdf, "Bill to", rightColumnX, y);
  leftY = drawHeading(pdf, doc.sellerName, margin, leftY, columnWidth);
  rightY = drawHeading(pdf, doc.clientName, rightColumnX, rightY, columnWidth);
  leftY = drawBodyText(pdf, joinLines([doc.sellerAddress, doc.sellerEmail, doc.sellerPhone]), margin, leftY, columnWidth);
  rightY = drawBodyText(pdf, joinLines([doc.clientAddress, doc.clientContact, doc.clientEmail, doc.clientPhone]), rightColumnX, rightY, columnWidth);

  autoTable(pdf, {
    startY: rightY + 4,
    margin: { left: rightColumnX, right: margin },
    tableWidth: columnWidth,
    theme: "grid",
    styles: { fontSize: 8.5, cellPadding: 5, lineColor: [220, 229, 232], lineWidth: 0.5, textColor: [60, 80, 88] },
    body: [
      ["Invoice date", doc.issueDate],
      ["Due date", doc.dueDate],
      ["Order", doc.orderNo || "—"],
      ["Reference", doc.reference || "—"],
    ],
    columnStyles: {
      0: { cellWidth: columnWidth * 0.42, fontStyle: "bold", fillColor: [244, 248, 249] },
      1: { cellWidth: columnWidth * 0.58 },
    },
  });
  const metaFinalY = (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? rightY;
  y = Math.max(leftY, metaFinalY) + 18;

  y = ensurePageSpace(pdf, layout, y, 80);
  autoTable(pdf, {
    startY: y,
    margin: { left: margin, right: margin },
    tableWidth: contentWidth,
    head: [["Description", "Qty", "Unit price", "Amount"]],
    body: doc.lineItems.map((item) => [
      item.description,
      String(item.quantity),
      amount(item.unitPrice, doc.currency),
      amount(item.amount, doc.currency),
    ]),
    styles: { fontSize: 9, cellPadding: 7, overflow: "linebreak", valign: "top", textColor: [23, 55, 68] },
    headStyles: { fillColor: accent, textColor: [255, 255, 255], fontStyle: "bold", halign: "left" },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.48 },
      1: { cellWidth: contentWidth * 0.10, halign: "right" },
      2: { cellWidth: contentWidth * 0.21, halign: "right" },
      3: { cellWidth: contentWidth * 0.21, halign: "right" },
    },
    alternateRowStyles: { fillColor: [249, 251, 252] },
  });
  y = ((pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 16;

  y = ensurePageSpace(pdf, layout, y, 110);
  const totalsWidth = 220;
  autoTable(pdf, {
    startY: y,
    margin: { left: pageWidth - margin - totalsWidth, right: margin },
    tableWidth: totalsWidth,
    theme: "plain",
    body: [
      ["Subtotal", amount(doc.subtotal, doc.currency)],
      [`Tax (${doc.taxRate}%)`, amount(doc.taxAmount, doc.currency)],
      ["Discount", `− ${amount(doc.discountAmount, doc.currency)}`],
      ["Shipping", amount(doc.shippingAmount, doc.currency)],
      ["Total", amount(doc.total, doc.currency)],
    ],
    styles: { fontSize: 9.5, cellPadding: { top: 4, bottom: 4, left: 0, right: 0 }, textColor: [60, 80, 88] },
    columnStyles: {
      0: { cellWidth: totalsWidth * 0.55, halign: "left" },
      1: { cellWidth: totalsWidth * 0.45, halign: "right" },
    },
    didParseCell(data) {
      if (data.section === "body" && data.row.index === 4) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fontSize = 11;
        data.cell.styles.textColor = accent;
      }
    },
  });
  y = ((pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 18;

  y = ensurePageSpace(pdf, layout, y, 120);
  pdf.setDrawColor(220, 226, 232);
  pdf.setLineWidth(1);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 18;

  const drawDetailBlock = (title: string, body: string, x: number, startY: number) => {
    let blockY = drawLabel(pdf, title, x, startY);
    blockY = drawBodyText(pdf, body, x, blockY, columnWidth);
    return blockY;
  };

  let detailLeftY = drawDetailBlock(doc.partyBankLabel, joinLines(doc.clientBankLines) || "—", margin, y);
  let detailRightY = drawDetailBlock("Payment terms", doc.paymentTerms || "—", rightColumnX, y);
  y = Math.max(detailLeftY, detailRightY) + 14;

  y = ensurePageSpace(pdf, layout, y, 80);
  detailLeftY = drawDetailBlock(doc.companyBankLabel, joinLines(doc.companyBankLines) || "—", margin, y);
  detailRightY = drawDetailBlock("Notes", doc.notes || "—", rightColumnX, y);
  y = Math.max(detailLeftY, detailRightY) + 10;

  if (doc.taxRegistration.trim()) {
    y = ensurePageSpace(pdf, layout, y, 40);
    y = drawDetailBlock("Tax registration", doc.taxRegistration, margin, y) + 8;
  }

  for (const field of doc.customFields) {
    y = ensurePageSpace(pdf, layout, y, 36);
    y = drawDetailBlock(field.label, field.value, margin, y) + 8;
  }

  if (doc.footer.trim()) {
    const footerY = layout.pageHeight - 36;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(107, 125, 132);
    const footerLines = pdf.splitTextToSize(doc.footer, contentWidth);
    pdf.text(footerLines, pageWidth / 2, footerY, { align: "center" });
  }

  return pdf.output("arraybuffer");
}

export async function buildInvoicePdf(doc: InvoiceDocument) {
  const html = buildInvoiceHtml(doc, { showActions: false, forPdf: true });
  try {
    return await renderHtmlToPdf(html);
  } catch {
    return buildInvoicePdfFallback(doc);
  }
}
