package database

import "errors"

var errSelfFollow = errors.New("不能关注自己")

var errCommentUnavailable = errors.New("评论不存在")
