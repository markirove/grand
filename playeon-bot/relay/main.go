// Command relay is a small egress helper for playeon.
//
// Two jobs, both of which exist only because some upstreams answer differently
// depending on where the request comes from:
//
// - GET /saavn/search - JioSaavn search endpoint is geo-filtered. Asked
//   from outside India it silently omits most international catalogue, so a
//   search for a well-known single comes back with covers and sped-up edits
//   and no sign of the record. Every other JioSaavn call, including the CDN
//   the audio actually comes from, works fine from anywhere - so this one
//   call is all that needs relaying.
//
// - CONNECT - googlevideo stream URLs are minted against the requesting IP
//   and carry a `gcr` country lock. Minted from the wrong country they play
//   for nobody else. Tunnelling yt-dlp through here mints them where the
//   listeners are.
//
// The CONNECT half is a real proxy, so it is allowlisted to the handful of
// hosts that are actually needed. A leaked credential gets someone song
// searches and YouTube; it does not get them an open relay to the internet.
//
// Nothing is persisted and no credentials are held: yt-dlp keeps its own
// cookies and speaks TLS end-to-end through the tunnel, so this process never
// sees them.
package main

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	upstreamSearch = "https://www.jiosaavn.com/api.php"
	userAgent      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
		"(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
	upstreamTimeout = 15 * time.Second
	tunnelIdle      = 5 * time.Minute
	cacheTTL        = 10 * time.Minute
	cacheMax        = 500
)

// Hosts the CONNECT tunnel will open. Suffix match against the request host,
// so `rr3---sn-x.googlevideo.com` matches `.googlevideo.com`.
var allowed = []string{
	".googlevideo.com",
	".youtube.com",
	"youtube.com",
	".ytimg.com",
	".jiosaavn.com",
	"jiosaavn.com",
	".saavncdn.com",
}

var secret string

type entry struct {
	body []byte
	at   time.Time
}

// Search results are cached because a room replays the same tracks: the same
// query inside the TTL costs nothing and skips a ~200ms round trip to Mumbai,
// which is worth far more than any amount of tuning on this side of it.
type cache struct {
	mu sync.Mutex
	m  map[string]entry
}

func (c *cache) get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[key]
	if !ok || time.Since(e.at) > cacheTTL {
		return nil, false
	}
	return e.body, true
}

func (c *cache) put(key string, body []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.m) >= cacheMax {
		// cheapest possible eviction: drop whatever the map hands back first.
		// The TTL is the real bound; this only stops unbounded growth.
		for k := range c.m {
			delete(c.m, k)
			break
		}
	}
	c.m[key] = entry{body: body, at: time.Now()}
}

var searches = &cache{m: map[string]entry{}}

func authorized(got string) bool {
	// constant time, so a wrong secret can't be narrowed down by timing
	return secret != "" && subtle.ConstantTimeCompare([]byte(got), []byte(secret)) == 1
}

func writeJSON(w http.ResponseWriter, code int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write(body)
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	if !authorized(r.Header.Get("X-Relay-Secret")) {
		writeJSON(w, http.StatusUnauthorized, []byte(`{"error":"unauthorized"}`))
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeJSON(w, http.StatusBadRequest, []byte(`{"error":"missing q"}`))
		return
	}
	rows, err := strconv.Atoi(r.URL.Query().Get("n"))
	if err != nil || rows < 1 {
		rows = 8
	}
	if rows > 10 {
		rows = 10
	}

	key := strconv.Itoa(rows) + ":" + strings.ToLower(query)
	if body, ok := searches.get(key); ok {
		w.Header().Set("X-Relay-Cache", "hit")
		writeJSON(w, http.StatusOK, body)
		return
	}

	// The upstream URL is built here, not taken from the caller: this endpoint
	// can only ever ask JioSaavn to search, which is what keeps it from being
	// repurposed as a general fetcher.
	params := url.Values{}
	params.Set("__call", "search.getResults")
	params.Set("q", query)
	params.Set("n", strconv.Itoa(rows))
	params.Set("p", "1")
	params.Set("ctx", "web6dot0")
	params.Set("api_version", "4")
	params.Set("_format", "json")
	params.Set("_marker", "0")

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet,
		upstreamSearch+"?"+params.Encode(), nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, []byte(`{"error":"bad request"}`))
		return
	}
	req.Header.Set("User-Agent", userAgent)

	resp, err := (&http.Client{Timeout: upstreamTimeout}).Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, []byte(`{"error":"upstream failed"}`))
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil || !json.Valid(body) {
		writeJSON(w, http.StatusBadGateway, []byte(`{"error":"bad upstream body"}`))
		return
	}

	searches.put(key, body)
	w.Header().Set("X-Relay-Cache", "miss")
	writeJSON(w, http.StatusOK, body)
}

func hostAllowed(hostport string) bool {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	for _, suffix := range allowed {
		if host == strings.TrimPrefix(suffix, ".") || strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

func proxyAuthorized(header string) bool {
	const prefix = "Basic "
	if !strings.HasPrefix(header, prefix) {
		return false
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(header, prefix))
	if err != nil {
		return false
	}
	_, pass, ok := strings.Cut(string(raw), ":")
	return ok && authorized(pass)
}

// handleConnect opens a blind TCP tunnel. Blind is the point: yt-dlp
// negotiates TLS with the far end through it, so the cookies it sends are
// never visible here and this process has nothing to leak.
func handleConnect(w http.ResponseWriter, r *http.Request) {
	if !proxyAuthorized(r.Header.Get("Proxy-Authorization")) {
		w.Header().Set("Proxy-Authenticate", `Basic realm="relay"`)
		http.Error(w, "proxy auth required", http.StatusProxyAuthRequired)
		return
	}
	if !hostAllowed(r.Host) {
		http.Error(w, "host not allowed", http.StatusForbidden)
		return
	}

	upstream, err := net.DialTimeout("tcp", r.Host, 15*time.Second)
	if err != nil {
		http.Error(w, "upstream unreachable", http.StatusBadGateway)
		return
	}
	defer upstream.Close()

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "cannot hijack", http.StatusInternalServerError)
		return
	}
	client, _, err := hijacker.Hijack()
	if err != nil {
		return
	}
	defer client.Close()

	if _, err := client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n")); err != nil {
		return
	}

	_ = client.SetDeadline(time.Now().Add(tunnelIdle))
	_ = upstream.SetDeadline(time.Now().Add(tunnelIdle))

	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(upstream, client); done <- struct{}{} }()
	go func() { _, _ = io.Copy(client, upstream); done <- struct{}{} }()
	<-done
}

func main() {
	secret = os.Getenv("RELAY_SECRET")
	if secret == "" {
		log.Fatal("RELAY_SECRET is required")
	}
	addr := os.Getenv("RELAY_ADDR")
	if addr == "" {
		addr = ":8088"
	}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodConnect {
			handleConnect(w, r)
			return
		}
		switch r.URL.Path {
		case "/health":
			writeJSON(w, http.StatusOK, []byte(`{"ok":true}`))
		case "/saavn/search":
			handleSearch(w, r)
		default:
			writeJSON(w, http.StatusNotFound, []byte(`{"error":"not found"}`))
		}
	})

	server := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("relay listening on %s", addr)
	log.Fatal(server.ListenAndServe())
}
