// Command sse 对 SSE 端点做连接与事件延迟压测。
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

type Result struct {
	URL           string  `json:"url"`
	Connections   int     `json:"connections"`
	DurationSec   float64 `json:"duration_seconds"`
	Events        int64   `json:"events"`
	Disconnects   int64   `json:"disconnects"`
	EventsPerSec  float64 `json:"events_per_sec"`
	ConnectP50MS  float64 `json:"connect_p50_ms"`
	ConnectP95MS  float64 `json:"connect_p95_ms"`
	ConnectP99MS  float64 `json:"connect_p99_ms"`
	FirstEventP50 float64 `json:"first_event_p50_ms"`
	FirstEventP95 float64 `json:"first_event_p95_ms"`
	FirstEventP99 float64 `json:"first_event_p99_ms"`
	Errors        int64   `json:"connect_errors"`
}

func main() {
	url := flag.String("url", "http://127.0.0.1:8091/ov2/api/world/stream", "SSE 地址")
	conns := flag.Int("connections", 200, "并发连接数")
	dur := flag.Duration("duration", 30*time.Second, "持续时长")
	token := flag.String("token", "", "forum_session 令牌（私信流需要）")
	out := flag.String("out", "sse.json", "输出 JSON 路径")
	flag.Parse()

	ctx, cancel := context.WithTimeout(context.Background(), *dur)
	defer cancel()

	var (
		mu          sync.Mutex
		connectDur  []time.Duration
		firstDur    []time.Duration
		events      int64
		disconnects int64
		errors      int64
	)

	transport := &http.Transport{
		MaxIdleConns:        *conns,
		MaxIdleConnsPerHost: *conns,
		DisableCompression:  true,
	}
	client := &http.Client{Transport: transport}

	start := time.Now()
	var wg sync.WaitGroup
	for i := 0; i < *conns; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ctx.Err() == nil {
				req, err := http.NewRequestWithContext(ctx, http.MethodGet, *url, nil)
				if err != nil {
					return
				}
				req.Header.Set("Accept", "text/event-stream")
				req.Header.Set("User-Agent", "bench-sse/1.0")
				if *token != "" {
					req.Header.Set("Cookie", "forum_session="+*token)
				}
				t0 := time.Now()
				resp, err := client.Do(req)
				if err != nil {
					mu.Lock()
					errors++
					mu.Unlock()
					break
				}
				if resp.StatusCode != http.StatusOK {
					resp.Body.Close()
					mu.Lock()
					disconnects++
					mu.Unlock()
					time.Sleep(100 * time.Millisecond)
					continue
				}
				mu.Lock()
				connectDur = append(connectDur, time.Since(t0))
				mu.Unlock()

				sc := bufio.NewScanner(resp.Body)
				sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
				gotFirst := false
				for sc.Scan() {
					if strings.HasPrefix(sc.Text(), "data:") {
						mu.Lock()
						events++
						mu.Unlock()
						if !gotFirst {
							gotFirst = true
							mu.Lock()
							firstDur = append(firstDur, time.Since(t0))
							mu.Unlock()
						}
					}
				}
				resp.Body.Close()
				if ctx.Err() == nil {
					mu.Lock()
					disconnects++
					mu.Unlock()
					time.Sleep(50 * time.Millisecond)
				}
			}
		}()
	}
	wg.Wait()

	elapsed := time.Since(start).Seconds()
	r := Result{
		URL: *url, Connections: *conns, DurationSec: elapsed,
		Events: events, Disconnects: disconnects, Errors: errors,
		ConnectP50MS:  percentile(connectDur, 50),
		ConnectP95MS:  percentile(connectDur, 95),
		ConnectP99MS:  percentile(connectDur, 99),
		FirstEventP50: percentile(firstDur, 50),
		FirstEventP95: percentile(firstDur, 95),
		FirstEventP99: percentile(firstDur, 99),
	}
	if elapsed > 0 {
		r.EventsPerSec = float64(events) / elapsed
	}
	b, _ := json.MarshalIndent(r, "", "  ")
	if err := os.WriteFile(*out, append(b, '\n'), 0o644); err != nil {
		log.Fatalf("写入 %s 失败：%v", *out, err)
	}
	fmt.Printf("[sse] conns=%d events=%d disconnects=%d connect_p95=%.1fms events/s=%.1f\n",
		r.Connections, r.Events, r.Disconnects, r.ConnectP95MS, r.EventsPerSec)
}

func percentile(in []time.Duration, p float64) float64 {
	if len(in) == 0 {
		return 0
	}
	vals := make([]float64, len(in))
	for i, d := range in {
		vals[i] = float64(d.Microseconds()) / 1000.0
	}
	sort.Float64s(vals)
	idx := int(float64(len(vals)-1) * p / 100.0)
	return vals[idx]
}
