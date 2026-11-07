"use client";

import { useRouter } from "next/navigation";

/** 返回上一页按钮(带左箭头图标) */
export default function BackButton({
  className = "post-back-btn",
  label = "返回",
  onClick,
}: {
  className?: string;
  label?: string;
  /** 自定义返回行为（如先保存再离开）；缺省为 router.back() */
  onClick?: () => void;
}) {
  const router = useRouter();
  return (
    <a
      href="#"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        if (onClick) onClick();
        else router.back();
      }}
    >
      <i className="fa fa-arrow-left"></i> {label}
    </a>
  );
}
