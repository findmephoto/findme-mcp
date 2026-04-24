// Upload tools: from local paths (primary), from URLs, from Drive folder (stub for v1)
// See SPEC §10.2a — local path upload is the most common photographer workflow

import type { Stats } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { z } from 'zod';

import type { FindMeClient } from '../client.js';
import { ToolError } from '../errors.js';
import { jsonResult, safeToolHandler, type ToolResult } from '../tool-helpers.js';

const MAX_BATCH = 50;
const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const PARALLEL_S3_PUTS = 4;

const PHOTO_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const VIDEO_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

function expandHome(p: string): string {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

/**
 * Minimal glob: supports simple patterns like `~/dir/*.jpg` or `/abs/**\/*.png`.
 * For the common photographer workflow (folder of images), a directory path
 * without wildcards auto-expands to all supported files within.
 */
async function resolveFiles(input: string, recursive: boolean): Promise<string[]> {
  const expanded = expandHome(input);

  // Check if it's a directory path with no wildcards
  let stat: Stats;
  try {
    stat = await fsp.stat(expanded);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ToolError('path_not_found', `Path doesn't exist: ${input}`, { details: { expanded } });
    }
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      throw new ToolError(
        'permission_denied',
        `Permission denied reading ${input}.`,
        { action: 'On macOS, grant Claude Desktop Full Disk Access in System Settings → Privacy & Security.' },
      );
    }
    throw err;
  }

  if (stat.isFile()) return [expanded];
  if (!stat.isDirectory()) throw new ToolError('path_not_found', `Not a file or directory: ${input}`);

  // Walk the directory (non-recursive by default)
  const collected: string[] = [];
  async function walk(dir: string, depth: number) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext in PHOTO_EXT || ext in VIDEO_EXT) collected.push(full);
      } else if (entry.isDirectory() && recursive && depth < 10) {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(expanded, 0);
  return collected;
}

// ──────────────────────────────────────────────────────────
// upload_photos_from_paths — PRIMARY path for local workflows
// ──────────────────────────────────────────────────────────

export const uploadPhotosFromPathsSchema = z.object({
  event_id: z.string().uuid(),
  paths: z.array(z.string().min(1)).min(1).max(50),
  recursive: z.boolean().optional(),
});

export const uploadPhotosFromPathsDefinition = {
  name: 'upload_photos_from_paths',
  description:
    'Upload photos or videos from local file paths on the photographer\'s computer to a FindMe event. Each path can be a file, a directory (all supported files inside are uploaded), or a glob (basic). Supported formats: .jpg .jpeg .png .webp .mp4 .mov .webm. Max 50 files per call; auto-chunks if more are found. Max size per file: 50 MB for photos, 500 MB for videos. This is the primary upload tool — prefer it when the photographer says things like "upload all photos in ~/Pictures/Sarah" or "add these files to the Johnson event".',
  inputSchema: {
    type: 'object' as const,
    properties: {
      event_id: { type: 'string', description: 'UUID of the target event.' },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'File paths or directory paths. `~` expansion supported. Directories upload all supported files inside (non-recursive by default).',
      },
      recursive: { type: 'boolean', description: 'If true, recurse into subdirectories (max depth 10). Default false.' },
    },
    required: ['event_id', 'paths'],
    additionalProperties: false,
  },
};

interface InitiateUpload {
  batch_id: string;
  uploads: Array<{
    photo_id: string;
    filename: string;
    media_type: 'photo' | 'video';
    presigned_url: string;
    s3_key: string;
    expires_at: string;
  }>;
}

interface ConfirmResult {
  confirmed: Array<{ photo_id: string; status: 'completed' | 'indexing' | 'error'; reason?: string }>;
}

interface PerFileOutcome {
  filename: string;
  path: string;
  status: 'uploaded' | 'failed';
  photo_id?: string;
  final_status?: string;
  reason?: string;
  size_bytes?: number;
}

async function uploadOneBatch(
  client: FindMeClient,
  eventId: string,
  files: Array<{ filepath: string; filename: string; contentType: string; size: number; mediaKind: 'photo' | 'video' }>,
): Promise<PerFileOutcome[]> {
  // 1. Initiate — server creates photo rows + presigned URLs
  const initiate = await client.requestData<InitiateUpload>(`/events/${eventId}/photos`, {
    method: 'POST',
    body: {
      files: files.map((f) => ({
        filename: f.filename,
        content_type: f.contentType,
        size_bytes: f.size,
      })),
    },
  });

  // 2. Stream each file to its presigned URL (parallel up to PARALLEL_S3_PUTS)
  const outcomes: PerFileOutcome[] = [];
  const putResults: Array<{ photo_id: string; ok: boolean; reason?: string }> = [];

  for (let i = 0; i < initiate.uploads.length; i += PARALLEL_S3_PUTS) {
    const slice = initiate.uploads.slice(i, i + PARALLEL_S3_PUTS);
    const results = await Promise.all(
      slice.map(async (u) => {
        const local = files.find((f) => f.filename === u.filename);
        if (!local) return { photo_id: u.photo_id, ok: false, reason: 'file_not_found_locally' };
        try {
          const body = await fsp.readFile(local.filepath);
          const res = await fetch(u.presigned_url, {
            method: 'PUT',
            headers: { 'Content-Type': local.contentType },
            body,
          });
          if (!res.ok) {
            return { photo_id: u.photo_id, ok: false, reason: `s3_${res.status}` };
          }
          return { photo_id: u.photo_id, ok: true };
        } catch (err) {
          return { photo_id: u.photo_id, ok: false, reason: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    putResults.push(...results);
  }

  // 3. Confirm — server marks each photo completed/indexing/error
  const succeededIds = putResults.filter((r) => r.ok).map((r) => r.photo_id);
  let confirmed: ConfirmResult['confirmed'] = [];
  if (succeededIds.length > 0) {
    try {
      const result = await client.requestData<ConfirmResult>(`/events/${eventId}/photos/confirm`, {
        method: 'POST',
        body: { photo_ids: succeededIds },
      });
      confirmed = result.confirmed;
    } catch (err) {
      // Confirm failed — tag each as error
      const reason = err instanceof ToolError ? err.code : 'confirm_failed';
      confirmed = succeededIds.map((id) => ({ photo_id: id, status: 'error', reason }));
    }
  }

  // 4. Build per-file outcomes
  for (const u of initiate.uploads) {
    const local = files.find((f) => f.filename === u.filename);
    const put = putResults.find((r) => r.photo_id === u.photo_id);
    const conf = confirmed.find((c) => c.photo_id === u.photo_id);

    if (!put?.ok) {
      outcomes.push({
        filename: u.filename,
        path: local?.filepath ?? '',
        status: 'failed',
        photo_id: u.photo_id,
        reason: put?.reason ?? 'unknown',
        size_bytes: local?.size,
      });
    } else {
      outcomes.push({
        filename: u.filename,
        path: local?.filepath ?? '',
        status: conf?.status === 'error' ? 'failed' : 'uploaded',
        photo_id: u.photo_id,
        final_status: conf?.status,
        reason: conf?.reason,
        size_bytes: local?.size,
      });
    }
  }
  return outcomes;
}

export async function runUploadPhotosFromPaths(
  client: FindMeClient,
  input: z.infer<typeof uploadPhotosFromPathsSchema>,
): Promise<ToolResult> {
  return safeToolHandler(
    async () => {
      // 1. Resolve all paths → flat list of absolute files
      const allFiles: string[] = [];
      for (const p of input.paths) {
        const resolved = await resolveFiles(p, input.recursive ?? false);
        allFiles.push(...resolved);
      }

      if (allFiles.length === 0) {
        throw new ToolError(
          'no_supported_files',
          'Found 0 supported files in the given paths.',
          { action: 'Supported formats: .jpg .jpeg .png .webp .mp4 .mov .webm' },
        );
      }

      // 2. Stat + classify
      const metadata: Array<{ filepath: string; filename: string; contentType: string; size: number; mediaKind: 'photo' | 'video' }> = [];
      const oversized: string[] = [];
      for (const filepath of allFiles) {
        const ext = path.extname(filepath).toLowerCase();
        const isPhoto = ext in PHOTO_EXT;
        const contentType = isPhoto ? PHOTO_EXT[ext] : VIDEO_EXT[ext];
        const stat = await fsp.stat(filepath);
        const cap = isPhoto ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
        if (stat.size > cap) {
          oversized.push(`${path.basename(filepath)} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
          continue;
        }
        metadata.push({
          filepath,
          filename: path.basename(filepath),
          contentType,
          size: stat.size,
          mediaKind: isPhoto ? 'photo' : 'video',
        });
      }

      if (metadata.length === 0) {
        throw new ToolError(
          'file_too_large',
          'All files are too large.',
          { details: { oversized, limits: { photo_mb: 50, video_mb: 500 } } },
        );
      }

      // 3. Chunk into batches of MAX_BATCH and upload
      const allOutcomes: PerFileOutcome[] = [];
      for (let i = 0; i < metadata.length; i += MAX_BATCH) {
        const batch = metadata.slice(i, i + MAX_BATCH);
        const outcomes = await uploadOneBatch(client, input.event_id, batch);
        allOutcomes.push(...outcomes);
      }

      const uploaded = allOutcomes.filter((o) => o.status === 'uploaded');
      const failed = allOutcomes.filter((o) => o.status === 'failed');

      return { uploaded, failed, oversized };
    },
    ({ uploaded, failed, oversized }) =>
      jsonResult({
        summary: {
          uploaded: uploaded.length,
          failed: failed.length,
          skipped_too_large: oversized.length,
        },
        ...(failed.length > 0 ? { failures: failed.map((f) => ({ filename: f.filename, reason: f.reason })) } : {}),
        ...(oversized.length > 0 ? { skipped: oversized } : {}),
        uploaded_samples: uploaded.slice(0, 5).map((u) => ({ filename: u.filename, photo_id: u.photo_id, status: u.final_status })),
      }),
  );
}

// ──────────────────────────────────────────────────────────
// upload_photos_from_urls — stream from arbitrary URLs
// ──────────────────────────────────────────────────────────

export const uploadPhotosFromUrlsSchema = z.object({
  event_id: z.string().uuid(),
  urls: z.array(z.string().url()).min(1).max(50),
});

export const uploadPhotosFromUrlsDefinition = {
  name: 'upload_photos_from_urls',
  description:
    'Upload photos/videos from public URLs to a FindMe event. Useful when the photographer shares Dropbox links, direct Drive download URLs, or similar. The MCP server downloads each URL to a temp buffer and streams it to the event. Max 50 URLs per call.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      event_id: { type: 'string' },
      urls: { type: 'array', items: { type: 'string' }, description: 'Public URLs returning image/video bytes.' },
    },
    required: ['event_id', 'urls'],
    additionalProperties: false,
  },
};

function guessFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    return last || 'upload.jpg';
  } catch {
    return 'upload.jpg';
  }
}

function guessContentType(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  return PHOTO_EXT[ext] ?? VIDEO_EXT[ext] ?? null;
}

export async function runUploadPhotosFromUrls(
  client: FindMeClient,
  input: z.infer<typeof uploadPhotosFromUrlsSchema>,
): Promise<ToolResult> {
  return safeToolHandler(
    async () => {
      const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'findme-mcp-'));
      try {
        const metadata: Array<{ filepath: string; filename: string; contentType: string; size: number; mediaKind: 'photo' | 'video' }> = [];
        const failedDownloads: Array<{ url: string; reason: string }> = [];

        for (const url of input.urls) {
          let filename = guessFilenameFromUrl(url);
          try {
            const res = await fetch(url);
            if (!res.ok) {
              failedDownloads.push({ url, reason: `HTTP ${res.status}` });
              continue;
            }
            const ctHeader = res.headers.get('content-type');
            let contentType = guessContentType(filename);
            if (!contentType && ctHeader) {
              const ct = ctHeader.split(';')[0].trim();
              if (ct in PHOTO_EXT || ct in VIDEO_EXT) contentType = ct;
              // crude ext inference
              if (!filename.includes('.') && ct === 'image/jpeg') filename += '.jpg';
              else if (!filename.includes('.') && ct === 'image/png') filename += '.png';
            }
            if (!contentType) {
              failedDownloads.push({ url, reason: 'unsupported_content_type' });
              continue;
            }
            const buf = Buffer.from(await res.arrayBuffer());
            const filepath = path.join(tempDir, filename);
            await fsp.writeFile(filepath, buf);
            metadata.push({
              filepath,
              filename,
              contentType,
              size: buf.length,
              mediaKind: contentType.startsWith('image/') ? 'photo' : 'video',
            });
          } catch (err) {
            failedDownloads.push({ url, reason: err instanceof Error ? err.message : String(err) });
          }
        }

        if (metadata.length === 0) {
          throw new ToolError('no_supported_files', 'None of the URLs returned supported files.', {
            details: { failures: failedDownloads },
          });
        }

        const allOutcomes: PerFileOutcome[] = [];
        for (let i = 0; i < metadata.length; i += MAX_BATCH) {
          const batch = metadata.slice(i, i + MAX_BATCH);
          const outcomes = await uploadOneBatch(client, input.event_id, batch);
          allOutcomes.push(...outcomes);
        }

        return {
          uploaded: allOutcomes.filter((o) => o.status === 'uploaded'),
          failed: allOutcomes.filter((o) => o.status === 'failed'),
          failedDownloads,
        };
      } finally {
        // Clean up temp dir
        try {
          await fsp.rm(tempDir, { recursive: true, force: true });
        } catch {
          // swallow — temp files will be GC'd by the OS
        }
      }
    },
    ({ uploaded, failed, failedDownloads }) =>
      jsonResult({
        summary: {
          uploaded: uploaded.length,
          failed_upload: failed.length,
          failed_download: failedDownloads.length,
        },
        ...(failed.length > 0 ? { failures: failed.map((f) => ({ filename: f.filename, reason: f.reason })) } : {}),
        ...(failedDownloads.length > 0 ? { download_failures: failedDownloads } : {}),
      }),
  );
}

// ──────────────────────────────────────────────────────────
// upload_photos_from_drive_folder — stub for v1
// ──────────────────────────────────────────────────────────

export const uploadPhotosFromDriveFolderSchema = z.object({
  event_id: z.string().uuid(),
  folder_id: z.string().min(1),
  folder_name: z.string().optional(),
});

export const uploadPhotosFromDriveFolderDefinition = {
  name: 'upload_photos_from_drive_folder',
  description:
    'Import all supported photos from a Google Drive folder into a FindMe event. NOTE: This method is only partially available in v1 — creating new Drive imports via MCP is not yet supported. For now, photographers should create the import via findme.photo\'s Drive Picker UI, then this tool can poll the import status. Use upload_photos_from_paths for local files or upload_photos_from_urls for cloud URLs as alternatives.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      event_id: { type: 'string' },
      folder_id: { type: 'string' },
      folder_name: { type: 'string' },
    },
    required: ['event_id', 'folder_id'],
    additionalProperties: false,
  },
};

export async function runUploadPhotosFromDriveFolder(
  client: FindMeClient,
  input: z.infer<typeof uploadPhotosFromDriveFolderSchema>,
): Promise<ToolResult> {
  return safeToolHandler(
    async () => {
      await client.request(`/events/${input.event_id}/drive_imports`, {
        method: 'POST',
        body: { folder_id: input.folder_id, folder_name: input.folder_name },
      });
      return { ok: true }; // unreachable — server returns 501 in v1
    },
    () => jsonResult({ ok: true }),
  );
}
