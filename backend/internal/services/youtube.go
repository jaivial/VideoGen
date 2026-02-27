package services

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/publicsuffix"
)

type YouTubeService struct {
	tempDir         string
	client          *http.Client
	pythonScriptPath string
}

// PythonTranscriptResult represents the result from the Python script
type PythonTranscriptResult struct {
	VideoID     string                   `json:"video_id"`
	Language    string                   `json:"language"`
	IsGenerated bool                     `json:"is_generated"`
	Transcript  []PythonTranscriptEntry  `json:"transcript"`
}

// PythonTranscriptEntry represents a transcript entry from Python script
type PythonTranscriptEntry struct {
	Text     string  `json:"text"`
	Start    float64 `json:"start"`
	Duration float64 `json:"duration"`
}

// realisticHeaders returns headers that mimic a real browser
func realisticHeaders() http.Header {
	return http.Header{
		"User-Agent": []string{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"},
		"Accept":     []string{"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"},
		"Accept-Language": []string{"en-US,en;q=0.9"},
		// Note: Not setting Accept-Encoding to let server send uncompressed or handle via Transport
		"DNT":          []string{"1"},
		"Connection":   []string{"keep-alive"},
		"Upgrade-Insecure-Requests": []string{"1"},
		"Sec-Fetch-Dest": []string{"document"},
		"Sec-Fetch-Mode": []string{"navigate"},
		"Sec-Fetch-Site": []string{"none"},
		"Sec-Fetch-User": []string{"?1"},
		"Cache-Control": []string{"max-age=0"},
	}
}

// setConsentCookie sets the GDPR consent cookie for YouTube
func setConsentCookie(req *http.Request) {
	// Set CONSENT cookie to accept terms (needed for YouTube)
	req.AddCookie(&http.Cookie{
		Name:   "CONSENT",
		Value:  "YES+",
		Path:   "/",
		Domain: ".youtube.com",
	})
}

// TranscriptEntry represents a single line of transcript with timestamps
type TranscriptEntry struct {
	Start    string `json:"start"`
	End      string `json:"end"`
	Text     string `json:"text"`
	Language string `json:"language"`
}

// Transcript represents the full transcript data
type Transcript struct {
	VideoID    string            `json:"video_id"`
	Language   string            `json:"language"`
	Kind       string            `json:"kind"` // "asr" = auto-generated, "" = manual
	Entries    []TranscriptEntry `json:"entries"`
	PlainText  string            `json:"plain_text"`
}

// PlayerResponse for parsing YouTube API response
type PlayerResponse struct {
	Captions struct {
		PlayerCaptionsTracklistRenderer struct {
			CaptionTracks []struct {
				BaseURL      string `json:"baseUrl"`
				LanguageCode string `json:"languageCode"`
				Name         struct {
					SimpleText string `json:"simpleText"`
				} `json:"name"`
				Kind string `json:"kind"`
			} `json:"captionTracks"`
		} `json:"playerCaptionsTracklistRenderer"`
	} `json:"captions"`
}

func NewYouTubeService(tempDir string) *YouTubeService {
	// Create cookie jar for persistent cookies
	jar, err := cookiejar.New(&cookiejar.Options{
		PublicSuffixList: publicsuffix.List,
	})
	if err != nil {
		// Fall back to no jar if creation fails
		jar = nil
	}

	// Custom transport to handle compression
	transport := &http.Transport{
		// Don't disable compression, let the client handle it
		// We'll set Accept-Encoding to get gzip responses that auto-decompress
	}

	client := &http.Client{
		Timeout:   20 * time.Second,
		Jar:       jar,
		Transport: transport,
	}

	// Try multiple possible locations for the Node.js script
	// Default to Docker path
	scriptPath := "/app/scripts/youtube_transcript.js"
	if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
		// Try local development path (running from backend directory)
		scriptPath = filepath.Join("/root/video-generator/backend/scripts", "youtube_transcript.js")
		if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
			// Fall back to relative path from tempDir
			scriptPath = filepath.Join(tempDir, "..", "..", "scripts", "youtube_transcript.js")
		}
	}

	return &YouTubeService{
		tempDir:         tempDir,
		client:          client,
		pythonScriptPath: scriptPath,
	}
}

// cookiesFilePath returns the path to the cookies file for yt-dlp
func (s *YouTubeService) cookiesFilePath() string {
	cookiesFile := filepath.Join(s.tempDir, "youtube_cookies.txt")

	// Create consent cookie file if it doesn't exist
	if _, err := os.Stat(cookiesFile); os.IsNotExist(err) {
		// Create basic consent cookie
		content := "# Netscape HTTP Cookie File\n"
		content += ".youtube.com\tTRUE\t/\tTRUE\t2147483647\tCONSENT\tYES+\n"
		content += ".youtube.com\tTRUE\t/\tTRUE\t2147483647\tPREF\tf6=40000000&tz=UTC\n"
		_ = os.WriteFile(cookiesFile, []byte(content), 0600)
	}

	return cookiesFile
}

// saveCookiesToFile saves the current cookies from the jar to a file for yt-dlp
func (s *YouTubeService) saveCookiesToFile() error {
	cookiesFile := s.cookiesFilePath()

	// Get cookies from the jar for youtube.com
	youtubeURL, _ := url.Parse("https://www.youtube.com")
	cookies := s.client.Jar.Cookies(youtubeURL)

	if len(cookies) == 0 {
		// If no cookies, create a basic consent cookie file
		content := "# Netscape HTTP Cookie File\n"
		content += ".youtube.com\tTRUE\t/\tTRUE\t\tCONSENT\tYES+\n"
		return os.WriteFile(cookiesFile, []byte(content), 0600)
	}

	// Write cookies in Netscape format
	var lines []string
	lines = append(lines, "# Netscape HTTP Cookie File")
	for _, cookie := range cookies {
		// Convert expiration time to Unix timestamp
		expire := int64(0)
		if !cookie.Expires.IsZero() {
			expire = cookie.Expires.Unix()
		}
		domain := cookie.Domain
		if !strings.HasPrefix(domain, ".") {
			domain = "." + domain
		}
		secure := "FALSE"
		if cookie.Secure {
			secure = "TRUE"
		}
		line := fmt.Sprintf("%s\tTRUE\t%s\t%s\t%d\t%s\t%s",
			domain, cookie.Path, secure, expire, cookie.Name, cookie.Value)
		lines = append(lines, line)
	}

	return os.WriteFile(cookiesFile, []byte(strings.Join(lines, "\n")), 0600)
}

func (s *YouTubeService) DownloadAudio(videoURL string) (string, error) {
	outputPath := filepath.Join(s.tempDir, "audio")

	if err := os.MkdirAll(outputPath, 0755); err != nil {
		return "", fmt.Errorf("failed to create temp dir: %w", err)
	}

	// First, ensure we have consent cookies by making a request
	// This populates the cookie jar
	_, _ = s.fetchWatchHTML("dummy") // Ignore error, just populate cookies

	// Save cookies to file for yt-dlp
	_ = s.saveCookiesToFile() // Best effort, may not have cookies yet

	// yt-dlp command to download audio with realistic headers and cookies
	cmd := exec.Command("yt-dlp",
		"-x",
		"--audio-format", "mp3",
		"--audio-quality", "0",
		"-o", filepath.Join(outputPath, "%(id)s.%(ext)s"),
		"--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"--add-header", "Accept-Language:en-US,en;q=0.9",
		videoURL,
	)

	// Use cookies if available
	cookiesFile := s.cookiesFilePath()
	if _, err := os.Stat(cookiesFile); err == nil {
		cmd.Args = append(cmd.Args, "--cookies", cookiesFile)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to download audio: %w\noutput: %s", err, string(output))
	}

	// Find the downloaded file
	files, err := os.ReadDir(outputPath)
	if err != nil {
		return "", fmt.Errorf("failed to read output dir: %w", err)
	}

	for _, f := range files {
		if strings.HasSuffix(f.Name(), ".mp3") {
			return filepath.Join(outputPath, f.Name()), nil
		}
	}

	return "", fmt.Errorf("no audio file found after download")
}

func (s *YouTubeService) GetVideoID(url string) (string, error) {
	cmd := exec.Command("yt-dlp", "--get-id", url)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("failed to get video ID: %w", err)
	}
	return strings.TrimSpace(string(output)), nil
}

// GetTranscriptPython fetches transcript using Node.js youtube-transcript-api
// This avoids bot detection issues with yt-dlp
func (s *YouTubeService) GetTranscriptPython(videoID string, lang string) (*Transcript, error) {
	// Build command with Node.js script
	var cmd *exec.Cmd
	scriptPath := strings.Replace(s.pythonScriptPath, "_transcript.py", "_transcript.js", 1)
	if lang != "" {
		cmd = exec.Command("node", scriptPath, "--video="+videoID, "--lang="+lang)
	} else {
		cmd = exec.Command("node", scriptPath, "--video="+videoID)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to run transcript script: %w\noutput: %s", err, string(output))
	}

	// Parse JSON response
	var result PythonTranscriptResult
	if err := json.Unmarshal(output, &result); err != nil {
		return nil, fmt.Errorf("failed to parse transcript JSON: %w\noutput: %s", err, string(output))
	}

	// Convert to our Transcript format
	entries := make([]TranscriptEntry, len(result.Transcript))
	var plainText []string
	for i, entry := range result.Transcript {
		entries[i] = TranscriptEntry{
			Start: fmt.Sprintf("%.2f", entry.Start),
			End:   fmt.Sprintf("%.2f", entry.Start+entry.Duration),
			Text:  entry.Text,
		}
		plainText = append(plainText, entry.Text)
	}

	kind := "manual"
	if result.IsGenerated {
		kind = "asr"
	}

	return &Transcript{
		VideoID:   result.VideoID,
		Language:  result.Language,
		Kind:      kind,
		Entries:   entries,
		PlainText: strings.Join(plainText, "\n"),
	}, nil
}

// GetTranscript fetches the transcript from a YouTube video
// Returns plain text by default, or full transcript with timestamps if requested
// Uses Python youtube-transcript-api to avoid bot detection
func (s *YouTubeService) GetTranscript(videoIDOrURL string, lang string) (*Transcript, error) {
	videoID, err := normalizeVideoID(videoIDOrURL)
	if err != nil {
		return nil, fmt.Errorf("invalid video ID: %w", err)
	}

	// Use Python script (more reliable, no bot detection)
	return s.GetTranscriptPython(videoID, lang)
}

// findAndParseTranscript finds and parses subtitle files created by yt-dlp
func findAndParseTranscript(dir, videoID string) ([]TranscriptEntry, error) {
	// Look for common subtitle file patterns
	patterns := []string{
		videoID + ".en.srt",
		videoID + ".en.vtt",
		videoID + ".srt",
		videoID + ".vtt",
		videoID + ".en-US.srt",
		videoID + ".en-US.vtt",
	}

	for _, pattern := range patterns {
		path := filepath.Join(dir, pattern)
		if _, err := os.Stat(path); err == nil {
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			// Try parsing as SRT/VTT
			entries := parseVTT(string(data))
			if len(entries) > 0 {
				os.Remove(path) // Clean up
				return entries, nil
			}
			os.Remove(path)
		}
	}

	// Fall back to listing all files in directory
	files, _ := os.ReadDir(dir)
	for _, f := range files {
		if strings.Contains(f.Name(), videoID) && (strings.HasSuffix(f.Name(), ".srt") || strings.HasSuffix(f.Name(), ".vtt")) {
			path := filepath.Join(dir, f.Name())
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			entries := parseVTT(string(data))
			if len(entries) > 0 {
				os.Remove(path)
				return entries, nil
			}
			os.Remove(path)
		}
	}

	return nil, errors.New("no transcript file found")
}

// clientConfig holds YouTube API client configuration
type clientConfig struct {
	clientName    string
	clientVersion string
}

// Try different clients to get captions
var clientConfigs = []clientConfig{
	{"WEB", "2.20240101.00.00"},
	{"ANDROID", "19.09.37"},
	{"TVHTML5", "6.20190911.08.00"},
}

// getInnertubeKey fetches the Innertube API key from YouTube
func (s *YouTubeService) getInnertubeKey() (string, error) {
	// First get the watch page to extract the INNERTUBE_API_KEY
	videoID := "dQw4w9WgXcQ" // Use a well-known video to get the key
	watchURL := "https://www.youtube.com/watch?v=" + videoID

	req, err := http.NewRequest("GET", watchURL, nil)
	if err != nil {
		return "", err
	}
	req.Header = realisticHeaders()
	setConsentCookie(req)

	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// Handle gzip
	var reader io.Reader = resp.Body
	if resp.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(resp.Body)
		if err != nil {
			return "", err
		}
		reader = gz
		defer gz.Close()
	}

	body, err := io.ReadAll(reader)
	if err != nil {
		return "", err
	}

	// Look for INNERTUBE_API_KEY in the page
	re := regexp.MustCompile(`"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"`)
	m := re.FindStringSubmatch(string(body))
	if len(m) >= 2 {
		return m[1], nil
	}

	// Fallback to a known key
	return "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", nil
}

// getPlayerResponse calls the YouTube Innertube API with a specific client
func (s *YouTubeService) getPlayerResponse(videoID string, config clientConfig) (*PlayerResponse, error) {
	apiKey, err := s.getInnertubeKey()
	if err != nil {
		apiKey = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
	}

	apiURL := fmt.Sprintf("https://www.youtube.com/youtubei/v1/player?key=%s", apiKey)

	// Build the request payload
	payload := map[string]interface{}{
		"context": map[string]interface{}{
			"client": map[string]string{
				"clientName":    config.clientName,
				"clientVersion": config.clientVersion,
			},
		},
		"videoId": videoID,
	}

	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", apiURL, strings.NewReader(string(payloadJSON)))
	if err != nil {
		return nil, err
	}

	req.Header = realisticHeaders()
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YouTube-Client-Name", config.clientName)
	req.Header.Set("X-YouTube-Client-Version", config.clientVersion)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// Handle gzip
	var reader io.Reader = resp.Body
	if resp.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(resp.Body)
		if err != nil {
			return nil, err
		}
		reader = gz
		defer gz.Close()
	}

	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}

	var pr PlayerResponse
	if err := json.Unmarshal(body, &pr); err != nil {
		return nil, fmt.Errorf("failed to parse player response: %w", err)
	}

	return &pr, nil
}

// GetAvailableLanguages returns list of available transcript languages for a video
func (s *YouTubeService) GetAvailableLanguages(videoIDOrURL string) ([]map[string]string, error) {
	videoID, err := normalizeVideoID(videoIDOrURL)
	if err != nil {
		return nil, fmt.Errorf("invalid video ID: %w", err)
	}

	// Try different clients
	var lastErr error
	for _, config := range clientConfigs {
		pr, err := s.getPlayerResponse(videoID, config)
		if err != nil {
			lastErr = err
			continue
		}

		tracks := pr.Captions.PlayerCaptionsTracklistRenderer.CaptionTracks
		if len(tracks) > 0 {
			var languages []map[string]string
			for _, track := range tracks {
				kind := track.Kind
				if kind == "asr" {
					kind = "auto-generated"
				} else if kind != "" {
					kind = "manual"
				}
				languages = append(languages, map[string]string{
					"code": track.LanguageCode,
					"name": track.Name.SimpleText,
					"kind": kind,
				})
			}
			return languages, nil
		}
	}

	// Fallback to HTML parsing
	htmlBody, err := s.fetchWatchHTML(videoID)
	if err != nil {
		if lastErr != nil {
			return nil, fmt.Errorf("all clients failed: %v, fallback also failed: %w", lastErr, err)
		}
		return nil, fmt.Errorf("failed to fetch video page: %w", err)
	}

	pr, err := extractInitialPlayerResponse(htmlBody)
	if err != nil {
		if lastErr != nil {
			return nil, fmt.Errorf("all clients failed: %v, fallback also failed: %w", lastErr, err)
		}
		return nil, fmt.Errorf("failed to extract player response: %w", err)
	}

	tracks := pr.Captions.PlayerCaptionsTracklistRenderer.CaptionTracks
	if len(tracks) == 0 {
		return nil, errors.New("no captions available for this video")
	}

	var languages []map[string]string
	for _, track := range tracks {
		kind := track.Kind
		if kind == "asr" {
			kind = "auto-generated"
		} else {
			kind = "manual"
		}
		languages = append(languages, map[string]string{
			"code": track.LanguageCode,
			"name": track.Name.SimpleText,
			"kind": kind,
		})
	}

	return languages, nil
}

func normalizeVideoID(input string) (string, error) {
	if strings.HasPrefix(input, "http://") || strings.HasPrefix(input, "https://") {
		u, err := url.Parse(input)
		if err != nil {
			return "", err
		}
		if strings.Contains(u.Host, "youtu.be") {
			id := strings.Trim(strings.Trim(u.Path, "/"), " ")
			if id == "" {
				return "", errors.New("URL youtu.be without ID")
			}
			return id, nil
		}
		q := u.Query().Get("v")
		if q == "" {
			return "", errors.New("no v= parameter found in URL")
		}
		return q, nil
	}
	if input == "" {
		return "", errors.New("video ID is empty")
	}
	return input, nil
}

func (s *YouTubeService) fetchWatchHTML(videoID string) (string, error) {
	watchURL := "https://www.youtube.com/watch?v=" + url.QueryEscape(videoID)

	req, err := http.NewRequest("GET", watchURL, nil)
	if err != nil {
		return "", err
	}

	// Set realistic browser headers
	req.Header = realisticHeaders()

	// Set consent cookie for GDPR
	setConsentCookie(req)

	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("watch page status %d", resp.StatusCode)
	}

	// Handle gzip decompression
	var reader io.Reader = resp.Body
	if resp.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(resp.Body)
		if err != nil {
			return "", fmt.Errorf("failed to create gzip reader: %w", err)
		}
		reader = gz
		defer gz.Close()
	}

	b, err := io.ReadAll(reader)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func extractInitialPlayerResponse(pageHTML string) (*PlayerResponse, error) {
	re := regexp.MustCompile(`(?s)ytInitialPlayerResponse\s*=\s*(\{.*?\})\s*;`)
	m := re.FindStringSubmatch(pageHTML)
	if len(m) < 2 {
		re2 := regexp.MustCompile(`(?s)"ytInitialPlayerResponse"\s*:\s*(\{.*?\})\s*,\s*"ytInitialData"`)
		m2 := re2.FindStringSubmatch(pageHTML)
		if len(m2) < 2 {
			return nil, errors.New("could not extract ytInitialPlayerResponse (YouTube may have changed or video is restricted)")
		}
		m = []string{m2[0], m2[1]}
	}

	raw := m[1]

	var pr PlayerResponse
	if err := json.Unmarshal([]byte(raw), &pr); err != nil {
		return nil, fmt.Errorf("json unmarshal playerResponse: %w", err)
	}
	return &pr, nil
}

func chooseTrack(tracks []struct {
	BaseURL      string `json:"baseUrl"`
	LanguageCode string `json:"languageCode"`
	Name         struct {
		SimpleText string `json:"simpleText"`
	} `json:"name"`
	Kind string `json:"kind"`
}, lang string) (*struct {
	BaseURL      string `json:"baseUrl"`
	LanguageCode string `json:"languageCode"`
	Name         struct {
		SimpleText string `json:"simpleText"`
	} `json:"name"`
	Kind string `json:"kind"`
}, error) {

	if lang != "" {
		for i := range tracks {
			if strings.EqualFold(tracks[i].LanguageCode, lang) {
				return &tracks[i], nil
			}
		}
		for i := range tracks {
			if strings.HasPrefix(strings.ToLower(tracks[i].LanguageCode), strings.ToLower(lang)) {
				return &tracks[i], nil
			}
		}
		return nil, fmt.Errorf("no track for language %q (available: %s)", lang, availableLangs(tracks))
	}

	for i := range tracks {
		if tracks[i].Kind != "asr" {
			return &tracks[i], nil
		}
	}
	return &tracks[0], nil
}

func availableLangs(tracks []struct {
	BaseURL      string `json:"baseUrl"`
	LanguageCode string `json:"languageCode"`
	Name         struct {
		SimpleText string `json:"simpleText"`
	} `json:"name"`
	Kind string `json:"kind"`
}) string {
	var parts []string
	for _, t := range tracks {
		parts = append(parts, t.LanguageCode)
	}
	return strings.Join(parts, ", ")
}

func ensureVTT(base string) string {
	// First, handle unicode escapes like \u0026 -> &
	decoded := strings.ReplaceAll(base, "\\u0026", "&")
	decoded = strings.ReplaceAll(decoded, "\\u0026", "&")

	// Then, unescape URL-encoded characters
	decoded, err := url.QueryUnescape(decoded)
	if err != nil {
		decoded = base
	}

	u, err := url.Parse(decoded)
	if err != nil {
		return decoded
	}
	q := u.Query()
	if q.Get("fmt") == "" {
		q.Set("fmt", "vtt")
		u.RawQuery = q.Encode()
	}
	return u.String()
}

func (s *YouTubeService) fetchText(videoID, vttURL string) (string, error) {
	// First fetch the watch page to populate cookies
	_, err := s.fetchWatchHTML(videoID)
	if err != nil {
		// Continue anyway, we might have some cookies
	}

	// Now fetch the VTT with the cookies from the watch page
	req, err := http.NewRequest("GET", vttURL, nil)
	if err != nil {
		return "", err
	}

	// Set realistic browser headers
	req.Header = realisticHeaders()

	// Add referer to make YouTube think we're coming from the video page
	req.Header.Set("Referer", "https://www.youtube.com/watch?v="+videoID)

	// Set consent cookie for GDPR
	setConsentCookie(req)

	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("caption fetch status %d", resp.StatusCode)
	}

	// Handle gzip decompression
	var reader io.Reader = resp.Body
	if resp.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(resp.Body)
		if err != nil {
			return "", fmt.Errorf("failed to create gzip reader: %w", err)
		}
		reader = gz
		defer gz.Close()
	}

	b, err := io.ReadAll(reader)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func parseVTT(vtt string) []TranscriptEntry {
	var entries []TranscriptEntry
	sc := bufio.NewScanner(strings.NewReader(vtt))

	tsRe := regexp.MustCompile(`^(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})`)

	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "WEBVTT") {
			continue
		}
		if tsRe.MatchString(line) {
			continue
		}
		line = stripTags(line)
		line = html.UnescapeString(line)
		if line != "" {
			entries = append(entries, TranscriptEntry{
				Text: line,
			})
		}
	}
	return entries
}

func stripTags(s string) string {
	re := regexp.MustCompile(`<[^>]+>`)
	return re.ReplaceAllString(s, "")
}

func entriesToPlainText(entries []TranscriptEntry) string {
	var lines []string
	prev := ""
	for _, e := range entries {
		text := strings.TrimSpace(e.Text)
		if text == "" || text == prev {
			continue
		}
		lines = append(lines, text)
		prev = text
	}
	return strings.Join(lines, "\n")
}
