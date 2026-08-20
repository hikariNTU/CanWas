import type { Session } from "@/sync/auth";

/**
 * The Drive calls this app needs, and no more.
 *
 * REST over `fetch` rather than Google's JS client library: the four endpoints
 * below are the whole surface, and the library is 100 KB plus a second script
 * from a third party to describe them.
 *
 * Nothing here decides *what* to sync or *when* — that is the hard part and it
 * lives in docs/sync.md until it is settled. This is the transport.
 */

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const ABOUT = "https://www.googleapis.com/drive/v3/about";

/** The folder everything lives under, created on first use. */
export const ROOT_FOLDER_NAME = "CanWas";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  appProperties?: Record<string, string>;
}

class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

async function call<T>(
  session: Session,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  // Built through `Headers` rather than spread: `HeadersInit` is also allowed
  // to be an array or a `Headers`, and spreading either of those into an object
  // produces indices instead of headers.
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.accessToken}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    // 401 means the hour ran out. The caller re-requests a token silently and
    // tries again; anything else is a real failure worth surfacing.
    throw new DriveError(
      response.status,
      `${response.status} ${await response.text().catch(() => "")}`.slice(
        0,
        300,
      ),
    );
  }
  return (await response.json()) as T;
}

export function isExpired(error: unknown): boolean {
  return error instanceof DriveError && error.status === 401;
}

/** The signed-in account, and how full their Drive is. */
export async function fetchAccount(session: Session): Promise<{
  email?: string;
  name?: string;
  photo?: string;
  storageUsed?: number;
  storageLimit?: number;
}> {
  const about = await call<{
    user?: { emailAddress?: string; displayName?: string; photoLink?: string };
    storageQuota?: { usage?: string; limit?: string };
  }>(
    session,
    // Name and picture come from the same request as the address, so knowing
    // who is connected costs nothing beyond the fields asked for.
    `${ABOUT}?fields=user(emailAddress,displayName,photoLink),storageQuota(usage,limit)`,
  );
  return {
    email: about.user?.emailAddress,
    name: about.user?.displayName,
    photo: about.user?.photoLink,
    storageUsed: about.storageQuota?.usage
      ? Number(about.storageQuota.usage)
      : undefined,
    storageLimit: about.storageQuota?.limit
      ? Number(about.storageQuota.limit)
      : undefined,
  };
}

function escapeQuery(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

export async function findByName(
  session: Session,
  name: string,
  parentId?: string,
): Promise<DriveFile | undefined> {
  const clauses = [`name = '${escapeQuery(name)}'`, "trashed = false"];
  if (parentId) {
    clauses.push(`'${escapeQuery(parentId)}' in parents`);
  }
  const query = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "files(id,name,mimeType,modifiedTime,size,appProperties)",
    pageSize: "1",
  });
  const result = await call<{ files: DriveFile[] }>(
    session,
    `${FILES}?${query.toString()}`,
  );
  return result.files[0];
}

export async function listChildren(
  session: Session,
  parentId: string,
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      q: `'${escapeQuery(parentId)}' in parents and trashed = false`,
      fields:
        "nextPageToken, files(id,name,mimeType,modifiedTime,size,appProperties)",
      pageSize: "1000",
    });
    if (pageToken) {
      query.set("pageToken", pageToken);
    }
    const page = await call<{ files: DriveFile[]; nextPageToken?: string }>(
      session,
      `${FILES}?${query.toString()}`,
    );
    files.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

export async function ensureFolder(
  session: Session,
  name: string,
  parentId?: string,
): Promise<string> {
  const existing = await findByName(session, name, parentId);
  if (existing?.mimeType === FOLDER_MIME) {
    return existing.id;
  }
  const created = await call<DriveFile>(session, FILES, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  return created.id;
}

/**
 * Writes a file, creating it or replacing its contents.
 *
 * Multipart upload, which carries the metadata and the bytes in one request.
 * Drive also offers a resumable protocol for large files; nothing here is large
 * — a board is a few KB and an image is a WebP — and resumable costs an extra
 * round trip per file.
 */
export async function putFile(
  session: Session,
  options: {
    name: string;
    parentId: string;
    body: Blob;
    fileId?: string;
    appProperties?: Record<string, string>;
  },
): Promise<DriveFile> {
  const metadata: Record<string, unknown> = {
    name: options.name,
    ...(options.appProperties ? { appProperties: options.appProperties } : {}),
    // `parents` may only be set at creation; an update that repeats it is an
    // error rather than a no-op.
    ...(options.fileId ? {} : { parents: [options.parentId] }),
  };

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.append("file", options.body);

  const url = options.fileId
    ? `${UPLOAD}/${options.fileId}?uploadType=multipart&fields=id,name,modifiedTime,size`
    : `${UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime,size`;

  return call<DriveFile>(session, url, {
    method: options.fileId ? "PATCH" : "POST",
    body: form,
  });
}

export async function getFileContent(
  session: Session,
  fileId: string,
): Promise<Blob> {
  const response = await fetch(`${FILES}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (!response.ok) {
    throw new DriveError(response.status, `${response.status} downloading`);
  }
  return response.blob();
}

export function deleteFile(session: Session, fileId: string): Promise<void> {
  return fetch(`${FILES}/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.accessToken}` },
  }).then((response) => {
    if (!response.ok && response.status !== 404) {
      throw new DriveError(response.status, `${response.status} deleting`);
    }
  });
}
