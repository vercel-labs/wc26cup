import { list, put, type ListBlobResultBlob } from "@vercel/blob";

export async function listAllBlobs(prefix: string): Promise<readonly ListBlobResultBlob[]> {
  const blobs: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ cursor, limit: 1000, prefix });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

export async function readBlobJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} responded ${response.status}.`);
  const value: unknown = await response.json();
  return value;
}

export async function blobPathExists(pathname: string): Promise<boolean> {
  const blobs = await listAllBlobs(pathname);
  return blobs.some((blob) => blob.pathname === pathname);
}

export async function putJsonIfAbsent(pathname: string, value: unknown): Promise<boolean> {
  try {
    await put(pathname, JSON.stringify(value, null, 2), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 60,
      contentType: "application/json",
    });
    return true;
  } catch (error) {
    if (await blobPathExists(pathname)) return false;
    throw error;
  }
}
