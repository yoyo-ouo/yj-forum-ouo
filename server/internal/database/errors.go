package database

import "errors"

var errSelfFollow = errors.New("不能关注自己")
