package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	mysql "github.com/go-sql-driver/mysql"
	"video-generator/internal/db"
	"video-generator/internal/services"
)

type EditorHandler struct {
	db           *db.DB
	bunnyService *services.BunnyService
	auth         *AuthHandler
	renderer     *services.EditorRenderService
	tempDir      string
}

func NewEditorHandler(database *db.DB, bunnyService *services.BunnyService, auth *AuthHandler, renderer *services.EditorRenderService, tempDir string) *EditorHandler {
	return &EditorHandler{
		db:           database,
		bunnyService: bunnyService,
		auth:         auth,
		renderer:     renderer,
		tempDir:      tempDir,
	}
}

// UploadMedia handles POST /api/editor/upload-media
func (h *EditorHandler) UploadMedia(w http.ResponseWriter, r *http.Request) {
	userID, err := h.auth.GetSessionUser(w, r)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Parse multipart form
	if err := r.ParseMultipartForm(512 << 20); err != nil { // 512MB max
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Read file content
	fileContent, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	// Get file type
	mediaType := r.FormValue("type")
	ext := filepath.Ext(header.Filename)
	if ext == "" {
		switch mediaType {
		case "video":
			ext = ".mp4"
		case "audio":
			ext = ".mp3"
		case "image":
			ext = ".jpg"
		default:
			ext = ".bin"
		}
	}
	ext = strings.ToLower(ext)
	if len(ext) > 10 || strings.Contains(ext, "/") || strings.Contains(ext, "\\") {
		http.Error(w, "Invalid file extension", http.StatusBadRequest)
		return
	}

	// Generate unique filename
	filename := fmt.Sprintf("editor_%d_%d%s", userID, time.Now().UnixNano(), ext)

	// Upload to Bunny when configured, otherwise store local file so FFmpeg can read it.
	url := ""
	if h.bunnyService != nil && h.bunnyService.IsConfigured() {
		uploadedURL, uploadErr := h.bunnyService.UploadMedia(filename, fileContent, mediaType)
		if uploadErr == nil {
			url = uploadedURL
		}
	}
	if url == "" {
		localURL, localErr := h.saveLocalEditorUpload(r, filename, fileContent)
		if localErr != nil {
			http.Error(w, "Failed to upload media", http.StatusInternalServerError)
			return
		}
		url = localURL
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"url":      url,
		"filename": filename,
	})
}

func (h *EditorHandler) saveLocalEditorUpload(r *http.Request, filename string, content []byte) (string, error) {
	baseDir := filepath.Join(h.tempDir, "editor_uploads")
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return "", err
	}
	outputPath := filepath.Join(baseDir, filename)
	if err := os.WriteFile(outputPath, content, 0644); err != nil {
		return "", err
	}

	proto := "http"
	if r.TLS != nil {
		proto = "https"
	}
	if forwarded := r.Header.Get("X-Forwarded-Proto"); forwarded != "" {
		proto = strings.Split(forwarded, ",")[0]
	}

	return fmt.Sprintf("%s://%s/media/editor/%s", proto, r.Host, filename), nil
}

// ProcessVideo handles POST /api/editor/video/{id}/process
func (h *EditorHandler) ProcessVideo(w http.ResponseWriter, r *http.Request) {
	userID, err := h.auth.GetSessionUser(w, r)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Extract video ID from URL
	videoIDStr := chi.URLParam(r, "id")
	videoID, err := strconv.ParseUint(videoIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid video ID", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var video struct {
		UserID uint64 `db:"user_id"`
	}
	err = h.db.Get(&video, "SELECT user_id FROM videos_requested WHERE id = ?", videoID)
	if err != nil {
		http.Error(w, "Video not found", http.StatusNotFound)
		return
	}
	if video.UserID != userID {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Parse request body
	var req struct {
		VideoTimeline []map[string]interface{} `json:"video_timeline"`
		AudioTimeline []map[string]interface{} `json:"audio_timeline"`
		Captions      []map[string]interface{} `json:"captions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Create new video request with edited settings
	result, err := h.db.Exec(
		"INSERT INTO videos_requested (user_id, user_video_url_id, phase_of_generation) VALUES (?, NULL, 'pending')",
		userID,
	)
	if err != nil {
		http.Error(w, "Failed to create request", http.StatusInternalServerError)
		return
	}

	newVideoID, _ := result.LastInsertId()

	// Store editor data in a separate table or as JSON in the video record
	// For now, we'll just return the request ID
	// The actual processing would be handled by the worker

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":    "Video processing started",
		"request_id": newVideoID,
	})
}

// GetVideoAssets handles GET /api/editor/video/{id}/assets
func (h *EditorHandler) GetVideoAssets(w http.ResponseWriter, r *http.Request) {
	userID, err := h.auth.GetSessionUser(w, r)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Extract video ID from URL
	videoIDStr := chi.URLParam(r, "id")
	videoID, err := strconv.ParseUint(videoIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid video ID", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var video struct {
		UserID                uint64 `db:"user_id"`
		BunnyVideoURL         string `db:"bunny_video_url"`
		BunnyVideoID          string `db:"bunny_video_id"`
		BunnyAudioURL         string `db:"bunny_audio_url"`
		EditorCaptionSegments string `db:"editor_caption_segments"`
		EditorAudioSegments   string `db:"editor_audio_segments"`
		EditorImageSegments   string `db:"editor_image_segments"`
		TranscribedText       string `db:"transcribed_text"`
		OutputLanguage        string `db:"output_language"`
	}
	err = h.db.Get(&video, `
		SELECT user_id, IFNULL(bunny_video_url, '') as bunny_video_url,
		       IFNULL(bunny_video_id, '') as bunny_video_id,
		       IFNULL(bunny_audio_url, '') as bunny_audio_url,
		       IFNULL(editor_caption_segments, '') as editor_caption_segments,
		       IFNULL(editor_audio_segments, '') as editor_audio_segments,
		       IFNULL(editor_image_segments, '') as editor_image_segments,
		       IFNULL(transcribed_text, '') as transcribed_text,
		       output_language
		FROM videos_requested WHERE id = ?`, videoID)
	if err != nil {
		http.Error(w, "Video not found", http.StatusNotFound)
		return
	}
	if video.UserID != userID {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Return video assets
	downloadURL := video.BunnyVideoURL
	if downloadURL == "" {
		downloadURL = video.BunnyVideoID
	}
	audioURL := video.BunnyAudioURL
	if audioURL == "" {
		audioURL = downloadURL
	}

	// Load generated image URLs (if available).
	imageURLs := []string{}
	var imageGen struct {
		ImageURLs sql.NullString `db:"image_urls"`
	}
	err = h.db.Get(&imageGen, `
		SELECT image_urls
		FROM images_generated
		WHERE video_requested_id = ?
		ORDER BY id DESC
		LIMIT 1`, videoID)
	if err != nil && err != sql.ErrNoRows && !isOptionalAssetQueryErr(err) {
		http.Error(w, "Failed to load image assets", http.StatusInternalServerError)
		return
	}
	if imageGen.ImageURLs.Valid && strings.TrimSpace(imageGen.ImageURLs.String) != "" {
		_ = json.Unmarshal([]byte(imageGen.ImageURLs.String), &imageURLs)
	}

	// Load translated lines (if available).
	translatedLines := []string{}
	var translation struct {
		TextsTranslated sql.NullString `db:"texts_translated"`
	}
	err = h.db.Get(&translation, `
		SELECT texts_translated
		FROM text_translation
		WHERE video_requested_id = ?
		ORDER BY id DESC
		LIMIT 1`, videoID)
	if err != nil && err != sql.ErrNoRows && !isOptionalAssetQueryErr(err) {
		http.Error(w, "Failed to load translated lines", http.StatusInternalServerError)
		return
	}
	if translation.TextsTranslated.Valid && strings.TrimSpace(translation.TextsTranslated.String) != "" {
		_ = json.Unmarshal([]byte(translation.TextsTranslated.String), &translatedLines)
	}

	// Load transcription chunks with timing (if available).
	transcriptionChunks := []map[string]interface{}{}
	var transcription struct {
		Chunks sql.NullString `db:"chunks"`
	}
	err = h.db.Get(&transcription, `
		SELECT chunks
		FROM video_transcription
		WHERE video_requested_id = ?
		ORDER BY id DESC
		LIMIT 1`, videoID)
	if err != nil && err != sql.ErrNoRows && !isOptionalAssetQueryErr(err) {
		http.Error(w, "Failed to load transcription chunks", http.StatusInternalServerError)
		return
	}
	if transcription.Chunks.Valid && strings.TrimSpace(transcription.Chunks.String) != "" {
		_ = json.Unmarshal([]byte(transcription.Chunks.String), &transcriptionChunks)
	}

	// Load precomputed editor segments (Whisper captions + per-item image/audio timing).
	captionSegments := []map[string]interface{}{}
	if strings.TrimSpace(video.EditorCaptionSegments) != "" {
		_ = json.Unmarshal([]byte(video.EditorCaptionSegments), &captionSegments)
	}

	audioSegments := []map[string]interface{}{}
	if strings.TrimSpace(video.EditorAudioSegments) != "" {
		_ = json.Unmarshal([]byte(video.EditorAudioSegments), &audioSegments)
	}

	imageSegments := []map[string]interface{}{}
	if strings.TrimSpace(video.EditorImageSegments) != "" {
		_ = json.Unmarshal([]byte(video.EditorImageSegments), &imageSegments)
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":                   videoID,
		"download_url":         downloadURL,
		"audio_url":            audioURL,
		"image_urls":           imageURLs,
		"image_segments":       imageSegments,
		"audio_segments":       audioSegments,
		"caption_segments":     captionSegments,
		"translated_lines":     translatedLines,
		"transcription_chunks": transcriptionChunks,
		"transcribed_text":     video.TranscribedText,
		"output_language":      video.OutputLanguage,
	})
}

func isOptionalAssetQueryErr(err error) bool {
	mysqlErr, ok := err.(*mysql.MySQLError)
	if !ok {
		return false
	}

	// Missing table or column on older schemas: skip optional data instead of hard-failing.
	return mysqlErr.Number == 1146 || mysqlErr.Number == 1054
}

// RenderVideo handles POST /api/editor/video/{id}/render
// It performs an FFmpeg "pre-composition" render of the current timeline and returns an MP4.
func (h *EditorHandler) RenderVideo(w http.ResponseWriter, r *http.Request) {
	userID, err := h.auth.GetSessionUser(w, r)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	videoIDStr := chi.URLParam(r, "id")
	videoID, err := strconv.ParseUint(videoIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid video ID", http.StatusBadRequest)
		return
	}

	// Verify ownership and fetch source URL
	var video struct {
		UserID        uint64 `db:"user_id"`
		BunnyVideoURL string `db:"bunny_video_url"`
		BunnyVideoID  string `db:"bunny_video_id"`
	}
	err = h.db.Get(&video, `
		SELECT user_id,
		       IFNULL(bunny_video_url, '') as bunny_video_url,
		       IFNULL(bunny_video_id, '') as bunny_video_id
		FROM videos_requested WHERE id = ?`, videoID)
	if err != nil {
		http.Error(w, "Video not found", http.StatusNotFound)
		return
	}
	if video.UserID != userID {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	sourceURL := video.BunnyVideoURL
	if sourceURL == "" {
		sourceURL = video.BunnyVideoID
	}
	if sourceURL == "" {
		http.Error(w, "Source video URL not available", http.StatusBadRequest)
		return
	}

	var req services.EditorRenderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if h.renderer == nil {
		http.Error(w, "Renderer not configured", http.StatusInternalServerError)
		return
	}

	outPath, mime, err := h.renderer.RenderTimeline(r.Context(), videoID, sourceURL, req)
	if err != nil {
		http.Error(w, "Render failed: "+err.Error(), http.StatusBadRequest)
		return
	}
	defer os.Remove(outPath)

	f, err := os.Open(outPath)
	if err != nil {
		http.Error(w, "Failed to open rendered file", http.StatusInternalServerError)
		return
	}
	defer f.Close()

	st, err := f.Stat()
	if err == nil {
		w.Header().Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"edited_%d.mp4\"", videoID))

	if _, err := io.Copy(w, f); err != nil {
		// Client disconnected or network error; nothing else to do.
		return
	}
}
