import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useNav } from "../lib/nav";
import { pickImage } from "../lib/native";
import { AppBar, Avatar, Empty, Screen, Segmented, Sheet } from "../components/mobile";
import { ImageCrop } from "../components/ImageCrop";
import { Icon } from "../components/icons";

/** 性别取值与 Web / 服务端一致：0 保密 / 1 男 / 2 女 */
const GENDER_ITEMS: Array<{ key: string; label: string }> = [
  { key: "0", label: "保密" },
  { key: "1", label: "男" },
  { key: "2", label: "女" },
];

const NAME_MIN = 2;
const NAME_MAX = 20;
const INTRO_MAX = 200;
const AGE_MAX = 32;

/** 服务端 gender 可能是数字或字符串（历史数据），统一成 0/1/2 */
function normalizeGender(raw: unknown): string {
  const value = Number(raw);
  return value === 1 || value === 2 ? String(value) : "0";
}

/** 按字符（而非 UTF-16 码元）计数，口径与服务端的 rune 计数一致 */
function charCount(value: string): number {
  return Array.from(value).length;
}

/** 编辑资料（头像 / 昵称 / 性别 / 年龄 / 签名） */
export function ProfileEditScreen() {
  const user = useApp((s) => s.user);
  const refreshUser = useApp((s) => s.refreshUser);
  const showToast = useApp((s) => s.showToast);
  const { pop, push } = useNav();

  const [name, setName] = useState(user?.name ?? "");
  const [intro, setIntro] = useState(user?.intro ?? "");
  const [gender, setGender] = useState(() => normalizeGender(user?.gender));
  const [age, setAge] = useState(user?.age ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 头像：选择来源 → 裁剪（1:1）→ 上传
  const [sourceOpen, setSourceOpen] = useState(false);
  const [cropPath, setCropPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // 直接进入本页时 user 可能还没回来：拿到后补一次初值（只补一次，不覆盖用户输入）
  const hydrated = useRef(false);
  useEffect(() => {
    if (!user || hydrated.current) return;
    hydrated.current = true;
    setName(user.name ?? "");
    setIntro(user.intro ?? "");
    setGender(normalizeGender(user.gender));
    setAge(user.age ?? "");
  }, [user]);

  const openPicker = (source: "gallery" | "camera") => {
    setSourceOpen(false);
    void (async () => {
      try {
        const picked = await pickImage(source);
        setCropPath(picked.path);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "图片选择失败";
        // 用户取消选择不算错误（web 端会以「没有选择图片」拒绝）
        if (/没有选择|取消|cancel/i.test(message)) return;
        showToast(message, "error");
      }
    })();
  };

  const uploadCropped = async (dataUrl: string) => {
    const path = cropPath;
    setCropPath(null);
    setUploading(true);
    try {
      try {
        await api.uploadAvatarData(dataUrl);
      } catch (reason) {
        // 旧壳不支持直接上传裁剪结果时，退回上传原图（未裁剪）
        if (path && /不支持/.test(reason instanceof Error ? reason.message : "")) {
          await api.uploadAvatar(path);
        } else {
          throw reason;
        }
      }
      await refreshUser();
      showToast("头像已更新");
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "头像上传失败", "error");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (busy) return;
    setError("");
    const trimmedName = name.trim();
    const trimmedIntro = intro.trim();
    const trimmedAge = age.trim();
    if (charCount(trimmedName) < NAME_MIN || charCount(trimmedName) > NAME_MAX) {
      return setError(`昵称需 ${NAME_MIN}-${NAME_MAX} 个字符`);
    }
    if (charCount(trimmedIntro) > INTRO_MAX) return setError(`签名不能超过 ${INTRO_MAX} 字`);
    if (charCount(trimmedAge) > AGE_MAX) return setError(`年龄不能超过 ${AGE_MAX} 个字符`);
    setBusy(true);
    try {
      await api.updateProfile({ name: trimmedName, intro: trimmedIntro, gender: Number(gender), age: trimmedAge });
      await refreshUser();
      showToast("资料已更新");
      pop();
    } catch (reason) {
      // 失败保留表单内容，直接展示服务端文案
      setError(reason instanceof Error ? reason.message : "保存失败");
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <Screen appbar={<AppBar back title="编辑资料" />}>
        <Empty
          icon="user"
          title="请先登录"
          hint="登录后可以修改头像、昵称与签名"
          action={<button className="m-btn m-btn--primary" onClick={() => push("auth")}>登录 / 注册</button>}
        />
      </Screen>
    );
  }

  return (
    <>
      <Screen
        appbar={<AppBar back title="编辑资料" />}
        bodyClassName="pe-body"
        footer={
          <div className="m-actionbar pe-actionbar">
            <button type="button" className="m-btn m-btn--primary m-btn--block" disabled={busy || uploading} onClick={() => void save()}>
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        }
      >
        {/* 头像 */}
        <div className="pe-hero">
          <button
            type="button"
            className="pe-avatar"
            aria-label="更换头像"
            disabled={uploading}
            onClick={() => setSourceOpen(true)}
          >
            <Avatar src={user.avatar} name={user.name} size={92} />
            <span className="pe-avatar-badge" aria-hidden="true">
              {uploading ? <span className="m-spinner" /> : <Icon name="image" size={15} />}
            </span>
          </button>
          <div className="pe-hero-name">{name.trim() || user.name}</div>
          <button type="button" className="pe-hero-link" disabled={uploading} onClick={() => setSourceOpen(true)}>
            {uploading ? "头像上传中…" : "点击更换头像"}
          </button>
        </div>

        {/* 表单 */}
        <div className="pe-card">
          <div className="pe-field">
            <div className="pe-field-head">
              <label className="m-label" htmlFor="pe-name">昵称</label>
              <span className={`pe-counter ${charCount(name.trim()) > NAME_MAX ? "over" : ""}`.trim()}>
                {charCount(name.trim())}/{NAME_MAX}
              </span>
            </div>
            <input
              id="pe-name"
              className="m-input"
              type="text"
              value={name}
              placeholder="2-20 个字符"
              maxLength={NAME_MAX * 2}
              autoComplete="nickname"
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError("");
              }}
            />
          </div>

          <div className="pe-field">
            <span className="m-label">性别</span>
            <Segmented items={GENDER_ITEMS} value={gender} onChange={setGender} className="pe-seg" />
          </div>

          <div className="pe-field">
            <div className="pe-field-head">
              <label className="m-label" htmlFor="pe-age">年龄</label>
              <span className={`pe-counter ${charCount(age.trim()) > AGE_MAX ? "over" : ""}`.trim()}>
                {charCount(age.trim())}/{AGE_MAX}
              </span>
            </div>
            <input
              id="pe-age"
              className="m-input"
              type="text"
              value={age}
              placeholder="例如：18 / 不详"
              maxLength={AGE_MAX * 2}
              onChange={(event) => {
                setAge(event.target.value);
                if (error) setError("");
              }}
            />
            <p className="pe-hint">自由填写，最多 {AGE_MAX} 个字符</p>
          </div>

          <div className="pe-field">
            <div className="pe-field-head">
              <label className="m-label" htmlFor="pe-intro">签名</label>
              <span className={`pe-counter ${charCount(intro.trim()) > INTRO_MAX ? "over" : ""}`.trim()}>
                {charCount(intro.trim())}/{INTRO_MAX}
              </span>
            </div>
            <textarea
              id="pe-intro"
              className="m-textarea pe-intro"
              value={intro}
              placeholder="介绍一下自己…"
              maxLength={INTRO_MAX * 2}
              rows={4}
              onChange={(event) => {
                setIntro(event.target.value);
                if (error) setError("");
              }}
            />
          </div>

          {error ? <p className="pe-error" role="alert">{error}</p> : null}
        </div>

        <p className="pe-note">昵称、签名与头像会公开显示；年龄与性别只用于个人资料展示。</p>
      </Screen>

      {/* 头像来源 */}
      <Sheet open={sourceOpen} title="更换头像" onClose={() => setSourceOpen(false)}>
        <div className="pe-sheet">
          <button type="button" className="pe-sheet-item" onClick={() => openPicker("gallery")}>
            <span className="pe-sheet-icon"><Icon name="image" size={18} /></span>
            <span className="pe-sheet-text"><strong>从相册选择</strong><small>选好后可以拖动缩放裁剪</small></span>
            <Icon name="forward" size={17} />
          </button>
          <button type="button" className="pe-sheet-item" onClick={() => openPicker("camera")}>
            <span className="pe-sheet-icon"><Icon name="crop" size={18} /></span>
            <span className="pe-sheet-text"><strong>拍照</strong><small>现场拍一张再裁剪</small></span>
            <Icon name="forward" size={17} />
          </button>
        </div>
      </Sheet>

      {/* 1:1 裁剪 */}
      {cropPath ? (
        <ImageCrop
          file={cropPath}
          mode="avatar"
          onConfirm={(dataUrl) => void uploadCropped(dataUrl)}
          onCancel={() => setCropPath(null)}
        />
      ) : null}
    </>
  );
}
