package share

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReviewFlow(t *testing.T) {
	h, _, err := NewServer(ServerOptions{Data: t.TempDir(), Tokens: "owner:tok", Passcode: "pass"})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h)
	defer srv.Close()
	do := func(method, path, auth string, body any) (int, map[string]any) {
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(method, srv.URL+path, bytes.NewReader(b))
		if auth == "owner" {
			req.Header.Set("Authorization", "Bearer tok")
		} else if auth == "team" {
			req.Header.Set("X-Crux-Passcode", "pass")
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}
	code, it := do("POST", "/api/items", "owner", map[string]any{"repo": "r", "adr": map[string]string{"id": "0001", "title": "T"}, "mode": "review", "snapshot": map[string]any{"source": "x", "options": []map[string]string{{"key": "A", "name": "a"}}}})
	if code != 200 {
		t.Fatalf("publish: %d %v", code, it)
	}
	slug := it["slug"].(string)
	if c, _ := do("GET", "/api/items/"+slug, "", nil); c != 403 {
		t.Fatalf("no passcode should be 403, got %d", c)
	}
	if c, out := do("POST", "/api/items/"+slug+"/entries", "team", map[string]any{"kind": "pro", "by": "sara", "opt": "A", "text": "fast"}); c != 400 || out["error"] != "a reason is required" {
		t.Fatalf("pro without reason: %d %v", c, out)
	}
	if c, _ := do("POST", "/api/items/"+slug+"/entries", "team", map[string]any{"kind": "pick", "by": "sara", "opt": "A", "conf": 80}); c != 200 {
		t.Fatalf("pick: %d", c)
	}
	if c, _ := do("POST", "/api/items/"+slug+"/entries", "team", map[string]any{"kind": "note", "by": "sara", "text": "x"}); c != 409 {
		t.Fatalf("note in review mode should be 409, got %d", c)
	}
	_, got := do("GET", "/api/items/"+slug, "team", nil)
	if n := len(got["entries"].([]any)); n != 1 {
		t.Fatalf("entries: %d", n)
	}
}
