import {
  Download,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  FolderOpen,
  HardDrive,
  Pencil,
  Search,
  Smartphone,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { filesApi } from '@/services/api';
import { useToast } from '@/context/ToastContext';
import { useDevices } from '@/hooks/useDevices';
import { EmptyState, ErrorBanner, GlassCard, Modal, PageHeader, ProgressBar, Skeleton } from '@/components/ui';
import { cn, formatBytes, relativeTime, sha256Hex, titleCase } from '@/lib/format';
import type { RelayFile, StorageSummary } from '@/lib/types';

const CATEGORIES = [
  { key: '', label: 'All files' },
  { key: 'images', label: 'Images' },
  { key: 'videos', label: 'Videos' },
  { key: 'music', label: 'Music' },
  { key: 'documents', label: 'Documents' },
  { key: 'apk', label: 'APK' },
];

function FileIcon({ category }: { category: string }) {
  const map = {
    images: FileImage,
    videos: FileVideo,
    music: FileAudio,
    apk: FileArchive,
    documents: FileText,
  } as const;
  const Icon = map[category as keyof typeof map] ?? FileText;
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-brand-300">
      <Icon className="h-4 w-4" />
    </span>
  );
}

export function FilesPage() {
  const { devices } = useDevices();
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<RelayFile[]>([]);
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('');
  const [uploading, setUploading] = useState<{ name: string; progress: number } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RelayFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<RelayFile | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await filesApi.list({
        category: category || undefined,
        search: search.trim() || undefined,
        deviceId: deviceFilter || undefined,
      });
      setFiles(data.files);
      setStorage(data.storage);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, deviceFilter]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const uploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    for (const file of Array.from(fileList)) {
      setUploading({ name: file.name, progress: 5 });
      try {
        const buffer = await file.arrayBuffer();
        const checksum = await sha256Hex(buffer);
        setUploading({ name: file.name, progress: 40 });
        await filesApi.upload(file, {
          checksum,
          onProgress: (progress) => setUploading({ name: file.name, progress }),
        });
        push({ kind: 'success', title: `${file.name} uploaded`, description: `${formatBytes(file.size)} · checksum verified` });
      } catch (err) {
        push({
          kind: 'error',
          title: `Upload failed: ${file.name}`,
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      } finally {
        setUploading(null);
      }
    }
    if (inputRef.current) inputRef.current.value = '';
    await load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Authenticated cloud relay"
        title="File manager"
        subtitle="Files relayed through the backend for cross-network transfer. Device storage browsing happens on-device through the Storage Access Framework and never bypasses scoped storage."
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => void load()}>
              Refresh
            </button>
            <button type="button" className="btn-primary" onClick={() => inputRef.current?.click()}>
              <UploadCloud className="h-4 w-4" /> Upload
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => void uploadFiles(event.target.files)}
            />
          </>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {uploading ? (
        <GlassCard className="py-4">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-slate-200">
              <UploadCloud className="h-4 w-4 text-brand-300" /> Uploading {uploading.name}
            </span>
            <span className="text-slate-400">{Math.round(uploading.progress)}%</span>
          </div>
          <ProgressBar className="mt-2" value={uploading.progress} />
        </GlassCard>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <GlassCard className="overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b border-white/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                className="input pl-9"
                placeholder="Search relayed files…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select className="input sm:w-auto" value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}>
              <option value="">All devices</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2 border-b border-white/[0.06] px-4 py-3">
            {CATEGORIES.map((item) => {
              const count = item.key ? storage?.byCategory[item.key] ?? 0 : storage?.fileCount ?? 0;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setCategory(item.key)}
                  className={cn(
                    'focus-ring rounded-full border px-3 py-1 text-[11px] font-semibold transition',
                    category === item.key
                      ? 'border-brand-400/40 bg-brand-500/15 text-brand-200'
                      : 'border-white/10 text-slate-400 hover:bg-white/5',
                  )}
                >
                  {item.label}
                  <span className="ml-1.5 text-slate-500">{count}</span>
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((row) => (
                <Skeleton key={row} className="h-14 w-full" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<FolderOpen className="h-6 w-6" />}
                title="No relayed files"
                description="Upload a file here, or send one from an enrolled device. Transfers are chunked, resumable and checksum verified."
                action={
                  <button type="button" className="btn-primary" onClick={() => inputRef.current?.click()}>
                    <UploadCloud className="h-4 w-4" /> Upload a file
                  </button>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3 font-semibold">File</th>
                    <th className="px-4 py-3 font-semibold">Size</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Added</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => (
                    <tr key={file.id} className="table-row">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <FileIcon category={file.category} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-100">{file.name}</p>
                            <p className="truncate font-mono text-[10px] text-slate-500">
                              {file.sha256 ? file.sha256.slice(0, 16) : 'no checksum'}…
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{formatBytes(file.size)}</td>
                      <td className="px-4 py-3">
                        <span className="chip">{titleCase(file.category)}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{relativeTime(file.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="focus-ring rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-brand-300"
                            aria-label={`Download ${file.name}`}
                            onClick={async () => {
                              try {
                                await filesApi.download(file, file.name);
                                push({ kind: 'success', title: 'Download started', description: 'Signed link is valid for a few minutes.' });
                              } catch (err) {
                                push({ kind: 'error', title: 'Download failed', description: err instanceof Error ? err.message : '' });
                              }
                            }}
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="focus-ring rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-slate-100"
                            aria-label={`Rename ${file.name}`}
                            onClick={() => {
                              setRenameTarget(file);
                              setRenameValue(file.name);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="focus-ring rounded-lg p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"
                            aria-label={`Delete ${file.name}`}
                            onClick={() => setDeleteTarget(file)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>

        <div className="space-y-4">
          <GlassCard>
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-brand-300" />
              <h2 className="text-sm font-semibold text-slate-100">Relay storage</h2>
            </div>
            <p className="mt-3 text-2xl font-semibold text-white">{formatBytes(storage?.totalBytes ?? 0)}</p>
            <p className="text-[11px] text-slate-400">{storage?.fileCount ?? 0} file(s)</p>
            <ProgressBar className="mt-3" value={Math.min(100, ((storage?.totalBytes ?? 0) / (1024 * 1024 * 1024)) * 100)} />
            <p className="mt-1.5 text-[10px] text-slate-500">Reference scale: 1 GB</p>
            <ul className="mt-4 space-y-2 text-[11px]">
              {Object.entries(storage?.byCategory ?? {}).map(([key, count]) => (
                <li key={key} className="flex items-center justify-between">
                  <span className="text-slate-400">{titleCase(key)}</span>
                  <span className="font-semibold text-slate-200">{count}</span>
                </li>
              ))}
            </ul>
          </GlassCard>

          <GlassCard>
            <div className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-accent-400" />
              <h2 className="text-sm font-semibold text-slate-100">On-device browsing</h2>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              Browsing internal storage, Downloads, Documents, Pictures and APKs runs on the device through SAF. The
              dashboard can only see folders the owner granted inside the Android app.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Files here are the temporary relay copies. Downloads use short-lived signed URLs and expire automatically.
            </p>
          </GlassCard>
        </div>
      </div>

      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="Rename file"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                if (!renameTarget) return;
                try {
                  await filesApi.rename(renameTarget.id, renameValue);
                  setRenameTarget(null);
                  await load();
                  push({ kind: 'success', title: 'File renamed' });
                } catch (err) {
                  push({ kind: 'error', title: 'Rename failed', description: err instanceof Error ? err.message : '' });
                }
              }}
            >
              Save
            </button>
          </>
        }
      >
        <input className="input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus />
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete file?"
        description="The relay copy and its stored bytes are removed. Future signed links stop working immediately."
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={async () => {
                if (!deleteTarget) return;
                try {
                  await filesApi.remove(deleteTarget.id);
                  setDeleteTarget(null);
                  await load();
                  push({ kind: 'success', title: 'File deleted' });
                } catch (err) {
                  push({ kind: 'error', title: 'Delete failed', description: err instanceof Error ? err.message : '' });
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-300">{deleteTarget?.name}</p>
      </Modal>
    </div>
  );
}
