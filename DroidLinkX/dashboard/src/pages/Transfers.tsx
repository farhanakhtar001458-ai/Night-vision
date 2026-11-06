import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { filesApi, transfersApi } from '@/services/api';
import { useToast } from '@/context/ToastContext';
import { useDevices } from '@/hooks/useDevices';
import { EmptyState, ErrorBanner, GlassCard, PageHeader, ProgressBar, Skeleton } from '@/components/ui';
import { cn, formatBytes, relativeTime, sha256Hex, titleCase } from '@/lib/format';
import type { Transfer } from '@/lib/types';

type UploadState = {
  transferId: string | null;
  name: string;
  bytes: number;
  total: number;
  percent: number;
  phase: 'creating' | 'uploading' | 'verifying' | 'done' | 'failed';
  error?: string;
};

const STATUS_TONE: Record<string, string> = {
  completed: 'border-brand-400/30 bg-brand-500/10 text-brand-200',
  active: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
  pending: 'border-white/15 bg-white/5 text-slate-300',
  paused: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
  failed: 'border-rose-400/30 bg-rose-500/10 text-rose-200',
  cancelled: 'border-white/15 bg-white/5 text-slate-400',
};

export function TransfersPage() {
  const { devices } = useDevices();
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [history, setHistory] = useState<Array<{ id: string; transferId: string; event: string; bytes: number; direction: string; createdAt: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [targetDevice, setTargetDevice] = useState('');

  const load = async () => {
    try {
      const [list, historyList] = await Promise.all([transfersApi.list(), transfersApi.history()]);
      setTransfers(list);
      setHistory(historyList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load transfers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, []);

  const totals = useMemo(
    () => ({
      active: transfers.filter((transfer) => ['active', 'pending', 'paused'].includes(transfer.status)).length,
      bytes: transfers.filter((transfer) => transfer.status === 'completed').reduce((sum, transfer) => sum + transfer.totalBytes, 0),
      failed: transfers.filter((transfer) => transfer.status === 'failed').length,
    }),
    [transfers],
  );

  const startUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const allFiles = Array.from(fileList);
    for (const file of allFiles) {
      setUpload({ transferId: null, name: file.name, bytes: 0, total: file.size, percent: 0, phase: 'creating' });
      try {
        const buffer = await file.arrayBuffer();
        const checksum = await sha256Hex(buffer);
        const created = await transfersApi.create({
          direction: targetDevice ? 'dashboard_to_device' : 'device_to_cloud',
          mode: 'relay',
          targetDeviceId: targetDevice || null,
          items: [{ name: file.name, size: file.size, sha256: checksum }],
        });
        const transfer = created.transfer;
        setUpload({ transferId: transfer.id, name: file.name, bytes: 0, total: file.size, percent: 0, phase: 'uploading' });
        await pushChunks(transfer, 0, file);
        setUpload((current) => (current ? { ...current, phase: 'verifying', percent: 99 } : current));
        await transfersApi.completeItem(transfer.id, 0, checksum);
        setUpload((current) => (current ? { ...current, phase: 'done', percent: 100, bytes: file.size } : current));
        push({ kind: 'success', title: `${file.name} transferred`, description: 'All chunks received and the SHA-256 checksum matched.' });
        await load();
        await filesApi.list();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Transfer failed';
        setUpload((current) => (current ? { ...current, phase: 'failed', error: message } : current));
        push({ kind: 'error', title: `Transfer failed: ${file.name}`, description: message });
      } finally {
        setTimeout(() => setUpload(null), 4000);
      }
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  const pushChunks = async (transfer: Transfer, itemIndex: number, file: File) => {
    const chunkSize = transfer.chunkSize || 8 * 1024 * 1024;
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
    const alreadyReceived = new Set(
      (transfer.receivedChunkIndexes ?? []).filter((chunk) => chunk.item_index === itemIndex).map((chunk) => chunk.chunk_index),
    );
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      if (alreadyReceived.has(chunkIndex)) continue;
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const blob = file.slice(start, end);
      await transfersApi.uploadChunk(transfer.id, itemIndex, chunkIndex, blob);
      const bytes = end;
      setUpload((current) =>
        current
          ? {
              ...current,
              bytes,
              percent: Math.min(98, Math.round((bytes / file.size) * 100)),
              phase: 'uploading',
            }
          : current,
      );
    }
  };

  const act = async (id: string, action: 'pause' | 'resume' | 'cancel' | 'retry') => {
    try {
      await transfersApi.action(id, action);
      push({ kind: 'success', title: `Transfer ${action}d` });
      await load();
    } catch (err) {
      push({ kind: 'error', title: `Could not ${action} the transfer`, description: err instanceof Error ? err.message : '' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Chunked · resumable · checksum verified"
        title="Transfers"
        subtitle="Every file is split into 8 MiB chunks with per-chunk idempotency. Interrupted sessions resume from the last acknowledged chunk instead of restarting."
        actions={
          <>
            <select className="input w-auto" value={targetDevice} onChange={(event) => setTargetDevice(event.target.value)}>
              <option value="">Relay to cloud</option>
              {devices.filter((device) => device.online).map((device) => (
                <option key={device.id} value={device.id}>
                  Send to {device.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn-primary" onClick={() => inputRef.current?.click()}>
              <UploadCloud className="h-4 w-4" /> New transfer
            </button>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => void startUpload(event.target.files)} />
          </>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <GlassCard className="flex items-center gap-4">
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-sky-300">
            <ArrowLeftRight className="h-5 w-5" />
          </span>
          <div>
            <p className="label">In flight</p>
            <p className="text-xl font-semibold text-white">{totals.active}</p>
          </div>
        </GlassCard>
        <GlassCard className="flex items-center gap-4">
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-brand-300">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <p className="label">Completed volume</p>
            <p className="text-xl font-semibold text-white">{formatBytes(totals.bytes)}</p>
          </div>
        </GlassCard>
        <GlassCard className="flex items-center gap-4">
          <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-rose-300">
            <XCircle className="h-5 w-5" />
          </span>
          <div>
            <p className="label">Failed</p>
            <p className="text-xl font-semibold text-white">{totals.failed}</p>
          </div>
        </GlassCard>
      </div>

      {upload ? (
        <GlassCard>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-slate-100">
              <UploadCloud className="h-4 w-4 text-brand-300" />
              {upload.name}
              <span className="chip">{upload.phase}</span>
            </span>
            <span className="text-slate-400">
              {formatBytes(upload.bytes)} / {formatBytes(upload.total)}
            </span>
          </div>
          <ProgressBar className="mt-3" value={upload.percent} tone={upload.phase === 'failed' ? 'amber' : 'brand'} />
          {upload.error ? <p className="mt-2 text-[11px] text-rose-300">{upload.error}</p> : null}
          {upload.transferId ? (
            <p className="mt-2 font-mono text-[10px] text-slate-500">session {upload.transferId}</p>
          ) : null}
        </GlassCard>
      ) : null}

      <GlassCard className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-white/[0.06] p-4">
          <h2 className="text-sm font-semibold text-slate-100">Transfer sessions</h2>
          <button type="button" onClick={() => void load()} className="text-xs font-semibold text-brand-300">
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-16 w-full" />
            ))}
          </div>
        ) : transfers.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ArrowLeftRight className="h-6 w-6" />}
              title="No transfer sessions yet"
              description="Start a transfer to move a file between devices or into the relay. Progress is streamed live over the authenticated WebSocket."
              action={
                <button type="button" className="btn-primary" onClick={() => inputRef.current?.click()}>
                  <UploadCloud className="h-4 w-4" /> Start a transfer
                </button>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {transfers.map((transfer) => {
              const isOpen = expanded === transfer.id;
              return (
                <li key={transfer.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : transfer.id)}
                      className="focus-ring flex min-w-0 flex-1 items-center gap-3 text-left"
                      aria-expanded={isOpen}
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-100">
                          {transfer.items[0]?.name ?? 'Transfer'}
                          {transfer.itemCount > 1 ? ` + ${transfer.itemCount - 1} more` : ''}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                          {titleCase(transfer.direction)} · {transfer.mode} · {transfer.itemCount} item(s) · {formatBytes(transfer.totalBytes)}
                        </p>
                      </div>
                    </button>
                    <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide', STATUS_TONE[transfer.status] ?? '')}>
                      {transfer.status}
                    </span>
                    <div className="w-32">
                      <ProgressBar value={transfer.percent} tone={transfer.status === 'failed' ? 'amber' : 'brand'} />
                      <p className="mt-1 text-right text-[10px] text-slate-500">{transfer.percent}%</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {['pending', 'active'].includes(transfer.status) ? (
                        <button type="button" onClick={() => void act(transfer.id, 'pause')} className="focus-ring rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-amber-300" aria-label="Pause transfer">
                          <Pause className="h-4 w-4" />
                        </button>
                      ) : null}
                      {transfer.status === 'paused' ? (
                        <button type="button" onClick={() => void act(transfer.id, 'resume')} className="focus-ring rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-brand-300" aria-label="Resume transfer">
                          <Play className="h-4 w-4" />
                        </button>
                      ) : null}
                      {['failed', 'cancelled'].includes(transfer.status) ? (
                        <button type="button" onClick={() => void act(transfer.id, 'retry')} className="focus-ring rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-brand-300" aria-label="Retry transfer">
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      ) : null}
                      {['pending', 'active', 'paused', 'failed'].includes(transfer.status) ? (
                        <button type="button" onClick={() => void act(transfer.id, 'cancel')} className="focus-ring rounded-lg p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300" aria-label="Cancel transfer">
                          <XCircle className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {isOpen ? (
                    <div className="mt-3 space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span className="font-mono">{transfer.id}</span>
                        <span>created {relativeTime(transfer.createdAt)}</span>
                      </div>
                      {transfer.items.map((item) => (
                        <div key={item.id} className="space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="truncate text-slate-200">{item.name}</span>
                            <span className="text-slate-500">
                              {formatBytes(item.bytesReceived)} / {formatBytes(item.size)}
                              {item.checksumVerified ? ' · checksum ok' : ''}
                            </span>
                          </div>
                          <ProgressBar value={item.size ? (item.bytesReceived / item.size) * 100 : 0} />
                          {item.error ? <p className="text-[10px] text-rose-300">{item.error}</p> : null}
                        </div>
                      ))}
                      {transfer.error ? <p className="text-[11px] text-rose-300">{transfer.error}</p> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </GlassCard>

      <GlassCard>
        <h2 className="mb-3 text-sm font-semibold text-slate-100">Transfer history</h2>
        {history.length === 0 ? (
          <p className="text-xs text-slate-500">No history yet.</p>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto text-[11px]">
            {history.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 border-b border-white/[0.04] pb-2">
                <span className="flex items-center gap-2 text-slate-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                  {titleCase(entry.event)}
                </span>
                <span className="text-slate-500">
                  {formatBytes(entry.bytes)} · {relativeTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
