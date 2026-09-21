/**
 * AdminReportsPage — user-requested fraud-response kit (dispute queue).
 * Lists swap disputes (oldest first — same fair order as the moderation
 * queue). Resolve flow is deliberately a two-step HUMAN decision: pick the
 * remedy (Dismiss / Refund points) + a required resolution note — the
 * platform never auto-reverses a completed swap (automated reversal of money
 * = scammable; logged decision). REFUND reverses the swap's ledger pair via
 * ADJUSTED entries and closes the swap as CANCELLED (server-side). Errors
 * keep the dialog open (§5.9); success toasts (naming the parties) and
 * refetches.
 *
 * Redesign: hairline dispute cards, muted status pills, tokenized resolve
 * dialog. Logic, testids, and copy contracts unchanged.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import * as adminApi from '../lib/api/admin.js';
import AsyncBoundary from '../components/shared/AsyncBoundary.jsx';
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx';
import Pagination from '../components/shared/Pagination.jsx';
import { AdminTabs } from './AdminQueuePage.jsx';
import { useToast } from '../components/shared/ToastProvider.jsx';

const REASON_LABELS = {
  NO_SHOW: 'No-show / unreachable',
  ITEM_NOT_AS_DESCRIBED: 'Not as described',
  FAKE_ITEM: 'Fake item',
  OTHER: 'Other',
};

function userName(user) {
  if (!user) return 'unknown';
  return typeof user === 'object' ? (user.name ?? 'unknown') : 'unknown';
}

function Row({ report, onResolve }) {
  const swap = report.swapRequestId;
  const item = swap?.itemId;
  return (
    <li
      data-testid="admin-report-row"
      className="card space-y-2 p-4 transition-colors hover:bg-brand-50/40"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-status-red">
          {REASON_LABELS[report.reason] ?? report.reason}
        </span>
        <span className="text-sm font-semibold text-ink">
          {userName(report.reporterId)} reporting {userName(report.againstId)}
        </span>
        {report.status !== 'OPEN' && (
          <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold text-ink-2 ring-1 ring-hairline">
            {report.status}
          </span>
        )}
      </div>
      <p className="tabular text-sm text-ink-2">
        Swap: {swap?.type === 'POINTS_REDEMPTION' ? 'Points redemption' : 'Direct swap'} ·{' '}
        {item ? `“${item.title}” (${item.pointValue} pts)` : 'item unavailable'} · status{' '}
        {swap?.status ?? '?'}
      </p>
      {report.details && (
        <p className="rounded-[6px] bg-canvas px-3 py-2 text-sm text-ink ring-1 ring-hairline">
          “{report.details}”
        </p>
      )}
      {report.status === 'OPEN' ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onResolve(report)}
            className="pressable rounded-[6px] bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
          >
            Resolve
          </button>
        </div>
      ) : (
        <p className="text-xs text-stone-450">
          {report.remedy === 'REFUND' ? 'Refunded' : 'Closed without remedy'} —{' '}
          {report.resolutionNote}
        </p>
      )}
    </li>
  );
}

export default function AdminReportsPage() {
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState(null); // { report, remedy, note }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const { push } = useToast();

  const reportsQuery = useQuery({
    queryKey: ['admin-reports', page],
    queryFn: () => adminApi.listReports({ page, pageSize: 12 }),
    placeholderData: (prev) => prev,
  });

  async function confirmResolve() {
    setBusy(true);
    setError(null);
    try {
      const { refund } = await adminApi.resolveReport(
        resolving.report._id,
        resolving.remedy,
        resolving.note.trim()
      );
      setResolving(null);
      push(
        refund
          ? refund.shortfall
            ? `Refunded ${refund.amount} of ${refund.requested} pts (partial — balance was lower).`
            : `Refunded ${refund.amount} pts.`
          : 'Report dismissed with a note.',
        { tone: 'success' }
      );
      await queryClient.invalidateQueries({ queryKey: ['admin-reports'] });
    } catch (err) {
      setError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="pt-4">
        <p className="eyebrow">Admin</p>
        <h1 className="font-display mt-2 text-4xl text-ink">Reports</h1>
        <p className="mt-2 text-sm text-ink-2">
          Swap disputes. Every decision is human and audited — nothing reverses automatically.
        </p>
      </header>

      <AdminTabs active="Reports" />

      <AsyncBoundary
        query={reportsQuery}
        isEmpty={(d) => d?.total === 0}
        empty={
          <div className="card px-6 py-16 text-center">
            <p className="font-display text-2xl text-ink">No disputes filed</p>
            <p className="mt-2 text-sm text-ink-2">
              Reports about completed swaps will appear here for review.
            </p>
          </div>
        }
      >
        {(data) => (
          <>
            <p className="tabular text-sm text-ink-2" aria-live="polite">
              {data.total} report{data.total === 1 ? '' : 's'}
            </p>
            <ul className="space-y-3">
              {data.reports.map((report) => (
                <Row
                  key={report._id}
                  report={report}
                  onResolve={(r) => setResolving({ report: r, remedy: null, note: '' })}
                />
              ))}
            </ul>
            <Pagination page={data.page} totalPages={data.totalPages} onPage={(p) => setPage(p)} />
          </>
        )}
      </AsyncBoundary>

      {resolving && (
        <ConfirmDialog
          open
          busy={busy}
          title="Resolve this dispute?"
          confirmLabel="Confirm decision"
          confirmDisabled={!resolving.remedy || resolving.note.trim().length < 10}
          onConfirm={confirmResolve}
          onClose={() => !busy && setResolving(null)}
        >
          {/* §5.9: server errors surface INSIDE the open dialog so the admin
              can correct/retry without losing their in-progress decision. */}
          {error && (
            <p
              role="alert"
              className="mb-3 rounded-[6px] bg-red-50 px-3 py-2 text-sm text-status-red"
            >
              {error}
            </p>
          )}
          <div className="space-y-3">
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-semibold text-ink">Remedy</legend>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[6px] p-2 text-sm ring-1 ring-hairline transition-colors hover:bg-brand-50/60">
                <input
                  type="radio"
                  name="report-remedy"
                  checked={resolving.remedy === 'NONE'}
                  onChange={() => setResolving({ ...resolving, remedy: 'NONE' })}
                  className="accent-brand-600"
                />
                Dismiss — close with a note, no points move
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-[6px] p-2 text-sm ring-1 ring-hairline transition-colors hover:bg-brand-50/60">
                <input
                  type="radio"
                  name="report-remedy"
                  checked={resolving.remedy === 'REFUND'}
                  onChange={() => setResolving({ ...resolving, remedy: 'REFUND' })}
                  className="accent-brand-600"
                />
                Refund — reverse the swap&apos;s points (ADJUSTED entries, swap closed)
              </label>
            </fieldset>
            <div>
              <label htmlFor="resolution-note" className="block text-sm font-semibold text-ink">
                Resolution note <span className="font-normal text-status-red">(required)</span>
              </label>
              <textarea
                id="resolution-note"
                rows={3}
                maxLength={500}
                value={resolving.note}
                onChange={(e) => setResolving({ ...resolving, note: e.target.value })}
                placeholder="What did you find, and why this remedy?"
                className="field mt-1"
              />
            </div>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
