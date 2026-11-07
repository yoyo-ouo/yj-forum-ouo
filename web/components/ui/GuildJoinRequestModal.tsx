"use client";

import { formatTime } from "@/lib/constants";
import type { GuildJoinRequestInfo } from "@/lib/api";
import Modal from "./Modal";

const STATUS_META: Record<number, { label: string; className: string }> = {
  0: { label: "待审核", className: "is-pending" },
  1: { label: "已通过", className: "is-approved" },
  2: { label: "未通过", className: "is-rejected" },
  3: { label: "已撤回", className: "is-withdrawn" },
};

/** 会馆入馆申请进度：申请理由、提交/处理时间与结果；待审可撤回，未通过可再次申请。 */
export default function GuildJoinRequestModal({
  open,
  onClose,
  guildName,
  request,
  busy,
  onCancel,
  onReapply,
}: {
  open: boolean;
  onClose: () => void;
  guildName: string;
  request: GuildJoinRequestInfo | null;
  busy?: boolean;
  onCancel?: () => void;
  onReapply?: () => void;
}) {
  if (!request) return null;
  const meta = STATUS_META[request.status] || { label: "处理中", className: "is-pending" };
  const isPending = request.status === 0;
  const canReapply = request.status === 2 || request.status === 3;
  const showApplyReason = !!request.reason && !(request.status === 2 && request.handled_note);

  return (
    <Modal open={open} onClose={onClose} cardStyle={{ maxWidth: 420 }} lockScroll>
      <h3 className="donate-title">
        <i className="fa fa-hourglass-half"></i> 入馆申请进度
      </h3>
      <div className={`guild-request-status ${meta.className}`}>
        <i className="fa fa-circle" aria-hidden="true"></i> {meta.label}
      </div>
      <dl className="guild-request-meta">
        <div>
          <dt>申请会馆</dt>
          <dd>{guildName}</dd>
        </div>
        <div>
          <dt>提交时间</dt>
          <dd>{formatTime(request.created_at || undefined) || "—"}</dd>
        </div>
        <div>
          <dt>处理时间</dt>
          <dd>{formatTime(request.handled_at || undefined) || "—"}</dd>
        </div>
      </dl>
      {showApplyReason && (
        <div className="guild-request-block">
          <h4>{request.status === 2 ? "未通过理由" : "申请理由"}</h4>
          <p>{request.reason}</p>
        </div>
      )}
      {request.handled_note && (
        <div className="guild-request-block">
          <h4>处理备注</h4>
          <p>{request.handled_note}</p>
        </div>
      )}
      {isPending && (
        <p className="guild-request-hint">
          <i className="fa fa-info-circle"></i> 审批结果会通过消息中心通知你，可以随时回来查看进度。
        </p>
      )}
      <div className="report-actions">
        <button type="button" className="report-cancel" disabled={busy} onClick={onClose}>
          关闭
        </button>
        {isPending && onCancel && (
          <button type="button" className="report-submit" disabled={busy} onClick={onCancel}>
            {busy ? "处理中..." : "撤回申请"}
          </button>
        )}
        {canReapply && onReapply && (
          <button type="button" className="report-submit" disabled={busy} onClick={onReapply}>
            {busy ? "提交中..." : "再次申请"}
          </button>
        )}
      </div>
    </Modal>
  );
}
