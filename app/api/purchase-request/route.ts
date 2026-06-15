import { generatePurchaseRequestXlsx } from "@/lib/exports-pr";
import type { PRData } from "@/lib/exports-pr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const data: PRData = await req.json();
    const buf = generatePurchaseRequestXlsx(data);
    const filename = `PR_${(data.prNo || "draft").replace(/[^A-Za-z0-9_-]/g, "_")}.xlsx`;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as { message?: string })?.message ?? String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
