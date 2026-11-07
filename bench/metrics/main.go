// Command metrics 采集基准运行期间的服务端指标（Go 运行时 / PG / 进程）。
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Line struct {
	Kind     string          `json:"kind"`
	T        string          `json:"t"`
	Scenario string          `json:"scenario,omitempty"`
	Phase    string          `json:"phase,omitempty"`
	API      json.RawMessage `json:"api,omitempty"`
	Proc     *ProcStats      `json:"proc,omitempty"`
	PG       *PGStats        `json:"pg,omitempty"`
}

type ProcStats struct {
	CPUUserSec float64 `json:"cpu_user_sec"`
	CPUSysSec  float64 `json:"cpu_sys_sec"`
	RSSKB      int64   `json:"rss_kb"`
	Threads    int     `json:"threads"`
}

type PGStats struct {
	Connections map[string]int `json:"connections"`
	BlksHit     int64          `json:"blks_hit"`
	BlksRead    int64          `json:"blks_read"`
	XactCommit  int64          `json:"xact_commit"`
	TupReturned int64          `json:"tup_returned"`
	TupFetched  int64          `json:"tup_fetched"`
	TopSQL      []TopSQL       `json:"top_sql,omitempty"`
	SeqScans    []SeqScan      `json:"seq_scans,omitempty"`
}

type TopSQL struct {
	Calls       int64   `json:"calls"`
	TotalExecMS float64 `json:"total_exec_ms"`
	MeanExecMS  float64 `json:"mean_exec_ms"`
	Rows        int64   `json:"rows"`
	Query       string  `json:"query"`
}

type SeqScan struct {
	Table   string `json:"table"`
	SeqScan int64  `json:"seq_scan"`
	IdxScan int64  `json:"idx_scan"`
}

func main() {
	api := flag.String("api", "http://127.0.0.1:8091", "bench server 基础地址")
	pid := flag.Int("pid", 0, "bench server 进程 PID（0 = 自动读 pid 文件）")
	pidFile := flag.String("pid-file", "", "bench server PID 文件")
	dsn := flag.String("dsn", os.Getenv("DATABASE_URL"), "基准库连接串")
	out := flag.String("out", "metrics.jsonl", "输出 JSONL")
	interval := flag.Duration("interval", time.Second, "采样间隔")
	duration := flag.Duration("duration", 0, "总时长（0 = 持续到 SIGTERM）")
	markFile := flag.String("mark-file", "", "场景标记文件（内容格式 phase:scenario）")
	pgEvery := flag.Duration("pg-every", 5*time.Second, "PG 快照间隔")
	flag.Parse()

	serverPID := *pid
	if serverPID == 0 && *pidFile != "" {
		if b, err := os.ReadFile(*pidFile); err == nil {
			serverPID, _ = strconv.Atoi(strings.TrimSpace(string(b)))
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if *duration > 0 {
		ctx, cancel = context.WithTimeout(context.Background(), *duration)
		defer cancel()
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sig
		cancel()
	}()

	f, err := os.Create(*out)
	if err != nil {
		log.Fatalf("创建 %s 失败：%v", *out, err)
	}
	defer f.Close()
	enc := json.NewEncoder(f)

	var pool *pgxpool.Pool
	if *dsn != "" {
		pool, err = pgxpool.New(ctx, *dsn)
		if err != nil {
			log.Printf("[metrics] PG 连接失败（仅采 Go/进程指标）：%v", err)
			pool = nil
		}
	}
	defer func() {
		if pool != nil {
			pool.Close()
		}
	}()

	client := &http.Client{Timeout: 3 * time.Second}
	ticker := time.NewTicker(*interval)
	defer ticker.Stop()
	lastMark := ""
	lastPG := time.Time{}

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		now := time.Now().UTC()

		if *markFile != "" {
			if b, err := os.ReadFile(*markFile); err == nil {
				m := strings.TrimSpace(string(b))
				if m != lastMark && m != "" {
					lastMark = m
					phase, scenario := "", m
					if i := strings.Index(m, ":"); i > 0 {
						phase, scenario = m[:i], m[i+1:]
					}
					_ = enc.Encode(Line{Kind: "mark", T: now.Format(time.RFC3339Nano), Phase: phase, Scenario: scenario})
				}
			}
		}

		line := Line{Kind: "sample", T: now.Format(time.RFC3339Nano)}
		if body, err := httpGet(client, *api+"/debug/metrics"); err == nil {
			line.API = body
		}
		if *pidFile != "" {
			if b, err := os.ReadFile(*pidFile); err == nil {
				if v, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil && v > 0 {
					serverPID = v
				}
			}
		}
		if serverPID > 0 {
			line.Proc = readProc(serverPID)
		}
		if pool != nil && now.Sub(lastPG) >= *pgEvery {
			lastPG = now
			line.PG = readPG(ctx, pool)
		}
		_ = enc.Encode(line)
	}
}

func httpGet(c *http.Client, url string) (json.RawMessage, error) {
	resp, err := c.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)
	for {
		n, err := resp.Body.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
		}
		if err != nil {
			break
		}
	}
	var raw json.RawMessage = buf
	return raw, nil
}

func readProc(pid int) *ProcStats {
	st := &ProcStats{}
	if b, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid)); err == nil {
		fields := strings.Fields(string(b))
		if len(fields) > 14 {
			utime, _ := strconv.ParseFloat(fields[13], 64)
			stime, _ := strconv.ParseFloat(fields[14], 64)
			st.CPUUserSec = utime / 100.0
			st.CPUSysSec = stime / 100.0
		}
	}
	if b, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid)); err == nil {
		for _, ln := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(ln, "VmRSS:") {
				f := strings.Fields(ln)
				if len(f) >= 2 {
					st.RSSKB, _ = strconv.ParseInt(f[1], 10, 64)
				}
			}
			if strings.HasPrefix(ln, "Threads:") {
				f := strings.Fields(ln)
				if len(f) >= 2 {
					st.Threads, _ = strconv.Atoi(f[1])
				}
			}
		}
	}
	return st
}

func readPG(ctx context.Context, pool *pgxpool.Pool) *PGStats {
	pg := &PGStats{Connections: map[string]int{}}
	if rows, err := pool.Query(ctx, `SELECT COALESCE(state,'unknown'), count(*) FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1`); err == nil {
		for rows.Next() {
			var s string
			var n int
			if rows.Scan(&s, &n) == nil {
				pg.Connections[s] = n
			}
		}
		rows.Close()
	}
	_ = pool.QueryRow(ctx, `SELECT blks_hit, blks_read, xact_commit, tup_returned, tup_fetched FROM pg_stat_database WHERE datname = current_database()`).
		Scan(&pg.BlksHit, &pg.BlksRead, &pg.XactCommit, &pg.TupReturned, &pg.TupFetched)

	if rows, err := pool.Query(ctx, `SELECT calls, total_exec_time, mean_exec_time, rows, left(query, 300)
		FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%'
		ORDER BY total_exec_time DESC LIMIT 10`); err == nil {
		for rows.Next() {
			var t TopSQL
			if rows.Scan(&t.Calls, &t.TotalExecMS, &t.MeanExecMS, &t.Rows, &t.Query) == nil {
				pg.TopSQL = append(pg.TopSQL, t)
			}
		}
		rows.Close()
	}
	if rows, err := pool.Query(ctx, `SELECT relname, seq_scan, COALESCE(idx_scan,0) FROM pg_stat_user_tables
		WHERE schemaname='public' ORDER BY seq_scan DESC LIMIT 10`); err == nil {
		for rows.Next() {
			var s SeqScan
			if rows.Scan(&s.Table, &s.SeqScan, &s.IdxScan) == nil {
				pg.SeqScans = append(pg.SeqScans, s)
			}
		}
		rows.Close()
	}
	return pg
}
