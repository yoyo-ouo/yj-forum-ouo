import React, { useEffect, useState } from "react";
import { Sheet } from "./mobile";
import { Icon } from "./icons";

export interface ReportSheetProps {
  open: boolean;
  onClose: () => void;
  /** 提交回调：成功后组件自行关闭；抛错则在弹层内展示错误文案 */
  onSubmit: (reason: string, detail: string) => Promise<void> | void;
  title?: string;
}

/** 举报原因（与桌面端/服务端口径一致） */
export const REPORT_REASONS: Array<{ value: string; label: string }> = [
  { value: "spam", label: "垃圾广告" },
  { value: "abuse", label: "辱骂攻击" },
  { value: "porn", label: "色情低俗" },
  { value: "illegal", label: "违法违规" },
  { value: "infringement", label: "侵权抄袭" },
  { value: "other", label: "其他" },
];

const DETAIL_LIMIT = 500;

/** 举报弹层：6 类原因 + 500 字补充说明 */
export function ReportSheet({ open, onClose, onSubmit, title = "举报帖子" }: ReportSheetProps) {
  const [reason, setReason] = useState("spam");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason("spam");
    setDetail("");
    setError("");
    setBusy(false);
  }, [open]);

  const submit = async () => {
    if (busy) return;
    if (!reason) {
      setError("请选择举报原因");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit(reason, detail.trim());
      onClose();
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : "举报失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      title={<span className="rp-title"><Icon name="flag" size={17} />{title}</span>}
      onClose={onClose}
      footer={
        <>
          <button className="m-btn m-btn--ghost" onClick={onClose} disabled={busy}>取消</button>
          <button className="m-btn m-btn--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "提交中…" : "提交举报"}
          </button>
        </>
      }
    >
      <div className="rp-reasons" role="radiogroup" aria-label="举报原因">
        {REPORT_REASONS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={reason === item.value}
            className={`rp-reason ${reason === item.value ? "on" : ""}`.trim()}
            onClick={() => setReason(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="rp-detail">
        <label className="m-label" htmlFor="rp-detail-input">补充说明（选填）</label>
        <textarea
          id="rp-detail-input"
          className="m-textarea rp-textarea"
          value={detail}
          maxLength={DETAIL_LIMIT}
          placeholder="写清楚哪里有问题，方便管理员处理"
          onChange={(event) => setDetail(event.target.value.slice(0, DETAIL_LIMIT))}
        />
        <span className="rp-count">{detail.length} / {DETAIL_LIMIT}</span>
      </div>
      {error ? <div className="rp-error"><Icon name="alert" size={15} />{error}</div> : null}
    </Sheet>
  );
}
