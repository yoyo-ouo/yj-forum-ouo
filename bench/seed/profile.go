package main

import (
	"fmt"
	"math"
	"math/rand"
	"strings"
	"time"
)

// Scale 数据集规模档位。
type Scale struct {
	Name          string
	Users         int
	Guilds        int
	Posts         int
	Comments      int
	World         int
	Chat          int
	Notifications int
	Sessions      int
}

var scales = map[string]Scale{
	"small":  {Name: "small", Users: 100, Guilds: 10, Posts: 1000, Comments: 10000, World: 5000, Chat: 5000, Notifications: 5000, Sessions: 50},
	"medium": {Name: "medium", Users: 1000, Guilds: 50, Posts: 20000, Comments: 200000, World: 50000, Chat: 50000, Notifications: 50000, Sessions: 300},
	"large":  {Name: "large", Users: 10000, Guilds: 200, Posts: 200000, Comments: 2000000, World: 200000, Chat: 200000, Notifications: 200000, Sessions: 1000},
}

var categories = []string{"general", "talk", "creative", "share", "help"}

var themeColors = []string{"#6A8C89", "#8C6A7A", "#6A7F8C", "#8C7A6A", "#7A6A8C"}

var wordPool = []string{
	"星海", "灵质空间", "会馆", "罗小黑", "妖精", "人类", "旅途", "契约",
	"风息", "无限", "小黑", "小白", "比丢", "山新", "龙游", "若水",
}

// nameOf 生成用户名。
func nameOf(i int) string { return fmt.Sprintf("基准用户%05d", i) }

// slugOf 生成会馆 slug。
func slugOf(i int) string { return fmt.Sprintf("bench-guild-%03d", i) }

// userID / postID / commentID 等固定前缀，便于识别与清理。
func userID(i int) string       { return fmt.Sprintf("BU%06d", i) }
func postID(i int) string       { return fmt.Sprintf("BP%08d", i) }
func commentID(p, c int) string { return fmt.Sprintf("BC%06d_%05d", p, c) }
func articleID(g, a int) string { return fmt.Sprintf("BA%04d_%03d", g, a) }
func guideID(i int) string      { return fmt.Sprintf("BG%04d", i) }
func sessionToken(i int) string { return fmt.Sprintf("bench-token-%06d", i) }

// sentence 生成一句中文文本。
func sentence(rng *rand.Rand, n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		b.WriteString(wordPool[rng.Intn(len(wordPool))])
		b.WriteString("·")
	}
	return b.String()
}

// htmlContent 生成指定长度的 HTML 正文（近似，单位为字符）。
func htmlContent(rng *rand.Rand, approxBytes int, withImage bool) string {
	var b strings.Builder
	b.Grow(approxBytes + 128)
	for b.Len() < approxBytes {
		if rng.Intn(6) == 0 {
			b.WriteString("<h2>")
			b.WriteString(sentence(rng, 3))
			b.WriteString("</h2>")
		}
		b.WriteString("<p>")
		b.WriteString(sentence(rng, 12+rng.Intn(20)))
		if rng.Intn(4) == 0 {
			b.WriteString("<strong>")
			b.WriteString(sentence(rng, 2))
			b.WriteString("</strong>")
		}
		b.WriteString("</p>")
	}
	if withImage {
		b.WriteString(`<p><img src="/ov2/api/media/bench-placeholder" width="640"></p>`)
	}
	return b.String()
}

// plainText 生成纯文本句子。
func plainText(rng *rand.Rand, n int) string { return sentence(rng, n) }

// newRNG 固定种子，保证同档位数据集可复现。
func newRNG(seed int64) *rand.Rand { return rand.New(rand.NewSource(seed)) }

// spreadTime 在 [start, end] 内均匀取时间。
func spreadTime(rng *rand.Rand, start, end time.Time) time.Time {
	if !end.After(start) {
		return start
	}
	return start.Add(time.Duration(rng.Int63n(int64(end.Sub(start)))))
}

// powerLawCounts 生成总和为 total 的幂律分布计数（少数热点极高）。
func powerLawCounts(rng *rand.Rand, n, total int, alpha float64) []int {
	if n <= 0 || total <= 0 {
		return make([]int, n)
	}
	weights := make([]float64, n)
	var sum float64
	for i := 0; i < n; i++ {
		w := 1.0 / math.Pow(float64(i+1), alpha)
		weights[i] = w
		sum += w
	}
	counts := make([]int, n)
	allocated := 0
	for i := 0; i < n; i++ {
		c := int(float64(total) * weights[i] / sum)
		counts[i] = c
		allocated += c
	}
	// 余量分配给前几名，保持总和精确
	for i := 0; allocated < total; i = (i + 1) % n {
		counts[i]++
		allocated++
	}
	// 打散位置，避免热点集中在开头
	rng.Shuffle(n, func(i, j int) { counts[i], counts[j] = counts[j], counts[i] })
	return counts
}

func mathPow(x, y float64) float64 {
	return math.Pow(x, y)
}
