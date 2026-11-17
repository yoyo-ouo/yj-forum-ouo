// 可调宽度图片（发帖正文 / 评论编辑器 / 角色描述共用）
// - 宽度语义（仅用 width 属性承载，客户端/服务端净化器都禁用 style）：
//   · 无属性              → 原图尺寸，最大不超过容器宽（CSS width:auto + max-width:100%）
//   · width="50%"          → 相对容器宽度（响应式，窗口/手机自动跟随）
//   · width="600"          → 固定像素（仍受 max-width:100% 兜底，不溢出）
// - parseHTML 把百分号解析到 widthPct、纯数字解析到 width，两者互斥
// - imageWidthPlugin：视图层 Decoration 内联 style，仅作用于编辑视图，不写入序列化

import Image from "@tiptap/extension-image";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * 图片宽度视图层同步（Decoration）：遍历文档为带 width 的图片节点挂内联 style。
 * - 仅编辑视图装饰，不写入 getHTML()/序列化，存储仍为 width 属性
 * - 装饰随每次 transaction 由节点属性重算，更新/还原即时生效
 */
export function imageWidthPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "image") return;
          const pct = node.attrs.widthPct;
          const width = node.attrs.width;
          let style: string | null = null;
          if (typeof pct === "number" && pct > 0) style = `width: ${pct}%;`;
          else if (typeof width === "number" && width > 0) style = `width: ${width}px;`;
          if (style) decos.push(Decoration.node(pos, pos + node.nodeSize, { style }));
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

/** width 属性值：纯数字（px）或数字+百分号（相对宽度） */
const WIDTH_ATTR_RE = /^(\d+(?:\.\d+)?)(%?)$/;

function parseWidthAttr(element: HTMLElement): { px: number | null; pct: number | null } {
  const m = WIDTH_ATTR_RE.exec((element.getAttribute("width") ?? "").trim());
  if (!m) return { px: null, pct: null };
  const value = Math.round(Number(m[1]));
  if (!Number.isFinite(value) || value <= 0) return { px: null, pct: null };
  if (m[2] === "%") return { px: null, pct: Math.min(100, value) };
  return { px: value, pct: null };
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      /** 固定像素宽（width="600"） */
      width: {
        default: null,
        parseHTML: (element) => parseWidthAttr(element as HTMLElement).px,
        renderHTML: (attributes) =>
          attributes.widthPct ? {} : attributes.width ? { width: attributes.width } : {},
      },
      /** 相对容器宽度的百分比（width="50%"），优先于像素宽 */
      widthPct: {
        default: null,
        parseHTML: (element) => parseWidthAttr(element as HTMLElement).pct,
        renderHTML: (attributes) =>
          typeof attributes.widthPct === "number" && attributes.widthPct > 0
            ? { width: `${attributes.widthPct}%` }
            : {},
      },
    };
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), imageWidthPlugin()];
  },
});

/** 自定义宽度范围（px） */
export const MIN_IMAGE_WIDTH = 40;
export const MAX_IMAGE_WIDTH = 2400;
