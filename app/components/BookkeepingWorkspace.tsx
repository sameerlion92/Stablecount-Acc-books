"use client";

import { useEffect, useMemo, useState } from "react";
import { ACCOUNTING_BOOKS } from "../lib/accounting-books";
import { downloadBookExcel, downloadBookPdf, periodLabelForExport } from "../lib/bookkeeping-export";
import {
  discoverFinancialYears,
  discoverMonths,
  financialYearLabel,
  financialYearRange,
  formatMonthLabel,
  formatPeriodLabel,
  monthsBetween,
  resolvePeriodRange,
} from "../lib/bookkeeping-period";
import {
  accountsForBook,
  buildGeneralLedger,
  buildSectionBalances,
  buildTaxRegisters,
  collectBookkeepingDates,
  filterInvoicesByPeriod,
  filterJournalByBook,
  filterJournalByPeriod,
  groupJournalEntries,
  invoiceRegister,
  journalSummary,
  partyLedgers,
} from "../lib/bookkeeping";
import { filterOrders, orderFilterLabel, orderRegisterRow } from "../lib/order-register";
import { useI18n } from "../i18n";

type Row = Record<string, string | number | boolean | null> & { id: number };
type Snapshot = {
  clients: Row[];
  banks: Row[];
  orders: Row[];
  invoices: Row[];
  journal: Row[];
  currentUser: Row | null;
  reportingCurrency: string;
  summary: { receivables: number; payables: number; cash: number; openInvoices: number };
};

export function BookkeepingWorkspace({ data, money }: { data: Snapshot; money: (value: unknown, currency?: string, user?: Row | null) => string }) {
  const { t } = useI18n();
  const user = data.currentUser;
  const currency = data.reportingCurrency;
  const [activeBook, setActiveBook] = useState("journal");
  const [selectedPartyId, setSelectedPartyId] = useState<number | null>(null);
  const [financialYear, setFinancialYear] = useState(() => financialYearLabel(new Date().toISOString().slice(0, 10)));
  const [month, setMonth] = useState("all");
  const [orderClientFilter, setOrderClientFilter] = useState("all");
  const [orderSupplierFilter, setOrderSupplierFilter] = useState("all");
  const [orderDateFrom, setOrderDateFrom] = useState("");
  const [orderDateTo, setOrderDateTo] = useState("");
  const [orderIncludeCancelled, setOrderIncludeCancelled] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  const isOrderRegister = activeBook === "order-register";

  const allDates = useMemo(() => collectBookkeepingDates(data.journal, data.invoices), [data.journal, data.invoices]);
  const financialYears = useMemo(() => discoverFinancialYears(allDates), [allDates]);
  const periodRange = useMemo(() => resolvePeriodRange(financialYear, month), [financialYear, month]);
  const periodLabel = useMemo(() => formatPeriodLabel(financialYear, month), [financialYear, month]);

  useEffect(() => {
    if (financialYear === "all" || !financialYears.length) return;
    if (!financialYears.includes(financialYear)) setFinancialYear(financialYears[0]);
  }, [financialYears, financialYear]);

  const monthOptions = useMemo(() => {
    if (financialYear !== "all") {
      const range = financialYearRange(financialYear);
      return monthsBetween(range.start, range.end);
    }
    return discoverMonths(allDates);
  }, [financialYear, allDates]);

  useEffect(() => {
    if (month === "all") return;
    if (!monthOptions.includes(month)) setMonth("all");
  }, [month, monthOptions]);

  const filteredJournal = useMemo(() => filterJournalByPeriod(data.journal, periodRange), [data.journal, periodRange]);
  const filteredInvoices = useMemo(() => filterInvoicesByPeriod(data.invoices, periodRange), [data.invoices, periodRange]);

  const sections = useMemo(
    () => buildSectionBalances({ journal: filteredJournal, reportingCurrency: currency, summary: data.summary, clients: data.clients, banks: data.banks }),
    [filteredJournal, data.summary, data.clients, data.banks, currency],
  );
  const totals = useMemo(() => journalSummary(filteredJournal), [filteredJournal]);
  const journalGroups = useMemo(() => groupJournalEntries(filteredJournal), [filteredJournal]);
  const generalLedger = useMemo(() => buildGeneralLedger(filteredJournal), [filteredJournal]);
  const bookJournal = useMemo(() => filterJournalByBook(filteredJournal, activeBook), [filteredJournal, activeBook]);
  const bookAccounts = useMemo(() => accountsForBook(activeBook, sections), [activeBook, sections]);
  const salesRegister = useMemo(() => invoiceRegister(filteredInvoices, "sale"), [filteredInvoices]);
  const purchaseRegister = useMemo(() => invoiceRegister(filteredInvoices, "purchase"), [filteredInvoices]);
  const debtors = useMemo(() => partyLedgers(filteredJournal, data.clients, "debtors"), [filteredJournal, data.clients]);
  const creditors = useMemo(() => partyLedgers(filteredJournal, data.clients, "creditors"), [filteredJournal, data.clients]);
  const taxRegisters = useMemo(() => buildTaxRegisters(filteredJournal, filteredInvoices), [filteredJournal, filteredInvoices]);
  const active = ACCOUNTING_BOOKS.find((book) => book.id === activeBook) ?? ACCOUNTING_BOOKS[0];
  const selectedParty = (activeBook === "debtors-ledger" ? debtors : activeBook === "creditors-ledger" ? creditors : []).find((party) => party.id === selectedPartyId) ?? null;

  const orderClients = useMemo(
    () => data.clients.filter((row) => row.kind === "customer" || row.kind === "both"),
    [data.clients],
  );
  const orderSuppliers = useMemo(
    () => data.clients.filter((row) => row.kind === "vendor" || row.kind === "both"),
    [data.clients],
  );
  const orderFilters = useMemo(
    () => ({
      clientId: orderClientFilter,
      supplierId: orderSupplierFilter,
      dateFrom: orderDateFrom,
      dateTo: orderDateTo,
      includeCancelled: orderIncludeCancelled,
    }),
    [orderClientFilter, orderSupplierFilter, orderDateFrom, orderDateTo, orderIncludeCancelled],
  );
  const filteredOrders = useMemo(() => filterOrders(data.orders, orderFilters), [data.orders, orderFilters]);
  const orderRegister = useMemo(() => filteredOrders.map(orderRegisterRow), [filteredOrders]);
  const orderPeriodLabel = useMemo(() => orderFilterLabel(orderFilters), [orderFilters]);

  const exportInput = useMemo(() => ({
    bookId: activeBook,
    bookTitle: active.title,
    periodLabel: isOrderRegister ? orderPeriodLabel : periodLabelForExport(financialYear, month),
    financialYear,
    month,
    currency,
    journalGroups,
    generalLedger,
    bookAccounts,
    bookJournal,
    salesRegister,
    purchaseRegister,
    debtors,
    creditors,
    taxRegisters,
    banks: data.banks,
    orderRegister,
    formatAmount: (value: number, rowCurrency = currency) => money(value, rowCurrency, user),
  }), [activeBook, active.title, isOrderRegister, orderPeriodLabel, financialYear, month, currency, journalGroups, generalLedger, bookAccounts, bookJournal, salesRegister, purchaseRegister, debtors, creditors, taxRegisters, data.banks, orderRegister, money, user]);

  async function handleExport(format: "pdf" | "excel") {
    setExporting(format);
    try {
      if (format === "pdf") await downloadBookPdf(exportInput);
      else await downloadBookExcel(exportInput);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="bookkeeping-workspace">
      <section className="bookkeeping-summary">
        <article>
          <span>{t("Journal entries")}</span>
          <strong>{totals.entries}</strong>
        </article>
        <article>
          <span>{t("Total debits")}</span>
          <strong>{money(totals.debit, currency, user)}</strong>
        </article>
        <article>
          <span>{t("Total credits")}</span>
          <strong>{money(totals.credit, currency, user)}</strong>
        </article>
        <article>
          <span>{t("Reporting currency")}</span>
          <strong>{currency}</strong>
        </article>
      </section>

      <section className="panel bookkeeping-filters">
        <div className="bookkeeping-toolbar">
          <div className={`bookkeeping-toolbar-filters ${isOrderRegister ? "order-register-filter-grid" : ""}`}>
            <label className="bookkeeping-field bookkeeping-field-book">
              <span>{t("Register")}</span>
              <select value={activeBook} onChange={(event) => { setActiveBook(event.target.value); setSelectedPartyId(null); }}>
                {ACCOUNTING_BOOKS.map((book) => <option key={book.id} value={book.id}>{t(book.title)}</option>)}
              </select>
            </label>
            {isOrderRegister ? (
              <>
                <label className="bookkeeping-field">
                  <span>{t("Filter by client")}</span>
                  <select value={orderClientFilter} onChange={(event) => setOrderClientFilter(event.target.value)}>
                    <option value="all">{t("All clients")}</option>
                    {orderClients.map((client) => <option key={client.id} value={String(client.id)}>{client.name}</option>)}
                  </select>
                </label>
                <label className="bookkeeping-field">
                  <span>{t("Filter by supplier")}</span>
                  <select value={orderSupplierFilter} onChange={(event) => setOrderSupplierFilter(event.target.value)}>
                    <option value="all">{t("All suppliers")}</option>
                    {orderSuppliers.map((supplier) => <option key={supplier.id} value={String(supplier.id)}>{supplier.name}</option>)}
                  </select>
                </label>
                <label className="bookkeeping-field">
                  <span>{t("From date")}</span>
                  <input type="date" value={orderDateFrom} onChange={(event) => setOrderDateFrom(event.target.value)} />
                </label>
                <label className="bookkeeping-field">
                  <span>{t("To date")}</span>
                  <input type="date" value={orderDateTo} min={orderDateFrom || undefined} onChange={(event) => setOrderDateTo(event.target.value)} />
                </label>
                <label className="bookkeeping-field order-register-check">
                  <span>{t("Status scope")}</span>
                  <label className="setting-check">
                    <input type="checkbox" checked={orderIncludeCancelled} onChange={(event) => setOrderIncludeCancelled(event.target.checked)} />
                    {t("Include cancelled orders")}
                  </label>
                </label>
                <div className="bookkeeping-period-chip">
                  <span>{t("Showing")}</span>
                  <strong>{filteredOrders.length} / {data.orders.length}</strong>
                </div>
              </>
            ) : (
              <>
                <label className="bookkeeping-field">
                  <span>{t("Financial year")}</span>
                  <select value={financialYear} onChange={(event) => { setFinancialYear(event.target.value); setMonth("all"); setSelectedPartyId(null); }}>
                    <option value="all">{t("All years")}</option>
                    {financialYears.map((year) => <option key={year} value={year}>FY {year}</option>)}
                  </select>
                </label>
                <label className="bookkeeping-field">
                  <span>{t("Month")}</span>
                  <select value={month} onChange={(event) => { setMonth(event.target.value); setSelectedPartyId(null); }}>
                    <option value="all">{t("All months")}</option>
                    {monthOptions.map((value) => <option key={value} value={value}>{formatMonthLabel(value)}</option>)}
                  </select>
                </label>
                <div className="bookkeeping-period-chip">
                  <span>{t("Selected period")}</span>
                  <strong>{periodLabel}</strong>
                </div>
              </>
            )}
          </div>
          <div className="bookkeeping-export-actions">
            <button type="button" className="secondary-button bookkeeping-export-button" disabled={!!exporting || (isOrderRegister && orderRegister.length === 0)} onClick={() => handleExport("excel")}>{exporting === "excel" ? t("Preparing Excel…") : t("Download Excel")}</button>
            <button type="button" className="primary-button bookkeeping-export-button" disabled={!!exporting || (isOrderRegister && orderRegister.length === 0)} onClick={() => handleExport("pdf")}>{exporting === "pdf" ? t("Preparing PDF…") : t("Download PDF")}</button>
          </div>
        </div>
      </section>

      <div className="bookkeeping-main">
          <section className="panel bookkeeping-detail">
            <div className="panel-heading bookkeeping-detail-heading">
              <div>
                <p className="eyebrow">{t("Active register")}</p>
                <h2>{t(active.title)}</h2>
                <p className="bookkeeping-description">{t(active.description)} · {periodLabel}</p>
              </div>
            </div>

            {activeBook === "journal" && (
              <div className="bookkeeping-table-wrap">
                <table className="bookkeeping-table bookkeeping-table-journal">
                  <thead>
                    <tr>
                      <th>{t("Date")}</th>
                      <th>{t("Reference")}</th>
                      <th>{t("Memo")}</th>
                      <th>{t("Debit")}</th>
                      <th>{t("Credit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journalGroups.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          <div className="empty-state">{t("No journal entries for the selected period.")}</div>
                        </td>
                      </tr>
                    ) : (
                      journalGroups.map((entry) => (
                        <tr key={entry.id}>
                          <td>{entry.entry_date}</td>
                          <td>{entry.reference_type} #{entry.reference_id}</td>
                          <td>
                            <strong>{entry.memo}</strong>
                            <div className="bookkeeping-entry-lines">
                              {entry.lines.map((line, index) => (
                                <span key={`${entry.id}-${index}`}>
                                  {line.account_code} · {line.account_name}
                                  {line.client_name ? ` · ${line.client_name}` : ""}
                                  {line.debit ? ` · Dr ${money(line.debit, currency, user)}` : ""}
                                  {line.credit ? ` · Cr ${money(line.credit, currency, user)}` : ""}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>{money(entry.debit, currency, user)}</td>
                          <td>{money(entry.credit, currency, user)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeBook === "general-ledger" && (
              <div className="bookkeeping-register-stack">
                {generalLedger.length === 0 ? (
                  <div className="empty-state">{t("No ledger balances for the selected period.")}</div>
                ) : (
                  generalLedger.map((account) => (
                    <article className="bookkeeping-register-card" key={account.code}>
                      <div className="bookkeeping-register-head">
                        <span>
                          <code>{account.code}</code>
                          <strong>{t(account.name)}</strong>
                        </span>
                        <b>{money(account.balance, currency, user)}</b>
                      </div>
                      <div className="bookkeeping-account-head">
                        <span>{t("Date")}</span>
                        <span>{t("Memo")}</span>
                        <span>{t("Debit")}</span>
                        <span>{t("Credit")}</span>
                      </div>
                      {account.transactions.map((row, index) => (
                        <div className="bookkeeping-account-row" key={`${account.code}-${index}`}>
                          <span>{row.entry_date}</span>
                          <span>{row.memo}{row.client_name ? ` · ${row.client_name}` : ""}</span>
                          <span>{row.debit ? money(row.debit, currency, user) : "—"}</span>
                          <span>{row.credit ? money(row.credit, currency, user) : "—"}</span>
                        </div>
                      ))}
                    </article>
                  ))
                )}
              </div>
            )}

            {(activeBook === "cash-book" || activeBook === "bank-book" || activeBook === "fixed-asset-register" || activeBook === "inventory-records") && (
              <>
                <div className="bookkeeping-account-grid">
                  <div className="bookkeeping-account-head">
                    <span>{t("Account")}</span>
                    <span>{t("Debit")}</span>
                    <span>{t("Credit")}</span>
                    <span>{t("Balance")}</span>
                  </div>
                  {bookAccounts.map((account) => (
                    <div className="bookkeeping-account-row" key={account.code}>
                      <span>
                        <code>{account.code}</code>
                        <b>{t(account.name)}</b>
                      </span>
                      <span>{account.debit ? money(account.debit, currency, user) : "—"}</span>
                      <span>{account.credit ? money(account.credit, currency, user) : "—"}</span>
                      <span>{account.debit || account.credit ? money(account.balance, currency, user) : "—"}</span>
                    </div>
                  ))}
                </div>
                {activeBook === "bank-book" && data.banks.length > 0 && (
                  <div className="bookkeeping-party-block">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">{t("Bank accounts")}</p>
                        <h2>{data.banks.length} · {t("Current balances")}</h2>
                      </div>
                    </div>
                    {data.banks.map((bank) => (
                      <div className="bookkeeping-party-row" key={bank.id}>
                        <span>{bank.nickname || bank.bank_name}</span>
                        <strong>{money(bank.balance, String(bank.currency || currency), user)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {(activeBook === "sales-register" || activeBook === "purchase-register") && (
              <div className="bookkeeping-table-wrap">
                <table className="bookkeeping-table bookkeeping-table-register">
                  <thead>
                    <tr>
                      <th>{t("Date")}</th>
                      <th>{t("Document")}</th>
                      <th>{t("Party")}</th>
                      <th>{t("Reference")}</th>
                      <th>{t("Subtotal")}</th>
                      <th>{t("Tax")}</th>
                      <th>{t("Total")}</th>
                      <th>{t("Paid")}</th>
                      <th>{t("Status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeBook === "sales-register" ? salesRegister : purchaseRegister).length === 0 ? (
                      <tr>
                        <td colSpan={9}>
                          <div className="empty-state">{t("No documents in this register for the selected period.")}</div>
                        </td>
                      </tr>
                    ) : (
                      (activeBook === "sales-register" ? salesRegister : purchaseRegister).map((row) => (
                        <tr key={row.id}>
                          <td>{row.date}</td>
                          <td>{row.document}</td>
                          <td>{row.party}</td>
                          <td>{row.reference}</td>
                          <td>{money(row.subtotal, row.currency, user)}</td>
                          <td>{money(row.tax, row.currency, user)}</td>
                          <td>{money(row.total, row.currency, user)}</td>
                          <td>{money(row.paid, row.currency, user)}</td>
                          <td>{row.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeBook === "order-register" && (
              <div className="bookkeeping-table-wrap">
                <table className="bookkeeping-table bookkeeping-table-register">
                  <thead>
                    <tr>
                      <th>{t("Order")}</th>
                      <th>{t("Client")}</th>
                      <th>{t("Supplier")}</th>
                      <th>{t("Description")}</th>
                      <th>{t("Created")}</th>
                      <th>{t("Expected")}</th>
                      <th>{t("Purchase price")}</th>
                      <th>{t("Sale price")}</th>
                      <th>{t("Commission")}</th>
                      <th>{t("Status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderRegister.length === 0 ? (
                      <tr>
                        <td colSpan={10}>
                          <div className="empty-state">{t("No orders match these filters.")}</div>
                        </td>
                      </tr>
                    ) : (
                      orderRegister.map((row) => (
                        <tr key={row.id}>
                          <td><strong>{row.orderNo}</strong></td>
                          <td>{row.client}</td>
                          <td>{row.supplier}</td>
                          <td>{row.description}</td>
                          <td>{row.createdAt || "—"}</td>
                          <td>{row.expectedDate || "—"}</td>
                          <td>{money(row.purchasePrice, row.purchaseCurrency, user)}</td>
                          <td>{money(row.salePrice, row.saleCurrency, user)}</td>
                          <td>{row.commissionPercent.toLocaleString()}%</td>
                          <td>{row.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {(activeBook === "debtors-ledger" || activeBook === "creditors-ledger") && (
              <div className="bookkeeping-party-layout">
                <div className="bookkeeping-party-list">
                  {(activeBook === "debtors-ledger" ? debtors : creditors).map((party) => (
                    <button key={party.id} type="button" className={`bookkeeping-party-button ${selectedPartyId === party.id ? "selected" : ""}`} onClick={() => setSelectedPartyId(party.id)}>
                      <span>{party.name}</span>
                      <strong>{money(party.balance, party.currency, user)}</strong>
                    </button>
                  ))}
                  {(activeBook === "debtors-ledger" ? debtors : creditors).length === 0 && <div className="empty-state">{t("No party balances in this ledger for the selected period.")}</div>}
                </div>
                <div className="bookkeeping-party-detail">
                  {selectedParty ? (
                    <>
                      <div className="panel-heading">
                        <div>
                          <p className="eyebrow">{t("Party ledger")}</p>
                          <h2>{selectedParty.name}</h2>
                        </div>
                        <strong>{money(selectedParty.balance, selectedParty.currency, user)}</strong>
                      </div>
                      <div className="bookkeeping-table-wrap">
                        <table className="bookkeeping-table bookkeeping-table-party">
                          <thead>
                            <tr>
                              <th>{t("Date")}</th>
                              <th>{t("Memo")}</th>
                              <th>{t("Debit")}</th>
                              <th>{t("Credit")}</th>
                              <th>{t("Balance")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedParty.transactions.length === 0 ? (
                              <tr>
                                <td colSpan={5}>
                                  <div className="empty-state">{t("No postings for this party in the selected period.")}</div>
                                </td>
                              </tr>
                            ) : (
                              selectedParty.transactions.map((row, index) => (
                                <tr key={`${selectedParty.id}-${index}`}>
                                  <td>{row.entry_date}</td>
                                  <td>{row.memo}</td>
                                  <td>{row.debit ? money(row.debit, selectedParty.currency, user) : "—"}</td>
                                  <td>{row.credit ? money(row.credit, selectedParty.currency, user) : "—"}</td>
                                  <td>{money(row.balance, selectedParty.currency, user)}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">{t("Select a party to view their ledger.")}</div>
                  )}
                </div>
              </div>
            )}

            {activeBook === "tax-registers" && (
              <div className="bookkeeping-account-grid">
                <div className="bookkeeping-account-head bookkeeping-tax-head">
                  <span>{t("Account")}</span>
                  <span>{t("Debit")}</span>
                  <span>{t("Credit")}</span>
                  <span>{t("Balance")}</span>
                  <span>{t("Invoice tax in")}</span>
                  <span>{t("Invoice tax out")}</span>
                </div>
                {taxRegisters.map((row) => (
                  <div className="bookkeeping-account-row bookkeeping-tax-row" key={row.code}>
                    <span>
                      <code>{row.code}</code>
                      <b>{t(row.name)}</b>
                    </span>
                    <span>{row.debit ? money(row.debit, currency, user) : "—"}</span>
                    <span>{row.credit ? money(row.credit, currency, user) : "—"}</span>
                    <span>{row.debit || row.credit ? money(row.balance, currency, user) : "—"}</span>
                    <span>{row.invoiceTaxIn ? money(row.invoiceTaxIn, currency, user) : "—"}</span>
                    <span>{row.invoiceTaxOut ? money(row.invoiceTaxOut, currency, user) : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {activeBook !== "journal" && activeBook !== "general-ledger" && activeBook !== "sales-register" && activeBook !== "purchase-register" && activeBook !== "order-register" && activeBook !== "debtors-ledger" && activeBook !== "creditors-ledger" && activeBook !== "tax-registers" && (
            <section className="panel activity-panel bookkeeping-journal">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">{t("Related postings")}</p>
                  <h2>{bookJournal.length} {t("postings")} · {t(active.title)}</h2>
                </div>
              </div>
              <div className="bookkeeping-table-wrap">
                <table className="bookkeeping-table bookkeeping-table-postings">
                  <thead>
                    <tr>
                      <th>{t("Date")}</th>
                      <th>{t("Reference")}</th>
                      <th>{t("Account")}</th>
                      <th>{t("Client")}</th>
                      <th>{t("Debit")}</th>
                      <th>{t("Credit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookJournal.length === 0 ? (
                      <tr>
                        <td colSpan={6}>
                          <div className="empty-state">{t("No journal postings for this register in the selected period.")}</div>
                        </td>
                      </tr>
                    ) : (
                      bookJournal.map((row, index) => (
                        <tr key={`${row.id}-${index}`}>
                          <td>{row.entry_date}</td>
                          <td>{row.memo}</td>
                          <td>{row.account_code} · {row.account_name}</td>
                          <td>{row.client_name || "—"}</td>
                          <td>{Number(row.debit) ? money(row.debit, currency, user) : "—"}</td>
                          <td>{Number(row.credit) ? money(row.credit, currency, user) : "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
      </div>
    </div>
  );
}
