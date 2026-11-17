package main

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

type metricLine struct {
	Kind  string `json:"kind"`
	Phase string `json:"phase"`
	API   struct {
		Runtime struct {
			Goroutines int     `json:"goroutines"`
			HeapAlloc  float64 `json:"heap_alloc"`
			GCCount    float64 `json:"gc_count"`
		} `json:"runtime"`
		DBPool struct {
			MaxConns          float64 `json:"max_conns"`
			AcquiredConns     float64 `json:"acquired_conns"`
			EmptyAcquireCount float64 `json:"empty_acquire_count"`
			AcquireDurationMS float64 `json:"acquire_duration_ms"`
		} `json:"db_pool"`
		Caches map[string]struct {
			Hits   float64 `json:"hits"`
			Misses float64 `json:"misses"`
		} `json:"caches"`
	} `json:"api"`
	Proc *struct {
		CPUUserSec float64 `json:"cpu_user_sec"`
		CPUSysSec  float64 `json:"cpu_sys_sec"`
		RSSKB      float64 `json:"rss_kb"`
	} `json:"proc"`
	PG *struct {
		BlksHit  float64  `json:"blks_hit"`
		BlksRead float64  `json:"blks_read"`
		TopSQL   []TopSQL `json:"top_sql"`
		SeqScans []SeqRow `json:"seq_scans"`
	} `json:"pg"`
}

func nowRFC3339() string { return time.Now().UTC().Format(time.RFC3339) }

func aggregate(dir string) *Bottleneck {
	f, err := os.Open(filepath.Join(dir, "metrics.jsonl"))
	if err != nil {
		return nil
	}
	defer f.Close()

	b := &Bottleneck{}
	phase := ""
	sawMark := false
	var firstCPU, lastCPU float64
	var sawCPU bool

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1024*1024), 32*1024*1024)
	for sc.Scan() {
		var ln metricLine
		if json.Unmarshal(sc.Bytes(), &ln) != nil {
			continue
		}
		if ln.Kind == "mark" {
			phase = ln.Phase
			sawMark = true
			continue
		}
		if ln.Kind != "sample" {
			continue
		}
		if sawMark && phase != "warm" {
			continue
		}

		if ln.API.DBPool.MaxConns > b.PoolMaxConns {
			b.PoolMaxConns = ln.API.DBPool.MaxConns
		}
		if ln.API.DBPool.AcquiredConns > b.PoolPeakAcquired {
			b.PoolPeakAcquired = ln.API.DBPool.AcquiredConns
		}
		if ln.API.DBPool.EmptyAcquireCount > b.PoolEmptyAcquire {
			b.PoolEmptyAcquire = ln.API.DBPool.EmptyAcquireCount
		}
		if ln.API.DBPool.AcquireDurationMS > b.PoolAcquireMS {
			b.PoolAcquireMS = ln.API.DBPool.AcquireDurationMS
		}
		if float64(ln.API.Runtime.Goroutines) > b.GoroutinePeak {
			b.GoroutinePeak = float64(ln.API.Runtime.Goroutines)
		}
		if mb := ln.API.Runtime.HeapAlloc / (1024 * 1024); mb > b.HeapPeakMB {
			b.HeapPeakMB = mb
		}
		var hits, misses float64
		for _, c := range ln.API.Caches {
			hits += c.Hits
			misses += c.Misses
		}
		if hits+misses > 0 {
			b.CacheHits, b.CacheMisses = hits, misses
			b.CacheHitRate = 100 * hits / (hits + misses)
		}
		if ln.Proc != nil {
			cpu := ln.Proc.CPUUserSec + ln.Proc.CPUSysSec
			if !sawCPU {
				firstCPU, sawCPU = cpu, true
			}
			lastCPU = cpu
			if mb := ln.Proc.RSSKB / 1024; mb > b.PeakRSSMB {
				b.PeakRSSMB = mb
			}
		}
		if ln.PG != nil {
			if ln.PG.BlksHit+ln.PG.BlksRead > 0 {
				b.PGHitRate = 100 * ln.PG.BlksHit / (ln.PG.BlksHit + ln.PG.BlksRead)
			}
			if len(ln.PG.TopSQL) > 0 {
				b.TopSQL = ln.PG.TopSQL
			}
			if len(ln.PG.SeqScans) > 0 {
				b.SeqScans = ln.PG.SeqScans
			}
		}
	}
	if sawCPU {
		b.CPUTotalSec = lastCPU - firstCPU
	}
	return b
}
