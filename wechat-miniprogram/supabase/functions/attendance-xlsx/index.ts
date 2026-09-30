import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as XLSX from "npm:xlsx@0.18.5";

const ALLOWED_EMAIL = "1661531189@qq.com";
const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}
function decodeJwtPayload(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("未登录");
  let raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  raw += "=".repeat((4 - (raw.length % 4)) % 4);
  return JSON.parse(atob(raw));
}
function assertAllowed(req: Request) {
  const payload = decodeJwtPayload(req);
  if (String(payload?.email || "").toLowerCase() !== ALLOWED_EMAIL) throw new Error("无权访问");
}
function base64ToBytes(value: string) {
  const raw = atob(value), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
function bytesToBase64(bytes: Uint8Array) {
  let binary = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().replace(/[\s　_\-:：()（）]/g, "").toLowerCase();
}
function findHeader(row: unknown[], type: "name" | "id") {
  const values = row.map(normalizeHeader);
  if (type === "name") return values.findIndex((v) => v === "姓名" || v === "学生姓名" || v === "name" || v === "studentname" || v.endsWith("姓名"));
  return values.findIndex((v) => v === "学号" || v === "学生学号" || v === "学籍号" || v === "studentid" || v === "studentno" || v === "studentnumber" || v.endsWith("学号"));
}
function safeSheetName(value: unknown, used: Set<string>) {
  const base = String(value || "考勤").replace(/[\\\/?*\[\]:]+/g, "_").trim().slice(0, 31) || "考勤";
  let name = base, n = 2;
  while (used.has(name)) { const suffix = "_" + n++; name = base.slice(0, 31 - suffix.length) + suffix; }
  used.add(name); return name;
}
function safeFileName(value: unknown) {
  return String(value || "考勤").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "考勤";
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
    assertAllowed(req);
    const body = await req.json();

    if (body?.action === "parse") {
      const filename = String(body?.filename || ""), base64 = String(body?.base64 || "");
      if (!base64) return response({ error: "缺少文件内容" }, 400);
      if (base64.length > 12 * 1024 * 1024) return response({ error: "Excel 文件过大" }, 413);
      const workbook = XLSX.read(base64ToBytes(base64), { type: "array", cellDates: false });
      const first = workbook.SheetNames[0];
      if (!first) return response({ error: "Excel 中没有可读取的工作表" }, 400);
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[first], { header: 1, defval: "", raw: false, blankrows: false }) as unknown[][];
      let header = -1, nameCol = -1, idCol = -1;
      for (let i = 0; i < Math.min(rows.length, 25); i++) {
        const row = Array.isArray(rows[i]) ? rows[i] : [];
        const n = findHeader(row, "name"), id = findHeader(row, "id");
        if (n >= 0 && id >= 0) { header = i; nameCol = n; idCol = id; break; }
      }
      if (header < 0) return response({ error: "未找到“姓名”和“学号”两列表头" }, 400);
      const students: { name: string; studentNo: string }[] = [], seen = new Set<string>(); let skipped = 0;
      for (let i = header + 1; i < rows.length; i++) {
        const row = Array.isArray(rows[i]) ? rows[i] : [];
        const name = String(row[nameCol] ?? "").trim(), studentNo = String(row[idCol] ?? "").trim();
        if (!name && !studentNo) continue;
        if (!name || !studentNo || seen.has(studentNo)) { skipped++; continue; }
        seen.add(studentNo); students.push({ name, studentNo });
      }
      if (!students.length) return response({ error: "没有读取到完整的姓名和学号记录" }, 400);
      return response({ ok: true, filename, students, skipped });
    }

    if (body?.action === "export") {
      const sheets = Array.isArray(body?.sheets) ? body.sheets : [];
      if (!sheets.length) return response({ error: "没有可导出的考勤数据" }, 400);
      const wb = XLSX.utils.book_new(), used = new Set<string>();
      for (const item of sheets) {
        const dates = Array.isArray(item?.dates) ? item.dates.map(String) : [], students = Array.isArray(item?.students) ? item.students : [], marks = item?.marks && typeof item.marks === "object" ? item.marks : {};
        const rows: unknown[][] = [["姓名", ...dates, "学号"]];
        for (const st of students) {
          const id = String(st?.id || "");
          rows.push([String(st?.name || ""), ...dates.map((d) => { const v = String(marks?.[id]?.[d] ?? "-"); return v === "1" ? 1 : v === "-1" ? -1 : "-"; }), String(st?.studentNo || "")]);
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws["!cols"] = [{ wch: 14 }, ...dates.map(() => ({ wch: 12 })), { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, ws, safeSheetName(item?.name, used));
      }
      const out = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
      return response({ ok: true, filename: safeFileName(body?.filename || "考勤汇总") + ".xlsx", base64: bytesToBase64(new Uint8Array(out)) });
    }
    return response({ error: "未知操作" }, 400);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : String(error) }, 403);
  }
});
