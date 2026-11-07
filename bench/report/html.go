package main

import (
	"fmt"
	"html"
	"strings"
)

const reportCSS = `
*{box-sizing:border-box}body{margin:0;background:#eef0f4;color:#1b2330;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:1120px;margin:0 auto;padding:24px}
.head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px}
.kicker{font-size:11px;letter-spacing:.16em;color:#6b7788;font-weight:600}
h1{font-size:24px;margin:4px 0 0}
.chips{display:flex;flex-wrap:wrap;gap:8px;font-size:12px}
.chip{padding:4px 10px;border-radius:6px;background:#e2e6ee;color:#43506a}
.chip.good{background:#dff0e8;color:#1f6b4a}
.chip.bad{background:#f6e0da;color:#b0452f}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}
.card{background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(20,30,50,.06),0 1px 12px rgba(20,30,50,.04)}
.card .k{font-size:11px;color:#6b7788}
.card .v{font-size:24px;font-weight:700;margin-top:4px}
.card .d{font-size:11px;margin-top:4px;color:#6b7788}
.score{grid-column:span 1;background:#1f3a5f;color:#fff}
.score .k{color:rgba(255,255,255,.65)}
.score .v{font-size:44px;line-height:1;font-weight:900}
.score .d{color:rgba(255,255,255,.6)}
.good{color:#1f6b4a}.bad{color:#b0452f}
.tabs{display:flex;gap:4px;background:#e2e6ee;padding:4px;border-radius:8px;width:max-content;margin-bottom:12px}
.tab{border:0;background:transparent;padding:6px 14px;font-size:13px;border-radius:6px;cursor:pointer;color:#43506a;font-weight:500}
.tab.on{background:#1f3a5f;color:#fff}
.panel{display:none}.panel.on{display:block}
table{width:100%;border-collapse:collapse;font-size:12px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(20,30,50,.06)}
th{background:#f4f6f9;color:#5a6a80;font-weight:600;text-align:left;padding:10px 12px;white-space:nowrap}
td{padding:9px 12px;border-top:1px solid #eef1f5;white-space:nowrap}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
tr:hover td{background:#fafbfc}
.bar{display:flex;align-items:center;gap:12px;font-size:12px;margin:10px 0}
.bar .name{width:110px;color:#43506a}
.bar .track{flex:1;height:22px;background:#f0f2f6;border-radius:6px;position:relative;overflow:hidden}
.bar .fill{height:100%;background:#2f7d68;border-radius:6px;transition:width .7s cubic-bezier(.2,.8,.2,1)}
.bar .fill.bad{background:#c9743a}
.bar .base{position:absolute;top:0;bottom:0;left:25%;width:1px;background:#c2cad8}
.bar .val{width:56px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.note{font-size:11px;color:#6b7788;margin-top:10px;line-height:1.6}
.cols{display:grid;grid-template-columns:1.4fr 1fr;gap:14px}
.list{font-size:12px}
.list .row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #f0f2f6}
.list .row:last-child{border-bottom:0}
.q{color:#43506a;line-height:1.5;word-break:break-all}
small{color:#6b7788}
@media(max-width:820px){.grid{grid-template-columns:repeat(2,1fr)}.cols{grid-template-columns:1fr}}
`

const reportJS = `
function activate(name){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.toggle('on',t.dataset.tab===name)});
  document.querySelectorAll('.panel').forEach(function(p){p.classList.toggle('on',p.id==='panel-'+name)});
}
document.querySelectorAll('.tab').forEach(function(t){t.addEventListener('click',function(){activate(t.dataset.tab)})});
activate('overview');
window.addEventListener('load',function(){setTimeout(function(){document.querySelectorAll('[data-w]').forEach(function(e){e.style.width=e.dataset.w+'%'})},50)});
`

func renderHTML(rep *Report) string {
	var b strings.Builder
	b.WriteString("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">")
	b.WriteString("<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">")
	b.WriteString("<title>基准跑分报告 · " + html.EscapeString(rep.Run.RunID) + "</title><style>" + reportCSS + "</style></head><body><div class=\"wrap\">")

	b.WriteString("<div class=\"head\"><div><div class=\"kicker\">YJ-FORUM-OUO / BENCH</div><h1>后端基准跑分报告</h1></div><div class=\"chips\">")
	b.WriteString("<span class=\"chip\">scale = " + html.EscapeString(rep.Run.Scale) + "</span>")
	b.WriteString("<span class=\"chip\">run = " + html.EscapeString(rep.Run.RunID) + "</span>")
	b.WriteString("<span class=\"chip\">指纹 = " + html.EscapeString(rep.Run.FingerprintKey) + "</span>")
	if rep.HasBaseline {
		cls := "chip bad"
		if rep.BaselineSameFP {
			cls = "chip good"
		}
		b.WriteString("<span class=\"" + cls + "\">基线 " + html.EscapeString(rep.BaselineID) + "</span>")
	} else {
		b.WriteString("<span class=\"chip\">首次跑分 · 无基线</span>")
	}
	b.WriteString("</div></div>")

	// 顶部卡片
	totalRPS := 0.0
	worstP95 := 0.0
	for _, s := range rep.Warm {
		totalRPS += s.RPS
		if s.P95 > worstP95 {
			worstP95 = s.P95
		}
	}
	score := "N/A"
	if rep.HasBaseline && rep.BaselineSameFP {
		score = f1(rep.Composite)
	}
	b.WriteString("<div class=\"grid\">")
	b.WriteString("<div class=\"card score\"><div class=\"k\">综合跑分</div><div class=\"v\">" + score + "</div><div class=\"d\">基线自身 = 1000 · 加权几何平均</div></div>")
	b.WriteString(card("总吞吐", f0(totalRPS)+" <small>req/s</small>", "各场景 RPS 之和"))
	b.WriteString(card("最差 p95", f1(worstP95)+" <small>ms</small>", "取所有场景最大值"))
	if len(rep.Capacity) > 0 {
		b.WriteString(card("最大可持续 RPS", f0(rep.CapacityMaxRPS), "p95 ≤ "+f0(rep.CapacitySLO)+"ms"))
	} else if rep.Bottleneck != nil {
		b.WriteString(card("连接池空等", f0(rep.Bottleneck.PoolEmptyAcquire), "峰值占用 "+f0(rep.Bottleneck.PoolPeakAcquired)+" / "+f0(rep.Bottleneck.PoolMaxConns)))
	} else {
		b.WriteString(card("连接池空等", "—", "无指标数据"))
	}
	b.WriteString("</div>")

	if !rep.Valid {
		b.WriteString("<div class=\"card\" style=\"margin-bottom:14px;background:#f6e0da;color:#b0452f\">⚠️ 本次结果无效：" + html.EscapeString(rep.InvalidReason) + "</div>")
	}

	b.WriteString("<div class=\"tabs\"><button class=\"tab\" data-tab=\"overview\">场景总览</button><button class=\"tab\" data-tab=\"detail\">场景明细</button><button class=\"tab\" data-tab=\"bottleneck\">瓶颈归因</button></div>")

	// 总览
	hasIndex := rep.HasBaseline && rep.BaselineSameFP
	maxP95 := 0.0
	for _, s := range rep.Warm {
		if s.P95 > maxP95 {
			maxP95 = s.P95
		}
	}
	b.WriteString("<div class=\"panel\" id=\"panel-overview\"><div class=\"card\"><div style=\"font-size:13px;font-weight:600;margin-bottom:6px\">")
	if hasIndex {
		b.WriteString("各场景性能指数（100 = 与基线持平）")
	} else {
		b.WriteString("各场景 p95（无基线，按绝对值展示）")
	}
	b.WriteString("</div>")
	for _, s := range rep.Warm {
		if hasIndex && s.Index > 0 {
			width := s.Index / 1.5
			if width > 100 {
				width = 100
			}
			cls := "fill"
			if s.Index < 100 {
				cls = "fill bad"
			}
			b.WriteString(fmt.Sprintf("<div class=\"bar\"><div class=\"name\">%s</div><div class=\"track\"><div class=\"%s\" data-w=\"%s\"></div><div class=\"base\"></div></div><div class=\"val\">%s</div></div>",
				html.EscapeString(s.Name), cls, f1(width), f1(s.Index)))
			continue
		}
		width := 0.0
		if maxP95 > 0 {
			width = s.P95 / maxP95 * 100
		}
		b.WriteString(fmt.Sprintf("<div class=\"bar\"><div class=\"name\">%s</div><div class=\"track\"><div class=\"fill\" data-w=\"%s\"></div></div><div class=\"val\">%sms</div></div>",
			html.EscapeString(s.Name), f1(width), f1(s.P95)))
	}
	if hasIndex {
		b.WriteString("<div class=\"note\">竖线为基线位置（100）。绿色为改善，橙色为退化。分数只在同指纹下纵向可比。</div>")
	} else {
		b.WriteString("<div class=\"note\">首次跑分没有基线，这里展示绝对 p95；下一次同指纹/同跑法的运行会自动产生指数与涨跌。</div>")
	}
	if len(rep.Capacity) > 0 {
		b.WriteString("<div style=\"font-size:13px;font-weight:600;margin:18px 0 8px\">容量阶梯（p95 ≤ " + f0(rep.CapacitySLO) + "ms）</div><table><thead><tr><th>目标 RPS</th><th class=\"num\">实际 RPS</th><th class=\"num\">p95</th><th class=\"num\">p99</th><th class=\"num\">错误率</th><th>结论</th></tr></thead><tbody>")
		for _, p := range rep.Capacity {
			verdict := "达标"
			cls := "good"
			if p.FailRate > 0.01 {
				verdict, cls = "错误率超限", "bad"
			} else if p.P95 > rep.CapacitySLO {
				verdict, cls = "p95 超 SLO", "bad"
			}
			b.WriteString(fmt.Sprintf("<tr><td>%s</td><td class=\"num\">%s</td><td class=\"num\">%sms</td><td class=\"num\">%sms</td><td class=\"num\">%s%%</td><td class=\"%s\">%s</td></tr>",
				f0(p.Rate), f0(p.RPS), f1(p.P95), f1(p.P99), f2(p.FailRate*100), cls, verdict))
		}
		b.WriteString("</tbody></table>")
	}
	b.WriteString("</div></div>")

	// 明细
	b.WriteString("<div class=\"panel\" id=\"panel-detail\"><table><thead><tr><th>场景</th><th class=\"num\">RPS</th><th class=\"num\">p50</th><th class=\"num\">p95</th><th class=\"num\">p99</th><th class=\"num\">错误率</th><th class=\"num\">丢弃</th><th class=\"num\">指数</th><th class=\"num\">vs 基线</th></tr></thead><tbody>")
	for _, s := range rep.Warm {
		idx, d := "—", "—"
		if s.Index > 0 {
			idx = f1(s.Index)
			d = delta(s.DeltaPct)
		}
		b.WriteString(fmt.Sprintf("<tr><td>%s</td><td class=\"num\">%s</td><td class=\"num\">%sms</td><td class=\"num\">%sms</td><td class=\"num\">%sms</td><td class=\"num\">%s%%</td><td class=\"num\">%s</td><td class=\"num\">%s</td><td class=\"num\">%s</td></tr>",
			html.EscapeString(s.Name), f0(s.RPS), f1(s.P50), f1(s.P95), f1(s.P99), f2(s.FailRate*100), f0(s.Dropped), idx, d))
	}
	if rep.SSE != nil {
		b.WriteString(fmt.Sprintf("<tr><td>sse</td><td class=\"num\">—</td><td class=\"num\">—</td><td class=\"num\">%sms</td><td class=\"num\">%sms</td><td class=\"num\">—</td><td class=\"num\">—</td><td class=\"num\">—</td><td class=\"num\">—</td></tr>", f1(rep.SSE.ConnectP95), f1(rep.SSE.ConnectP99)))
	}
	b.WriteString("</tbody></table></div>")

	// 瓶颈
	b.WriteString("<div class=\"panel\" id=\"panel-bottleneck\"><div class=\"cols\"><div class=\"card\">")
	b.WriteString("<div style=\"font-size:13px;font-weight:600;margin-bottom:8px\">Top SQL（按 total_exec_time）</div><div class=\"list\">")
	if rep.Bottleneck != nil && len(rep.Bottleneck.TopSQL) > 0 {
		for _, t := range rep.Bottleneck.TopSQL {
			q := t.Query
			if len(q) > 180 {
				q = q[:180] + "…"
			}
			q = html.EscapeString(q)
			b.WriteString(fmt.Sprintf("<div class=\"row\"><div class=\"q\">%s</div><div style=\"text-align:right;flex-shrink:0\"><div><b>%sms</b></div><div><small>平均 · %d 次</small></div></div></div>", q, f2(t.MeanExecMS), t.Calls))
		}
	} else {
		b.WriteString("<div class=\"q\">无 SQL 统计（检查 pg_stat_statements）</div>")
	}
	b.WriteString("</div></div><div>")
	if rep.Bottleneck != nil {
		bn := rep.Bottleneck
		b.WriteString("<div class=\"card\" style=\"margin-bottom:14px\"><div style=\"font-size:13px;font-weight:600;margin-bottom:8px\">连接池</div><div class=\"list\">")
		b.WriteString(kv("上限", f0(bn.PoolMaxConns)))
		b.WriteString(kv("采样峰值占用", f0(bn.PoolPeakAcquired)))
		b.WriteString(kv("空等次数", f0(bn.PoolEmptyAcquire)))
		b.WriteString(kv("累计等待", f0(bn.PoolAcquireMS)+" ms"))
		b.WriteString("</div></div>")
		b.WriteString("<div class=\"card\" style=\"margin-bottom:14px\"><div style=\"font-size:13px;font-weight:600;margin-bottom:8px\">缓存与资源</div><div class=\"list\">")
		b.WriteString(kv("缓存命中率", f1(bn.CacheHitRate)+"%"))
		b.WriteString(kv("PG 缓存命中", f1(bn.PGHitRate)+"%"))
		b.WriteString(kv("Go 堆峰值", f1(bn.HeapPeakMB)+" MB"))
		b.WriteString(kv("进程内存峰值", f1(bn.PeakRSSMB)+" MB"))
		b.WriteString(kv("Goroutine 峰值", f0(bn.GoroutinePeak)))
		b.WriteString("</div></div>")
		if len(bn.SeqScans) > 0 {
			b.WriteString("<div class=\"card\"><div style=\"font-size:13px;font-weight:600;margin-bottom:8px\">顺序扫描 Top</div><div class=\"list\">")
			for _, s := range bn.SeqScans {
				b.WriteString(kv(s.Table, f0(float64(s.SeqScan))))
			}
			b.WriteString("</div></div>")
		}
	}
	b.WriteString("</div></div></div>")

	b.WriteString("<div class=\"note\">分数只在指纹（CPU/内存/PG/Go/k6/git）一致时纵向可比，不可与其他项目横向比较。生成时间：" + html.EscapeString(rep.GeneratedAt) + "</div>")
	b.WriteString("</div><script>" + reportJS + "</script></body></html>")
	return b.String()
}

func card(k, v, d string) string {
	return "<div class=\"card\"><div class=\"k\">" + html.EscapeString(k) + "</div><div class=\"v\">" + v + "</div><div class=\"d\">" + html.EscapeString(d) + "</div></div>"
}

func kv(k, v string) string {
	return "<div class=\"row\"><span>" + html.EscapeString(k) + "</span><span><b>" + html.EscapeString(v) + "</b></span></div>"
}
