package mygo

import (
	"bytes"
	"crypto/aes"
	"encoding/hex"
	"encoding/json/v2"
	"strings"
	"testing"
)

func TestHostAESECBUsesMyGoKeyFirstContract(t *testing.T) {
	service := installedService(t, `export function search(p) { return host.crypto.aesEcbEncrypt(p.key, p.text); }`)
	for _, sample := range []struct {
		name string
		key  string
		text string
	}{
		{"empty", "0123456789abcdef", ""},
		{"short", "0123456789abcdef", "hello"},
		{"aligned", "0123456789abcdef", "0123456789abcdef"},
		{"netease-login", "e82ckenh8dichen8", strings.Repeat("x", 428)},
		{"unicode", "0123456789abcdef", "网易云音乐扫码登录"},
		{"aes192", strings.Repeat("k", 24), "hello"},
		{"aes256", strings.Repeat("k", 32), "hello"},
	} {
		t.Run(sample.name, func(t *testing.T) {
			params, err := json.Marshal(map[string]string{"key": sample.key, "text": sample.text})
			if err != nil {
				t.Fatal(err)
			}
			result, err := service.Call(t.Context(), 1, "demo", "search", params)
			if err != nil {
				t.Fatal(err)
			}
			var actual string
			if err := json.Unmarshal(result, &actual); err != nil {
				t.Fatal(err)
			}
			block, err := aes.NewCipher([]byte(sample.key))
			if err != nil {
				t.Fatal(err)
			}
			plaintext := []byte(sample.text)
			padding := aes.BlockSize - len(plaintext)%aes.BlockSize
			plaintext = append(plaintext, bytes.Repeat([]byte{byte(padding)}, padding)...)
			expected := make([]byte, len(plaintext))
			for offset := 0; offset < len(plaintext); offset += aes.BlockSize {
				block.Encrypt(expected[offset:], plaintext[offset:])
			}
			if actual != hex.EncodeToString(expected) {
				t.Fatalf("ciphertext mismatch: got %q, want %x", actual, expected)
			}
		})
	}
}

func TestHostAESECBRejectsInvalidKeyEvenWithValidLengthPlaintext(t *testing.T) {
	service := installedService(t, `export function search() { return host.crypto.aesEcbEncrypt("invalid", "0123456789abcdef"); }`)
	if _, err := service.Call(t.Context(), 1, "demo", "search", nil); err == nil {
		t.Fatal("invalid encryption key was accepted")
	}
}
