"use client";

import { useRouter } from "next/navigation";

/** 返回上一页按钮(带左箭头图标) */
export default function BackButton({
  className = "post-back-btn",
  label = "返回",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  return (
    <a
      href="#"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        router.back();
      }}
    >
      <i className="fa fa-arrow-left"></i> {label}
    </a>
  );
}
