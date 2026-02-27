package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"time"

	"video-generator/internal/db"
	"video-generator/internal/services"
)

type EditorHandler struct {
	db          *db.DB
	bunnyService *services.BunnyService
	auth        *AuthHandler
}

func NewEditorHandler(database *db.DB, bunnyService *services.BunnyService, auth *AuthHandler) *EditorHandler {
	return &EditorHandler{
		db:          database,
		bunnyService: bunnyService,
		auth:        auth,
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
	if err := r.ParseMultipartForm(10 << 20); err != nil { // 10MB max
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

	// Generate unique filename
	filename := fmt.Sprintf("editor_%d_%d%s", userID, time.Now().Unix(), ext)

	// Upload to Bunny
	url, err := h.bunnyService.UploadMedia(filename, fileContent, mediaType)
	if err != nil {
		http.Error(w, "Failed to upload: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"url":      url,
		"filename": filename,
	})
}

// ProcessVideo handles POST /api/editor/video/{id}/process
func (h *EditorHandler) ProcessVideo(w http.ResponseWriter, r *http.Request) {
	userID, err := h.auth.GetSessionUser(w, r)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Extract video ID from URL
	videoIDStr := r.URL.Path[len("/api/editor/video/"):]
	videoIDStr = videoIDStr[:len(videoIDStr)-len("/process")]
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
	videoIDStr := r.URL.Path[len("/api/editor/video/"):]
	videoID, err := strconv.ParseUint(videoIDStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid video ID", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var video struct {
		UserID           uint64         `db:"user_id"`
		BunnyVideoURL    string         `db:"bunny_video_url"`
		BunnyVideoID     string         `db:"bunny_video_id"`
		DownloadURL      string         `db:"download_url"`
		TranscribedText  string         `db:"transcribed_text"`
		OutputLanguage   string         `db:"output_language"`
	}
	err = h.db.Get(&video, `
		SELECT user_id, IFNULL(bunny_video_url, '') as bunny_video_url,
		       IFNULL(bunny_video_id, '') as bunny_video_id,
		       IFNULL(download_url, '') as download_url,
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

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":                videoID,
		"download_url":      downloadURL,
		"transcribed_text":  video.TranscribedText,
		"output_language":   video.OutputLanguage,
	})
}
