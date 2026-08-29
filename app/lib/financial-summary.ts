type MoneyRow = Record<string, string | number | boolean | null>;
type RateRow = { base_currency: string; quote_currency: string; rate: number | string; effective_date?: string };

export type FinancialSummary = {
  cash: number;
  receivables: number;
  payables: number;
  netPosition: number;
  openInvoices: number;
  bankAccounts: number;
  debtorCount: number;
  creditorCount: number;
};

function rateMapFromRows(rates: RateRow[]) {
  const map = new Map<string, number>();
  for (const row of rates) {
    const key = `${String(row.base_currency).toUpperCase()}/${String(row.quote_currency).toUpperCase()}`;
    if (!map.has(key)) map.set(key, Number(row.rate));
  }
  return map;
}

export function convertAmount(amount: number, fromCurrency: string, toCurrency: string, rates: RateRow[]) {
  const from = String(fromCurrency || toCurrency).toUpperCase();
  const to = String(toCurrency || from).toUpperCase();
  const value = Number(amount || 0);
  if (!value || from === to) return value;

  const map = rateMapFromRows(rates);
  const direct = map.get(`${from}/${to}`);
  if (direct) return value * direct;
  const inverse = map.get(`${to}/${from}`);
  if (inverse) return value / inverse;

  const viaUsd = map.get(`${from}/USD`);
  const usdTo = map.get(`USD/${to}`);
  if (viaUsd && usdTo) return value * viaUsd * usdTo;

  const viaEur = map.get(`${from}/EUR`);
  const eurTo = map.get(`EUR/${to}`);
  if (viaEur && eurTo) return value * viaEur * eurTo;

  return value;
}

function outstandingReceivable(client: MoneyRow, reportingCurrency: string, rates: RateRow[]) {
  const amount = Math.max(0, Number(client.receivable || 0));
  return convertAmount(amount, String(client.currency || reportingCurrency), reportingCurrency, rates);
}

function outstandingPayable(client: MoneyRow, reportingCurrency: string, rates: RateRow[]) {
  const amount = Math.max(0, Number(client.payable || 0));
  return convertAmount(amount, String(client.currency || reportingCurrency), reportingCurrency, rates);
}

export function buildFinancialSummary(input: {
  clients: MoneyRow[];
  banks: MoneyRow[];
  invoices: MoneyRow[];
  reportingCurrency: string;
  rates?: RateRow[];
}) {
  const { clients, banks, invoices, reportingCurrency } = input;
  const rates = input.rates ?? [];

  const cash = banks.reduce(
    (sum, bank) => sum + convertAmount(Number(bank.balance || 0), String(bank.currency || reportingCurrency), reportingCurrency, rates),
    0,
  );

  const receivables = clients.reduce((sum, client) => sum + outstandingReceivable(client, reportingCurrency, rates), 0);
  const payables = clients.reduce((sum, client) => sum + outstandingPayable(client, reportingCurrency, rates), 0);
  const netPosition = cash + receivables - payables;
  const openInvoices = invoices.filter((invoice) => String(invoice.status) !== "Paid" && String(invoice.status) !== "Cancelled").length;
  const debtorCount = clients.filter((client) => Number(client.receivable || 0) > 0).length;
  const creditorCount = clients.filter((client) => Number(client.payable || 0) > 0).length;

  return {
    cash,
    receivables,
    payables,
    netPosition,
    openInvoices,
    bankAccounts: banks.length,
    debtorCount,
    creditorCount,
  } satisfies FinancialSummary;
}
