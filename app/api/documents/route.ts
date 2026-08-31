import { logAudit } from "../../lib/audit";
import { queueWorkspaceBackup } from "../../lib/backup";
import { deleteObject, getObject, putObject } from "../../lib/storage";
import { audit, authenticate, database, prepareDatabase } from "../workspace/route";

export const runtime = "nodejs";
export const maxDuration = 60;

async function documentStorageKey(clientId: number | null, orderId: number | null, safeName: string) {
  const id = crypto.randomUUID();
  if (orderId) return `documents/orders/${orderId}/${id}-${safeName}`;
  if (clientId) {
    const client = await database().prepare("SELECT kind FROM clients WHERE id=?").bind(clientId).first<{ kind: string }>();
    const folder = client?.kind === "vendor" ? "suppliers" : "clients";
    return `documents/${folder}/${clientId}/${id}-${safeName}`;
  }
  return `documents/other/${new Date().toISOString().slice(0, 10)}/${id}-${safeName}`;
}

export async function GET(request: Request) {
  try {
    await prepareDatabase();
    const actor = await authenticate(request);
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    const wantsInline = url.searchParams.get("view") === "1";
    const row = await database().prepare("SELECT object_key,file_name,content_type FROM documents WHERE id=?").bind(id).first<Record<string,unknown>>();
    if (!row) return Response.json({ error: "Document not found" }, { status: 404 });
    await logAudit(actor.id, wantsInline ? "viewed" : "downloaded", "document", id, `${actor.displayName} ${wantsInline ? "viewed" : "downloaded"} ${row.file_name}`, { fileName: row.file_name, mode: wantsInline ? "inline" : "download" });
    const object = await getObject(String(row.object_key));
    if (!object) return Response.json({ error: "Stored file not found on this server. Re-upload the document to keep it on your personal server." }, { status: 404 });
    const contentType = String(row.content_type || object.contentType || "application/octet-stream");
    const canViewInline = /^(application\/pdf|image\/|text\/plain)/i.test(contentType);
    const disposition = wantsInline && canViewInline ? "inline" : "attachment";
    return new Response(object.stream, { headers: { "content-type": contentType, "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(String(row.file_name))}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to download document" }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    await prepareDatabase();
    const actor = await authenticate(request);
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await request.json() as { action?:string; id?:number; status?:string };
      if (payload.action !== "status" || !payload.id || !payload.status) throw new Error("Invalid document update");
      const before = await database().prepare("SELECT status,file_name FROM documents WHERE id=?").bind(payload.id).first<{status:string;file_name:string}>();
      if (!before) throw new Error("Document not found");
      await database().prepare("UPDATE documents SET status=? WHERE id=?").bind(payload.status,payload.id).run();
      await audit(actor,"status changed","document",payload.id,`${actor.displayName} changed ${before.file_name} from ${before.status} to ${payload.status}`,{before:before.status,after:payload.status});
      return Response.json({ ok:true }, { status:201 });
    }
    const form = await request.formData();
    const uploadedFiles=form.getAll("file").filter((value):value is File=>value instanceof File&&value.size>0);
    if(uploadedFiles.length===0)throw new Error("Choose one or more documents to upload");
    if(uploadedFiles.some(file=>file.size>25*1024*1024))throw new Error("Each document must be 25 MB or smaller");
    const db = database();
    if (actor.role === "operator") {
      const clientId = form.get("clientId") ? Number(form.get("clientId")) : null;
      const orderId = form.get("orderId") ? Number(form.get("orderId")) : null;
      if (orderId) {
        const order = await db.prepare("SELECT client_id FROM orders WHERE id=?").bind(orderId).first<{ client_id: number }>();
        if (!order) throw new Error("Order not found");
        const allowed = await db.prepare("SELECT 1 FROM user_client_assignments WHERE user_id=? AND client_id=?").bind(actor.id, order.client_id).first();
        if (!allowed) throw new Error("You are not assigned to this client");
      } else if (clientId) {
        const allowed = await db.prepare("SELECT 1 FROM user_client_assignments WHERE user_id=? AND client_id=?").bind(actor.id, clientId).first();
        if (!allowed) throw new Error("You are not assigned to this client");
      }
    }
    const ids:number[]=[];
    const clientId=form.get("clientId")?Number(form.get("clientId")):null;
    const orderId=form.get("orderId")?Number(form.get("orderId")):null;
    for(const file of uploadedFiles){
      const safeName=file.name.replace(/[^a-zA-Z0-9._-]+/g,"-").slice(-120)||"document";
      const key=await documentStorageKey(clientId,orderId,safeName);
      const blob=await putObject(key,file,file.type||"application/octet-stream");
      try{
        const row=await database().prepare("INSERT INTO documents (client_id,order_id,file_name,object_key,content_type,size,category,status,created_by) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id").bind(clientId,orderId,file.name,blob.url,file.type||"application/octet-stream",file.size,String(form.get("category")||"Other"),"Uploaded",actor.id).first<{id:number}>();
        if(!row)throw new Error("Document record could not be created");ids.push(row.id);
        await audit(actor,"uploaded","document",row.id,`${actor.displayName} uploaded ${file.name}`,{fileName:file.name,size:file.size,category:form.get("category"),clientId,orderId});
      }catch(error){await deleteObject(blob.url);throw error;}
    }
    queueWorkspaceBackup("document-upload");
    return Response.json({ids},{status:201});
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to save document" }, { status:400 }); }
}

export async function DELETE(request: Request) {
  try {
    await prepareDatabase();
    const actor=await authenticate(request);
    if(actor.role==="operator")return Response.json({error:"Level 2 operators cannot delete documents"},{status:403});
    const id=Number(new URL(request.url).searchParams.get("id"));
    const row=await database().prepare("SELECT object_key,file_name FROM documents WHERE id=?").bind(id).first<Record<string,unknown>>();
    if(!row)throw new Error("Document not found");
    await deleteObject(String(row.object_key));
    await database().prepare("DELETE FROM documents WHERE id=?").bind(id).run();
    await audit(actor,"deleted","document",id,`${actor.displayName} deleted ${row.file_name}`,{fileName:row.file_name});
    return Response.json({ok:true});
  } catch(error){return Response.json({error:error instanceof Error?error.message:"Unable to delete document"},{status:400});}
}
