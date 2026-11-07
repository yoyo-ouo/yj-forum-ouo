package handler

import (
	"net/http"
	"net/http/pprof"
	"runtime"
	"time"

	"github.com/gin-gonic/gin"

	"yj-forum/server/internal/database"
)

// debugState 基准调试端点状态。
type debugState struct {
	started time.Time
	db      *database.DB
	caches  *CacheSet
}

// RegisterDebugRoutes 挂载基准调试端点（/debug/metrics、/debug/pprof）。
// 仅在 BENCH_DEBUG=true 且非生产环境时由 router 调用；默认不挂载。
func RegisterDebugRoutes(r *gin.Engine, db *database.DB, cacheSet *CacheSet) {
	st := &debugState{started: time.Now(), db: db, caches: cacheSet}
	r.GET("/debug/metrics", benchLoopbackOnly(), st.metrics)

	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	// 其余 pprof 子页面（heap/goroutine/allocs/block/mutex/threadcreate）由 Index 处理。
	r.Any("/debug/pprof/*any", benchLoopbackOnly(), gin.WrapH(mux))
}

// benchLoopbackOnly 仅允许本机访问调试端点（防止误绑 0.0.0.0 后泄露堆转储）。
func benchLoopbackOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		if ip != "127.0.0.1" && ip != "::1" {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		c.Next()
	}
}

// metrics 返回 Go 运行时 + 数据库连接池 + 进程内缓存的一次性快照。
func (s *debugState) metrics(c *gin.Context) {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)

	lastPause := uint64(0)
	if ms.NumGC > 0 {
		lastPause = ms.PauseNs[(ms.NumGC+255)%256]
	}

	rt := gin.H{
		"go_version":        runtime.Version(),
		"goroutines":        runtime.NumGoroutine(),
		"gomaxprocs":        runtime.GOMAXPROCS(0),
		"num_cpu":           runtime.NumCPU(),
		"heap_alloc":        ms.HeapAlloc,
		"heap_inuse":        ms.HeapInuse,
		"heap_objects":      ms.HeapObjects,
		"stack_inuse":       ms.StackInuse,
		"sys":               ms.Sys,
		"gc_count":          ms.NumGC,
		"gc_pause_total_ns": ms.PauseTotalNs,
		"gc_last_pause_ns":  lastPause,
	}

	pool := gin.H{}
	if s.db != nil && s.db.Pool != nil {
		st := s.db.Pool.Stat()
		pool = gin.H{
			"max_conns":              st.MaxConns(),
			"total_conns":            st.TotalConns(),
			"idle_conns":             st.IdleConns(),
			"acquired_conns":         st.AcquiredConns(),
			"constructing_conns":     st.ConstructingConns(),
			"acquire_count":          st.AcquireCount(),
			"acquire_duration_ms":    st.AcquireDuration().Milliseconds(),
			"empty_acquire_count":    st.EmptyAcquireCount(),
			"canceled_acquire_count": st.CanceledAcquireCount(),
			"new_conns_count":        st.NewConnsCount(),
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"ts":             time.Now().UTC().Format(time.RFC3339Nano),
		"uptime_seconds": time.Since(s.started).Seconds(),
		"runtime":        rt,
		"db_pool":        pool,
		"caches":         s.caches.Stats(),
	})
}
