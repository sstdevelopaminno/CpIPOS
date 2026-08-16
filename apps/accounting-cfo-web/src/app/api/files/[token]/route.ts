import { getSession } from "@/lib/auth";
import { verifyFileGrant } from "@/lib/files";
import { getDriveFile } from "@/lib/google";

function contentDispositionFilename(value: string) {
  const cleaned = value.replace(/[\r\n]/g, "_").slice(0, 180) || "document";
  const fallback = cleaned
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_") || "document";
  return `filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { token } = await context.params;
  const grant = verifyFileGrant(token);
  if (!grant || grant.role !== session.role) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const file = await getDriveFile(grant.fileId);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const disposition = download ? "attachment" : "inline";

    return new Response(file.bytes, {
      status: 200,
      headers: {
        "content-type": file.mimeType,
        "content-disposition": `${disposition}; ${contentDispositionFilename(file.name)}`,
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return new Response("Document unavailable", { status: 404 });
  }
}
