import { dateKey, isDateInRange, type DateRange } from "./bookkeeping-period";

type OrderRow = Record<string, string | number | boolean | null> & { id: number };

export type OrderRegisterFilters = {
  clientId: string;
  supplierId: string;
  dateFrom: string;
  dateTo: string;
  includeCancelled: boolean;
};

export type OrderRegisterRow = {
  id: number;
  orderNo: string;
  client: string;
  supplier: string;
  description: string;
  status: string;
  createdAt: string;
  expectedDate: string;
  purchasePrice: number;
  purchaseCurrency: string;
  salePrice: number;
  saleCurrency: string;
  commissionPercent: number;
};

export function orderRegisterRow(order: OrderRow): OrderRegisterRow {
  return {
    id: order.id,
    orderNo: String(order.order_no || ""),
    client: String(order.client_name || ""),
    supplier: String(order.supplier_name || "—"),
    description: String(order.description || ""),
    status: String(order.status || ""),
    createdAt: dateKey(order.created_at),
    expectedDate: dateKey(order.expected_date),
    purchasePrice: Number(order.purchase_price || 0),
    purchaseCurrency: String(order.purchase_currency || "RUB"),
    salePrice: Number(order.sale_price || 0),
    saleCurrency: String(order.sale_currency || "RUB"),
    commissionPercent: Number(order.commission_percent || 0),
  };
}

export function filterOrders(orders: OrderRow[], filters: OrderRegisterFilters) {
  const range: DateRange | null = filters.dateFrom || filters.dateTo
    ? { start: filters.dateFrom || "1970-01-01", end: filters.dateTo || "9999-12-31" }
    : null;

  return orders.filter((order) => {
    if (!filters.includeCancelled && String(order.status) === "Cancelled") return false;
    if (filters.clientId !== "all" && Number(order.client_id) !== Number(filters.clientId)) return false;
    if (filters.supplierId !== "all") {
      const supplierId = Number(order.supplier_id || 0);
      if (supplierId !== Number(filters.supplierId)) return false;
    }
    const created = dateKey(order.created_at);
    if (range && created && !isDateInRange(created, range)) return false;
    return true;
  });
}

export function orderFilterLabel(filters: OrderRegisterFilters) {
  const parts: string[] = [];
  if (filters.clientId !== "all") parts.push("client");
  if (filters.supplierId !== "all") parts.push("supplier");
  if (filters.dateFrom || filters.dateTo) parts.push(`${filters.dateFrom || "…"}–${filters.dateTo || "…"}`);
  if (filters.includeCancelled) parts.push("cancelled included");
  return parts.length ? parts.join(" · ") : "All orders";
}
