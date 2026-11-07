package main

import (
	"fmt"
	"strings"
)

func f1(v float64) string { return fmt.Sprintf("%.1f", v) }
func f2(v float64) string { return fmt.Sprintf("%.2f", v) }
func f0(v float64) string { return fmt.Sprintf("%.0f", v) }

func delta(v float64) string {
	if v == 0 {
		return "—"
	}
	if v > 0 {
		return "▲ " + f1(v) + "%"
	}
	return "▼ " + f1(-v) + "%"
}

func renderMarkdown(rep *Report) string {
	var b strings.Builder
	b.WriteString("# 基准跑分报告 · " + rep.Run.RunID + "\n\n")
	b.WriteString("- **规模**: " + rep.Run.Scale + "\n")
	b.WriteString("- **指纹**: `" + rep.Run.FingerprintKey + "`\n")
	b.WriteString("- **生成时间**: " + rep.GeneratedAt + "\n")
	if rep.HasBaseline {
		b.WriteString("- **对比基线**: " + rep.BaselineID)
		if !rep.BaselineSameFP {
			b.WriteString("（指纹不一致，仅展示绝对值）")
		}
		b.WriteString("\n")
	} else {
		b.WriteString("- **对比基线**: 无（首次跑分）\n")
	}
	b.WriteString("\n")

	b.WriteString("## 综合分\n\n")
	if !rep.Valid {
		b.WriteString("> ⚠️ **本次结果无效**：" + rep.InvalidReason + "\n\n")
	}
	if rep.HasBaseline && rep.BaselineSameFP {
		b.WriteString("| 综合分 | 说明 |\n|---|---|\n")
		b.WriteString(fmt.Sprintf("| **%s** | 加权几何平均；基线自身 = 1000；只在同指纹下纵向可比 |\n\n", f1(rep.Composite)))
	} else {
		b.WriteString("无基线，本次只给出绝对值。\n\n")
	}

	b.WriteString("## 场景明细（热跑，计分）\n\n")
	b.WriteString("| 场景 | RPS | p50 | p95 | p99 | 错误率 | 丢弃迭代 | 指数 | vs 基线 |\n")
	b.WriteString("|---|---:|---:|---:|---:|---:|---:|---:|---:|\n")
	for _, s := range rep.Warm {
		idx := "—"
		d := "—"
		if s.Index > 0 {
			idx = f1(s.Index)
			d = delta(s.DeltaPct)
		}
		b.WriteString(fmt.Sprintf("| %s | %s | %sms | %sms | %sms | %s%% | %s | %s | %s |\n",
			s.Name, f0(s.RPS), f1(s.P50), f1(s.P95), f1(s.P99),
			f2(s.FailRate*100), f0(s.Dropped), idx, d))
	}
	if rep.SSE != nil {
		b.WriteString(fmt.Sprintf("| sse | — | — | %sms | %sms | %s%% | — | — | — |\n",
			f1(rep.SSE.ConnectP95), f1(rep.SSE.ConnectP99), f2(float64(rep.SSE.Disconnects)/float64(max1(rep.SSE.Connections))*100)))
	}
	b.WriteString("\n")

	if len(rep.Capacity) > 0 {
		b.WriteString("## 容量阶梯（PROFILE=capacity）\n\n")
		b.WriteString(fmt.Sprintf("> SLO：p95 ≤ %sms 且错误率 ≤ 1%%。最大可持续到达率：**%s req/s**\n\n", f0(rep.CapacitySLO), f0(rep.CapacityMaxRPS)))
		b.WriteString("| 目标 RPS | 实际 RPS | p95 | p99 | 错误率 | 丢弃迭代 | 结论 |\n")
		b.WriteString("|---:|---:|---:|---:|---:|---|\n")
		for _, p := range rep.Capacity {
			verdict := "达标"
			if p.FailRate > 0.01 {
				verdict = "错误率超限"
			} else if p.P95 > rep.CapacitySLO {
				verdict = "p95 超 SLO"
			}
			b.WriteString(fmt.Sprintf("| %s | %s | %sms | %sms | %s%% | %s | %s |\n",
				f0(p.Rate), f0(p.RPS), f1(p.P95), f1(p.P99), f2(p.FailRate*100), f0(p.Dropped), verdict))
		}
		b.WriteString("\n")
	}

	if len(rep.Cold) > 0 {
		b.WriteString("## 冷跑 vs 热跑（p95，ms）\n\n")
		b.WriteString("| 场景 | 冷跑 | 热跑 | 差异 |\n|---|---:|---:|---:|\n")
		warmMap := map[string]Scenario{}
		for _, s := range rep.Warm {
			warmMap[s.Name] = s
		}
		for _, c := range rep.Cold {
			w, ok := warmMap[c.Name]
			if !ok {
				continue
			}
			pct := 0.0
			if c.P95 > 0 {
				pct = 100 * (c.P95 - w.P95) / c.P95
			}
			b.WriteString(fmt.Sprintf("| %s | %s | %s | %s |\n", c.Name, f1(c.P95), f1(w.P95), delta(pct)))
		}
		b.WriteString("\n> 冷跑 = 重启后进程内缓存为空的首轮；PG 共享缓存无法真正冷启。\n\n")
	}

	if rep.Bottleneck != nil {
		bn := rep.Bottleneck
		b.WriteString("## 瓶颈归因\n\n")
		b.WriteString("### 服务端资源\n\n| 指标 | 值 |\n|---|---:|\n")
		b.WriteString(fmt.Sprintf("| 连接池上限 | %s |\n", f0(bn.PoolMaxConns)))
		b.WriteString(fmt.Sprintf("| 连接池采样峰值占用 | %s |\n", f0(bn.PoolPeakAcquired)))
		b.WriteString(fmt.Sprintf("| 连接池空等次数 | %s |\n", f0(bn.PoolEmptyAcquire)))
		b.WriteString(fmt.Sprintf("| 连接池累计等待 | %sms |\n", f0(bn.PoolAcquireMS)))
		b.WriteString(fmt.Sprintf("| 缓存命中率 | %s%% |\n", f1(bn.CacheHitRate)))
		b.WriteString(fmt.Sprintf("| Go 堆峰值 | %s MB |\n", f1(bn.HeapPeakMB)))
		b.WriteString(fmt.Sprintf("| Goroutine 峰值 | %s |\n", f0(bn.GoroutinePeak)))
		b.WriteString(fmt.Sprintf("| 进程内存峰值 | %s MB |\n", f1(bn.PeakRSSMB)))
		b.WriteString(fmt.Sprintf("| 进程 CPU 累计 | %s s |\n", f1(bn.CPUTotalSec)))
		b.WriteString(fmt.Sprintf("| PG 缓存命中率 | %s%% |\n\n", f1(bn.PGHitRate)))

		if len(bn.TopSQL) > 0 {
			b.WriteString("### Top SQL（按 total_exec_time）\n\n")
			b.WriteString("| 平均耗时 | 调用次数 | 总耗时 | 语句 |\n|---:|---:|---:|---|\n")
			for _, t := range bn.TopSQL {
				q := strings.ReplaceAll(t.Query, "\n", " ")
				if len(q) > 140 {
					q = q[:140] + "…"
				}
				b.WriteString(fmt.Sprintf("| %sms | %d | %sms | `%s` |\n", f2(t.MeanExecMS), t.Calls, f0(t.TotalExecMS), q))
			}
			b.WriteString("\n")
		}
		if len(bn.SeqScans) > 0 {
			b.WriteString("### 顺序扫描 Top\n\n| 表 | seq_scan | idx_scan |\n|---|---:|---:|\n")
			for _, s := range bn.SeqScans {
				b.WriteString(fmt.Sprintf("| %s | %d | %d |\n", s.Table, s.SeqScan, s.IdxScan))
			}
			b.WriteString("\n")
		}
	}

	b.WriteString("---\n\n> 分数只在指纹（CPU/内存/PG/Go/k6/git）一致时纵向可比；不可与其他项目横向比较。\n")
	return b.String()
}

func max1(v int) int {
	if v < 1 {
		return 1
	}
	return v
}
