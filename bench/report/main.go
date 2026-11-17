// Command report 汇总 k6 结果与采集指标，生成 Markdown / JSON / HTML 报告。
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type RunMeta struct {
	RunID          string          `json:"run_id"`
	Scale          string          `json:"scale"`
	Profile        string          `json:"profile"`
	Fingerprint    json.RawMessage `json:"fingerprint"`
	FingerprintKey string          `json:"fingerprint_key"`
	ConfigHash     string          `json:"config_hash"`
	StartedAt      string          `json:"started_at"`
	FinishedAt     string          `json:"finished_at"`
}

// CapacityPoint 容量阶梯测试的一个档位。
type CapacityPoint struct {
	Rate     float64 `json:"rate"`
	RPS      float64 `json:"rps"`
	P95      float64 `json:"p95_ms"`
	P99      float64 `json:"p99_ms"`
	FailRate float64 `json:"fail_rate"`
	Dropped  float64 `json:"dropped_iterations"`
}

type K6Summary struct {
	Metrics map[string]struct {
		Values map[string]float64 `json:"values"`
	} `json:"metrics"`
	RootGroup struct {
		Checks []Check `json:"checks"`
	} `json:"root_group"`
}

type Check struct {
	Name   string `json:"name"`
	Passes int    `json:"passes"`
	Fails  int    `json:"fails"`
}

type Scenario struct {
	Name       string  `json:"name"`
	Phase      string  `json:"phase"`
	RPS        float64 `json:"rps"`
	Count      float64 `json:"count"`
	P50        float64 `json:"p50_ms"`
	P95        float64 `json:"p95_ms"`
	P99        float64 `json:"p99_ms"`
	FailRate   float64 `json:"fail_rate"`
	Dropped    float64 `json:"dropped_iterations"`
	ChecksPass int     `json:"checks_pass"`
	ChecksFail int     `json:"checks_fail"`
	Index      float64 `json:"index"`
	DeltaPct   float64 `json:"delta_pct"`
}

type SSEStats struct {
	Connections int     `json:"connections"`
	Events      int64   `json:"events"`
	Disconnects int64   `json:"disconnects"`
	EventsPerS  float64 `json:"events_per_sec"`
	ConnectP50  float64 `json:"connect_p50_ms"`
	ConnectP95  float64 `json:"connect_p95_ms"`
	ConnectP99  float64 `json:"connect_p99_ms"`
	FirstP95    float64 `json:"first_event_p95_ms"`
	Errors      int64   `json:"connect_errors"`
}

type Report struct {
	Run            RunMeta         `json:"run"`
	GeneratedAt    string          `json:"generated_at"`
	Warm           []Scenario      `json:"warm"`
	Cold           []Scenario      `json:"cold"`
	SSE            *SSEStats       `json:"sse,omitempty"`
	Composite      float64         `json:"composite_score"`
	HasBaseline    bool            `json:"has_baseline"`
	BaselineID     string          `json:"baseline_id,omitempty"`
	BaselineSameFP bool            `json:"baseline_same_fingerprint"`
	Valid          bool            `json:"valid"`
	InvalidReason  string          `json:"invalid_reason,omitempty"`
	Bottleneck     *Bottleneck     `json:"bottleneck,omitempty"`
	Capacity       []CapacityPoint `json:"capacity,omitempty"`
	CapacityMaxRPS float64         `json:"capacity_max_rps"`
	CapacitySLO    float64         `json:"capacity_slo_ms"`
}

type Bottleneck struct {
	PoolMaxConns     float64  `json:"pool_max_conns"`
	PoolPeakAcquired float64  `json:"pool_peak_acquired"`
	PoolEmptyAcquire float64  `json:"pool_empty_acquire"`
	PoolAcquireMS    float64  `json:"pool_acquire_ms"`
	CacheHitRate     float64  `json:"cache_hit_rate"`
	CacheHits        float64  `json:"cache_hits"`
	CacheMisses      float64  `json:"cache_misses"`
	PeakRSSMB        float64  `json:"peak_rss_mb"`
	CPUTotalSec      float64  `json:"cpu_total_sec"`
	GoroutinePeak    float64  `json:"goroutine_peak"`
	HeapPeakMB       float64  `json:"heap_peak_mb"`
	PGHitRate        float64  `json:"pg_hit_rate"`
	TopSQL           []TopSQL `json:"top_sql,omitempty"`
	SeqScans         []SeqRow `json:"seq_scans,omitempty"`
}

type TopSQL struct {
	Calls       int64   `json:"calls"`
	TotalExecMS float64 `json:"total_exec_ms"`
	MeanExecMS  float64 `json:"mean_exec_ms"`
	Query       string  `json:"query"`
}

type SeqRow struct {
	Table   string `json:"table"`
	SeqScan int64  `json:"seq_scan"`
	IdxScan int64  `json:"idx_scan"`
}

type Config struct {
	Scoring struct {
		Clamp            [2]float64         `json:"clamp"`
		ErrorRateInvalid float64            `json:"error_rate_invalid"`
		Weights          map[string]float64 `json:"weights"`
	} `json:"scoring"`
}

func main() {
	results := flag.String("results", "", "本次运行目录")
	configPath := flag.String("scenarios", "config/scenarios.json", "场景/权重配置")
	baselineRoot := flag.String("baseline-root", "baselines", "基线根目录")
	baselinePath := flag.String("baseline", "", "显式基线 JSON（可选）")
	outMD := flag.String("out-md", "", "Markdown 输出（默认 <results>/report.md）")
	outJSON := flag.String("out-json", "", "JSON 输出（默认 <results>/summary.json）")
	outHTML := flag.String("out-html", "", "HTML 输出（默认 <results>/report.html）")
	flag.Parse()

	if *results == "" {
		log.Fatal("缺少 -results")
	}
	if *outMD == "" {
		*outMD = filepath.Join(*results, "report.md")
	}
	if *outJSON == "" {
		*outJSON = filepath.Join(*results, "summary.json")
	}
	if *outHTML == "" {
		*outHTML = filepath.Join(*results, "report.html")
	}

	run := loadRun(*results)
	cfg := loadConfig(*configPath)
	cold, warm := loadScenarios(*results)
	sse := loadSSE(*results)
	capacity := loadCapacity(*results)
	base, baseID, sameFP := loadBaseline(*baselinePath, *baselineRoot, run)

	rep := &Report{Run: run, Cold: cold, Warm: warm, SSE: sse, Capacity: capacity, Valid: true}
	rep.CapacitySLO = 200
	if v, err := strconv.ParseFloat(os.Getenv("CAPACITY_SLO_MS"), 64); err == nil && v > 0 {
		rep.CapacitySLO = v
	}
	rep.GeneratedAt = nowRFC3339()
	rep.HasBaseline = base != nil
	rep.BaselineID = baseID
	rep.BaselineSameFP = sameFP

	if base != nil && sameFP {
		scoreScenarios(warm, base.Warm, cfg)
		rep.Composite = composite(warm, cfg)
	}
	for _, p := range capacity {
		if p.FailRate <= cfg.Scoring.ErrorRateInvalid && p.P95 <= rep.CapacitySLO && p.Rate > rep.CapacityMaxRPS {
			rep.CapacityMaxRPS = p.Rate
		}
	}
	for _, s := range warm {
		if s.FailRate > cfg.Scoring.ErrorRateInvalid {
			rep.Valid = false
			rep.InvalidReason = fmt.Sprintf("场景 %s 错误率 %.2f%% 超过阈值 %.2f%%", s.Name, s.FailRate*100, cfg.Scoring.ErrorRateInvalid*100)
			break
		}
	}
	rep.Bottleneck = aggregate(*results)

	if err := os.WriteFile(*outJSON, mustJSON(rep), 0o644); err != nil {
		log.Fatalf("写 JSON 失败：%v", err)
	}
	if err := os.WriteFile(*outMD, []byte(renderMarkdown(rep)), 0o644); err != nil {
		log.Fatalf("写 Markdown 失败：%v", err)
	}
	if err := os.WriteFile(*outHTML, []byte(renderHTML(rep)), 0o644); err != nil {
		log.Fatalf("写 HTML 失败：%v", err)
	}
	fmt.Printf("[report] 综合分 %.1f（基线：%v）→ %s\n", rep.Composite, rep.HasBaseline, *outMD)
}

func loadRun(dir string) RunMeta {
	var m RunMeta
	b, err := os.ReadFile(filepath.Join(dir, "run.json"))
	if err == nil {
		_ = json.Unmarshal(b, &m)
	}
	return m
}

func loadConfig(path string) Config {
	var c Config
	b, err := os.ReadFile(path)
	if err != nil {
		log.Fatalf("读场景配置失败：%v", err)
	}
	if err := json.Unmarshal(b, &c); err != nil {
		log.Fatalf("解析场景配置失败：%v", err)
	}
	if c.Scoring.Clamp[0] == 0 {
		c.Scoring.Clamp = [2]float64{10, 400}
	}
	if c.Scoring.ErrorRateInvalid == 0 {
		c.Scoring.ErrorRateInvalid = 0.01
	}
	return c
}

func loadScenarios(dir string) (cold, warm []Scenario) {
	files, _ := filepath.Glob(filepath.Join(dir, "scenarios", "*.json"))
	sort.Strings(files)
	for _, f := range files {
		base := strings.TrimSuffix(filepath.Base(f), ".json")
		phase := "warm"
		if strings.HasPrefix(base, "cold-") {
			phase = "cold"
		} else if strings.HasPrefix(base, "warm-") {
			phase = "warm"
		}
		name := strings.TrimPrefix(strings.TrimPrefix(base, "cold-"), "warm-")
		if name == "smoke" || strings.HasPrefix(name, "warmup-") || strings.HasPrefix(name, "capacity-") {
			continue
		}
		s, err := parseK6(f)
		if err != nil {
			log.Printf("[report] 跳过 %s：%v", f, err)
			continue
		}
		s.Name = name
		s.Phase = phase
		if phase == "cold" {
			cold = append(cold, s)
		} else {
			warm = append(warm, s)
		}
	}
	sortByName(cold)
	sortByName(warm)
	return
}

func sortByName(in []Scenario) {
	order := map[string]int{"read-anon": 1, "search": 2, "read-auth": 3, "write": 4, "media": 5, "mixed": 6}
	sort.Slice(in, func(i, j int) bool { return order[in[i].Name] < order[in[j].Name] })
}

func parseK6(path string) (Scenario, error) {
	var s Scenario
	b, err := os.ReadFile(path)
	if err != nil {
		return s, err
	}
	var k K6Summary
	if err := json.Unmarshal(b, &k); err != nil {
		return s, err
	}
	get := func(m, key string) float64 {
		if v, ok := k.Metrics[m]; ok {
			return v.Values[key]
		}
		return 0
	}
	s.RPS = get("http_reqs", "rate")
	s.Count = get("http_reqs", "count")
	s.P50 = firstNonZero(get("http_req_duration", "p(50)"), get("http_req_duration", "med"))
	s.P95 = get("http_req_duration", "p(95)")
	s.P99 = get("http_req_duration", "p(99)")
	s.FailRate = get("http_req_failed", "rate")
	s.Dropped = get("dropped_iterations", "count")
	for _, c := range k.RootGroup.Checks {
		s.ChecksPass += c.Passes
		s.ChecksFail += c.Fails
	}
	return s, nil
}

func firstNonZero(vals ...float64) float64 {
	for _, v := range vals {
		if v != 0 {
			return v
		}
	}
	return 0
}

// loadCapacity 读取容量阶梯结果（capacity-<rate>.json）。
func loadCapacity(dir string) []CapacityPoint {
	files, _ := filepath.Glob(filepath.Join(dir, "scenarios", "capacity-*.json"))
	var out []CapacityPoint
	for _, f := range files {
		base := strings.TrimSuffix(filepath.Base(f), ".json")
		rate, _ := strconv.ParseFloat(strings.TrimPrefix(base, "capacity-"), 64)
		s, err := parseK6(f)
		if err != nil {
			continue
		}
		out = append(out, CapacityPoint{Rate: rate, RPS: s.RPS, P95: s.P95, P99: s.P99, FailRate: s.FailRate, Dropped: s.Dropped})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Rate < out[j].Rate })
	return out
}

func loadSSE(dir string) *SSEStats {
	b, err := os.ReadFile(filepath.Join(dir, "sse.json"))
	if err != nil {
		return nil
	}
	var s SSEStats
	if json.Unmarshal(b, &s) != nil {
		return nil
	}
	return &s
}

// 基线文件格式：{run, warm, sse}
type baselineFile struct {
	Run  RunMeta    `json:"run"`
	Warm []Scenario `json:"warm"`
	SSE  *SSEStats  `json:"sse,omitempty"`
}

func loadBaseline(explicit, root string, run RunMeta) (*baselineFile, string, bool) {
	path := explicit
	if path == "" {
		leaf := run.Scale
		if run.Profile != "" {
			leaf = run.Scale + "-" + run.Profile
		}
		dir := filepath.Join(root, run.FingerprintKey, leaf)
		files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
		if len(files) > 0 {
			sort.Strings(files)
			path = files[len(files)-1]
		}
	}
	if path == "" {
		return nil, "", false
	}
	// 跳过「本次运行自身」的基线，避免自己和自己比出 1000 分
	if strings.Contains(filepath.Base(path), run.RunID) {
		return nil, "", false
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, "", false
	}
	var bf baselineFile
	if json.Unmarshal(b, &bf) != nil {
		return nil, "", false
	}
	// 默认拒绝：指纹/档位/跑法/配置哈希必须逐项完全一致才允许对比。
	same := run.FingerprintKey != "" &&
		bf.Run.FingerprintKey == run.FingerprintKey &&
		bf.Run.Scale == run.Scale &&
		bf.Run.Profile != "" && bf.Run.Profile == run.Profile &&
		run.ConfigHash != "" && bf.Run.ConfigHash == run.ConfigHash
	return &bf, bf.Run.RunID, same
}

func scoreScenarios(cur, base []Scenario, cfg Config) {
	byName := map[string]Scenario{}
	for _, b := range base {
		byName[b.Name] = b
	}
	for i := range cur {
		b, ok := byName[cur[i].Name]
		if !ok || b.P95 <= 0 || cur[i].P95 <= 0 {
			continue
		}
		idx := 100 * b.P95 / cur[i].P95
		idx = math.Max(cfg.Scoring.Clamp[0], math.Min(cfg.Scoring.Clamp[1], idx))
		cur[i].Index = idx
		cur[i].DeltaPct = 100 * (b.P95 - cur[i].P95) / b.P95
	}
}

func composite(warm []Scenario, cfg Config) float64 {
	sum := 0.0
	prod := 1.0
	for _, s := range warm {
		w, ok := cfg.Scoring.Weights[s.Name]
		if !ok || s.Index <= 0 {
			continue
		}
		prod *= math.Pow(s.Index, w)
		sum += w
	}
	if sum == 0 {
		return 0
	}
	// 权重未满 1 时归一化
	return 10 * math.Pow(prod, 1/sum)
}

func mustJSON(v any) []byte {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		log.Fatalf("JSON 编码失败：%v", err)
	}
	return append(b, '\n')
}
