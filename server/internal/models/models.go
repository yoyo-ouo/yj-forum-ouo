// Package models 定义 API 数据结构。
package models

import "time"

// User 用户（对外，不含密码）。
type User struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Avatar        string     `json:"avatar"`
	Email         string     `json:"email,omitempty"`
	Gender        int        `json:"gender"`
	Age           string     `json:"age"`
	Intro         string     `json:"intro"`
	VIP           string     `json:"vip"`
	Prefix        string     `json:"prefix"`
	IsBanned      int        `json:"is_banned"`
	EmailVerified int        `json:"email_verified"`
	CreatedAt     *time.Time `json:"created_at"`
	LastLogin     *time.Time `json:"last_login"`
}

// UserBrief 列表/关联场景的用户摘要。
type UserBrief struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Avatar      string `json:"avatar"`
	VIP         string `json:"vip"`
	Prefix      string `json:"prefix"`
	Intro       string `json:"intro"`
	IsSelf      bool   `json:"is_self"`
	IsFollowing bool   `json:"is_following"`
}

// Post 帖子。
type Post struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id"`
	Title     string     `json:"title"`
	Content   string     `json:"content"`
	Summary   string     `json:"summary,omitempty"`
	Category  string     `json:"category"`
	Likes     int        `json:"likes"`
	Views     int        `json:"views"`
	Status    int        `json:"status"`
	CreatedAt *time.Time `json:"created_at"`
	UpdatedAt *time.Time `json:"updated_at"`
	UserName  string     `json:"user_name"`
	UserAvatar string    `json:"user_avatar"`
}

// Comment 评论。
type Comment struct {
	ID        string     `json:"id"`
	PostID    string     `json:"post_id"`
	UserID    string     `json:"user_id"`
	Content   string     `json:"content"`
	ParentID  *string    `json:"parent_id"`
	Likes     int        `json:"likes"`
	Status    int        `json:"status"`
	CreatedAt *time.Time `json:"created_at"`
	UserName  string     `json:"user_name"`
	UserAvatar string    `json:"user_avatar"`
}

// WorldMessage 世界频道消息。
type WorldMessage struct {
	ID           int64      `json:"id"`
	SenderID     string     `json:"sender_id"`
	SenderName   string     `json:"sender_name"`
	SenderAvatar string     `json:"sender_avatar"`
	Content      string     `json:"content"`
	ParentID     *int64     `json:"parent_id"`
	CreatedAt    *time.Time `json:"created_at"`
}

// PostListItem 列表用帖子（含 summary）。
type PostListItem struct {
	ID           string     `json:"id"`
	UserID       string     `json:"user_id"`
	Title        string     `json:"title"`
	Summary      string     `json:"summary"`
	Category     string     `json:"category"`
	Likes        int        `json:"likes"`
	Views        int        `json:"views"`
	CommentCount int        `json:"comment_count"`
	CreatedAt    *time.Time `json:"created_at"`
	UserName     string     `json:"user_name"`
	UserAvatar   string     `json:"user_avatar"`
}

// ReplyItem 我收到的回复。
type ReplyItem struct {
	Comment
	PostID    string `json:"post_id"`
	PostTitle string `json:"post_title"`
}

// Stats 用户统计。
type Stats struct {
	PostCount   int `json:"post_count"`
	TotalLikes  int `json:"total_likes"`
	TotalViews  int `json:"total_views"`
}

// FollowStats 关注统计。
type FollowStats struct {
	FollowingCount int `json:"following_count"`
	FollowerCount  int `json:"follower_count"`
}

// UserProfile 用户主页。
type UserProfile struct {
	User        User         `json:"user"`
	Stats       Stats        `json:"stats"`
	FollowStats FollowStats  `json:"follow_stats"`
	IsFollowing bool         `json:"is_following"`
	IsSelf      bool         `json:"is_self"`
}

// VersionVoteStats 投票统计。
type VersionVoteStats struct {
	V1 int `json:"v1"`
	V2 int `json:"v2"`
}
