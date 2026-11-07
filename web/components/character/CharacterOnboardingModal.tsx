"use client";

// 注册引导：新用户注册后跳转个人中心时只弹一次（服务端 users.character_prompt_seen_at 控制）。

import Modal from "@/components/ui/Modal";

export interface CharacterOnboardingModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: () => void;
}

/** 设定引导弹窗。 */
export default function CharacterOnboardingModal({ open, onClose, onCreate }: CharacterOnboardingModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      className="cs-onboard"
      overlayClassName="cs-onboard-overlay"
      cardClassName="cs-onboard-card"
      closeClassName="cs-onboard-close"
      lockScroll
    >
      <div className="cs-onboard-icon" aria-hidden="true">
        <i className="fa fa-id-card-o"></i>
      </div>
      <h3 className="cs-onboard-title">给你的角色留一张设定卡</h3>
      <p className="cs-onboard-text">
        设定记录会把角色的名字、能力、体态、语录这些整理成一张卡，展示在你的个人主页上——别人可以点赞，
        也能在发帖、评论、文章里直接引用。
      </p>
      <ul className="cs-onboard-list">
        <li>可以建多个角色，分别填写</li>
        <li>编辑时自动存草稿，点「完成并公开」才对外可见</li>
        <li>不想填也可以随时从个人中心回来补</li>
      </ul>
      <div className="cs-onboard-actions">
        <button type="button" className="cs-btn cs-btn-ghost" onClick={onClose}>
          以后再说
        </button>
        <button type="button" className="cs-btn cs-btn-primary" onClick={onCreate}>
          现在填写
        </button>
      </div>
      <p className="cs-onboard-hint">只会询问这一次</p>
    </Modal>
  );
}
