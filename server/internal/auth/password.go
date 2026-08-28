package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/scrypt"
)

// HashPassword 生成 bcrypt 哈希（新用户）。
func HashPassword(pwd string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pwd), bcrypt.DefaultCost)
	return string(b), err
}

// CheckPassword 校验密码（兼容 bcrypt 与 werkzeug scrypt/pbkdf2 格式）。
func CheckPassword(hash, pwd string) bool {
	if hash == "" {
		return false
	}
	// bcrypt
	if strings.HasPrefix(hash, "$2a$") || strings.HasPrefix(hash, "$2b$") || strings.HasPrefix(hash, "$2y$") {
		return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pwd)) == nil
	}
	// werkzeug scrypt: scrypt:N:r:p$salt$hash
	if strings.HasPrefix(hash, "scrypt:") {
		parts := strings.SplitN(hash, "$", 3)
		if len(parts) != 3 {
			return false
		}
		params := strings.SplitN(parts[0], ":", 4)
		if len(params) != 4 {
			return false
		}
		n, r, p := 32768, 8, 1
		_, _ = fmtSscan(params[1], &n)
		_, _ = fmtSscan(params[2], &r)
		_, _ = fmtSscan(params[3], &p)
		salt := []byte(parts[1])
		expected, err := hex.DecodeString(parts[2])
		if err != nil {
			return false
		}
		actual, err := scrypt.Key([]byte(pwd), salt, n, r, p, len(expected))
		if err != nil {
			return false
		}
		return hmac.Equal(actual, expected)
	}
	// werkzeug pbkdf2: pbkdf2:sha256:iterations$salt$hash
	if strings.HasPrefix(hash, "pbkdf2:") {
		parts := strings.SplitN(hash, "$", 3)
		if len(parts) != 3 {
			return false
		}
		params := strings.SplitN(parts[0], ":", 3)
		if len(params) != 3 {
			return false
		}
		iterations := 600000
		_, _ = fmtSscan(params[2], &iterations)
		expected, err := base64.StdEncoding.DecodeString(parts[2])
		if err != nil {
			return false
		}
		actual := pbkdf2SHA256([]byte(pwd), []byte(parts[1]), iterations, len(expected))
		return hmac.Equal(actual, expected)
	}
	return false
}

func fmtSscan(s string, v *int) (int, error) {
	n := 0
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			break
		}
		n = n*10 + int(ch-'0')
	}
	*v = n
	return 0, nil
}

// pbkdf2SHA256 简化实现（Werkzeug pbkdf2:sha256）。
func pbkdf2SHA256(password, salt []byte, iter, keyLen int) []byte {
	hashLen := sha256.Size
	numBlocks := (keyLen + hashLen - 1) / hashLen
	var dk []byte
	block := make([]byte, 0, len(salt)+4)
	for blockIndex := 1; blockIndex <= numBlocks; blockIndex++ {
		block = append(block[:0], salt...)
		block = append(block, byte(blockIndex>>24), byte(blockIndex>>16), byte(blockIndex>>8), byte(blockIndex))
		u := sha256.Sum256(append(password, block...))
		t := make([]byte, hashLen)
		copy(t, u[:])
		for i := 1; i < iter; i++ {
			u = sha256.Sum256(u[:])
			for j := 0; j < hashLen; j++ {
				t[j] ^= u[j]
			}
		}
		dk = append(dk, t...)
	}
	return dk[:keyLen]
}
