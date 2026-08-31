"use client";

import {useMemo,useState} from "react";
import {useI18n} from "../i18n";

export type InvoiceLine={id:string;description:string;quantity:number;unitPrice:number};

type Props={
  initialLines:InvoiceLine[];
  currency?:string;
};

const emptyLine=():InvoiceLine=>({id:crypto.randomUUID(),description:"",quantity:1,unitPrice:0});

function rowsToLines(rows:unknown[][]):InvoiceLine[]{
  if(!rows.length)return[];
  let start=0;
  const header=rows[0]?.map(cell=>String(cell??"").toLowerCase())??[];
  let descIdx=0;
  let qtyIdx=1;
  let priceIdx=2;
  if(header.some(cell=>cell.includes("desc")||cell.includes("item")||cell.includes("product"))){
    const find=(patterns:string[])=>header.findIndex(cell=>patterns.some(pattern=>cell.includes(pattern)));
    descIdx=find(["description","item","product","particular","details"]);
    qtyIdx=find(["qty","quantity","units"]);
    priceIdx=find(["unit price","unit_price","price","rate","amount"]);
    if(descIdx<0)descIdx=0;
    if(qtyIdx<0)qtyIdx=descIdx===0?1:0;
    if(priceIdx<0)priceIdx=Math.max(descIdx,qtyIdx)+1;
    start=1;
  }
  const lines:InvoiceLine[]=[];
  for(let index=start;index<rows.length;index+=1){
    const row=rows[index];
    if(!row||row.every(cell=>String(cell??"").trim()===""))continue;
    const description=String(row[descIdx]??"").trim();
    const quantity=Number(row[qtyIdx]??1);
    const unitPrice=Number(row[priceIdx]??0);
    if(!description)continue;
    lines.push({
      id:crypto.randomUUID(),
      description,
      quantity:Number.isFinite(quantity)&&quantity>0?quantity:1,
      unitPrice:Number.isFinite(unitPrice)?unitPrice:0,
    });
  }
  return lines;
}

function parseDelimited(text:string){
  return text.trim().split(/\r?\n/).map(line=>line.split("\t").length>1?line.split("\t"):line.split(","));
}

export function InvoiceLineGrid({initialLines,currency="RUB"}:Props){
  const {t}=useI18n();
  const [lines,setLines]=useState<InvoiceLine[]>(initialLines.length?initialLines:[emptyLine()]);
  const [importMessage,setImportMessage]=useState("");

  const subtotal=useMemo(()=>lines.reduce((sum,line)=>sum+Number(line.quantity||0)*Number(line.unitPrice||0),0),[lines]);
  const payload=useMemo(()=>JSON.stringify(lines.map(({description,quantity,unitPrice})=>({description,quantity,unitPrice}))),[lines]);

  const updateLine=(id:string,patch:Partial<InvoiceLine>)=>setLines(current=>current.map(line=>line.id===id?{...line,...patch}:line));
  const addLine=()=>setLines(current=>[...current,emptyLine()]);
  const removeLine=(id:string)=>setLines(current=>current.length<=1?current:current.filter(line=>line.id!==id));

  const applyImported=(imported:InvoiceLine[])=>{
    if(!imported.length){setImportMessage(t("No usable rows were found in that file."));return}
    setLines(imported);
    setImportMessage(t("Imported {count} line items.").replace("{count}",String(imported.length)));
  };

  const onPaste=(event:React.ClipboardEvent<HTMLTableSectionElement>)=>{
    const text=event.clipboardData.getData("text/plain");
    if(!text.includes("\t")&&!text.includes(","))return;
    event.preventDefault();
    applyImported(rowsToLines(parseDelimited(text)));
  };

  const onFile=(event:React.ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];
    event.target.value="";
    if(!file)return;
    void (async()=>{
      try{
        if(/\.csv$/i.test(file.name)){
          applyImported(rowsToLines(parseDelimited(await file.text())));
          return;
        }
        const XLSX=await import("xlsx");
        const workbook=XLSX.read(await file.arrayBuffer(),{type:"array"});
        const sheet=workbook.Sheets[workbook.SheetNames[0]];
        if(!sheet)throw new Error("Workbook is empty");
        applyImported(rowsToLines(XLSX.utils.sheet_to_json(sheet,{header:1,raw:false}) as unknown[][]));
      }catch(reason){
        setImportMessage(reason instanceof Error?reason.message:t("Unable to read that spreadsheet"));
      }
    })();
  };

  const formatMoney=(value:number)=>{
    try{return new Intl.NumberFormat("en-US",{style:"currency",currency,maximumFractionDigits:2}).format(value)}catch{return value.toFixed(2)}
  };

  return <div className="invoice-sheet wide">
    <input type="hidden" name="lineItemsJson" value={payload}/>
    <div className="invoice-sheet-toolbar">
      <div><strong>{t("Invoice particulars")}</strong><small>{t("Excel-style grid · paste from spreadsheet or upload .xlsx / .csv")}</small></div>
      <div className="invoice-sheet-actions">
        <label className="table-action invoice-import-button">{t("Upload Excel / CSV")}<input type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" onChange={onFile}/></label>
        <button type="button" className="table-action" onClick={addLine}>＋ {t("Add row")}</button>
      </div>
    </div>
    {importMessage&&<p className="invoice-sheet-note">{importMessage}</p>}
    <div className="invoice-sheet-wrap">
      <table className="invoice-sheet-grid" onPaste={onPaste}>
        <thead><tr><th>{t("Description")}</th><th>{t("Qty")}</th><th>{t("Unit price")}</th><th>{t("Amount")}</th><th></th></tr></thead>
        <tbody>{lines.map((line,index)=><tr key={line.id}>
          <td><input value={line.description} onChange={event=>updateLine(line.id,{description:event.target.value})} placeholder={t("Line item description")} aria-label={`${t("Description")} ${index+1}`}/></td>
          <td><input type="number" min="0" step="any" value={line.quantity} onChange={event=>updateLine(line.id,{quantity:Number(event.target.value)||0})} aria-label={`${t("Qty")} ${index+1}`}/></td>
          <td><input type="number" min="0" step="any" value={line.unitPrice} onChange={event=>updateLine(line.id,{unitPrice:Number(event.target.value)||0})} aria-label={`${t("Unit price")} ${index+1}`}/></td>
          <td className="amount">{formatMoney(line.quantity*line.unitPrice)}</td>
          <td><button type="button" className="delete-link" onClick={()=>removeLine(line.id)} aria-label={t("Remove row")}>×</button></td>
        </tr>)}</tbody>
        <tfoot><tr><td colSpan={3}><strong>{t("Lines subtotal")}</strong></td><td colSpan={2}><strong>{formatMoney(subtotal)}</strong></td></tr></tfoot>
      </table>
    </div>
    <p className="invoice-sheet-hint">{t("Tip: copy rows from Excel and paste directly into the grid. Expected columns: Description, Qty, Unit price.")}</p>
  </div>;
}

export function buildInvoiceLines(invoiceId:number|null|undefined,items:Array<Record<string,unknown>>,fallback?:Record<string,unknown>|null):InvoiceLine[]{
  if(invoiceId){
    const matched=items.filter(row=>Number(row.invoice_id)===invoiceId);
    if(matched.length)return matched.map((row,index)=>({id:String(row.id??index),description:String(row.description??""),quantity:Number(row.quantity??1),unitPrice:Number(row.unit_price??0)}));
  }
  if(fallback?.item_description||fallback?.item_unit_price){
    return [{id:"line-1",description:String(fallback.item_description??""),quantity:Number(fallback.item_quantity??1),unitPrice:Number(fallback.item_unit_price??0)}];
  }
  return [{id:"line-1",description:"",quantity:1,unitPrice:0}];
}
