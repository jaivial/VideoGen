package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"video-generator/internal/db"
	"video-generator/internal/models"
	"video-generator/internal/services"
	"video-generator/internal/worker"
)

type VideoHandler struct {
	db            *db.DB
	videoWorker   *worker.VideoWorker
	auth          *AuthHandler
	ytService     *services.YouTubeService
}

func NewVideoHandler(database *db.DB, vw *worker.VideoWorker, auth *AuthHandler, ytService *services.YouTubeService) *VideoHandler {
	return &VideoHandler{
		db:          database,
		videoWorker: vw,
		auth:        auth,
		ytService:   ytService,
	}
}

func (h *VideoHandler) Generate(w http.ResponseWriter, r *http.Request) {
	userID, err := h.auth.GetSessionUser(w, r)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req models.VideoGenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate: either video_url or transcribed_text is required
	if req.VideoURL == "" && req.TranscribedText == "" {
		http.Error(w, "Either video_url or transcribed_text is required", http.StatusBadRequest)
		return
	}

	// Validate output_language is required
	if req.OutputLanguage == "" {
		http.Error(w, "output_language is required", http.StatusBadRequest)
		return
	}

	// If transcribed_text is provided, use it directly; otherwise validate video URL
	var videoURLID int64
	if req.TranscribedText != "" {
		// Insert video URL record with placeholder for transcribed text mode
		result, err := h.db.Exec(
			"INSERT INTO user_video_urls (user_id, video_url) VALUES (?, 'transcribed')",
			userID,
		)
		if err != nil {
			http.Error(w, "Failed to save video URL", http.StatusInternalServerError)
			return
		}
		videoURLID, _ = result.LastInsertId()
	} else {
		// Validate YouTube URL (basic check)
		if len(req.VideoURL) < 11 {
			http.Error(w, "Invalid YouTube URL", http.StatusBadRequest)
			return
		}

		// Insert video URL record
		result, err := h.db.Exec(
			"INSERT INTO user_video_urls (user_id, video_url) VALUES (?, ?)",
			userID, req.VideoURL,
		)
		if err != nil {
			http.Error(w, "Failed to save video URL", http.StatusInternalServerError)
			return
		}
		videoURLID, _ = result.LastInsertId()
	}

	// Insert video request with transcribed text if provided
	result, err := h.db.Exec(
		"INSERT INTO videos_requested (user_id, user_video_url_id, transcribed_text, output_language, phase_of_generation) VALUES (?, ?, ?, ?, 'pending')",
		userID, videoURLID, req.TranscribedText, req.OutputLanguage,
	)
	if err != nil {
		http.Error(w, "Failed to create video request", http.StatusInternalServerError)
		return
	}

	videoRequestID, _ := result.LastInsertId()

	// Start async worker with transcribed text
	go h.videoWorker.ProcessVideo(uint64(videoRequestID), userID, req.VideoURL, req.TranscribedText, req.OutputLanguage, req.Voice, req.StyleInstruction)

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":    "Video generation started",
		"request_id": videoRequestID,
	})
}

func (h *VideoHandler) Status(w http.ResponseWriter, r *http.Request) {
	userID, err := h.auth.GetSessionUser(w, r)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, "Video ID required", http.StatusBadRequest)
		return
	}

	videoID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid video ID", http.StatusBadRequest)
		return
	}

	// Get video request
	var video models.VideosRequested
	err = h.db.Get(&video, "SELECT * FROM videos_requested WHERE id = ? AND user_id = ?", videoID, userID)
	if err == sql.ErrNoRows {
		http.Error(w, "Video not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	response := models.VideoStatusResponse{
		ID:                video.ID,
		PhaseOfGeneration: video.PhaseOfGeneration,
		Downloaded:        video.Downloaded,
	}

	// Calculate progress based on phase
	response.Progress = getPhaseProgress(video.PhaseOfGeneration)

	// Get download URL if completed
	if video.PhaseOfGeneration == "completed" && video.BunnyVideoID.Valid {
		// Use bunny_video_url if available, otherwise fall back to bunny_video_id
		if video.BunnyVideoURL.Valid {
			response.DownloadURL = video.BunnyVideoURL.String
		} else {
			response.DownloadURL = video.BunnyVideoID.String
		}
		// Only return if not expired
		if video.DownloadExpiresAt.Valid && time.Now().Before(video.DownloadExpiresAt.Time) {
			response.DownloadExpiresAt = video.DownloadExpiresAt.Time.Format(time.RFC3339)
		}
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

func (h *VideoHandler) List(w http.ResponseWriter, r *http.Request) {
	userID, err := h.auth.GetSessionUser(w, r)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	type VideoListItem struct {
		ID                 uint64         `db:"id" json:"id"`
		PhaseOfGeneration string         `db:"phase_of_generation" json:"phase_of_generation"`
		OutputLanguage    string         `db:"output_language" json:"output_language"`
		Downloaded        bool           `db:"downloaded" json:"downloaded"`
		CreatedAt         time.Time      `db:"created_at" json:"created_at"`
		ErrorMessage      sql.NullString `db:"error_message" json:"error_message,omitempty"`
	}

	var videos []VideoListItem
	err = h.db.Select(&videos, "SELECT id, phase_of_generation, output_language, downloaded, created_at, IFNULL(error_message, '') as error_message FROM videos_requested WHERE user_id = ? ORDER BY created_at DESC", userID)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(videos)
}

func (h *VideoHandler) MarkDownloaded(w http.ResponseWriter, r *http.Request) {
	userID, err := h.auth.GetSessionUser(w, r)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		http.Error(w, "Video ID required", http.StatusBadRequest)
		return
	}

	videoID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid video ID", http.StatusBadRequest)
		return
	}

	// Verify ownership
	var video models.VideosRequested
	err = h.db.Get(&video, "SELECT * FROM videos_requested WHERE id = ? AND user_id = ?", videoID, userID)
	if err == sql.ErrNoRows {
		http.Error(w, "Video not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}

	// Mark as downloaded
	_, err = h.db.Exec("UPDATE videos_requested SET downloaded = TRUE WHERE id = ?", videoID)
	if err != nil {
		http.Error(w, "Failed to update", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Marked as downloaded"})
}

func getPhaseProgress(phase string) int {
	switch phase {
	case "pending":
		return 0
	case "transcribing":
		return 10
	case "chunking":
		return 20
	case "translating":
		return 35
	case "generating_assets":
		return 50
	case "composing":
		return 75
	case "uploading":
		return 90
	case "completed":
		return 100
	case "error":
		return 0
	default:
		return 0
	}
}

// Language list for frontend - Qwen3 TTS supported languages
var SupportedLanguages = []map[string]string{
	{"code": "auto", "name": "Auto Detect"},
	{"code": "en", "name": "English"},
	{"code": "zh", "name": "Chinese"},
	{"code": "de", "name": "German"},
	{"code": "it", "name": "Italian"},
	{"code": "pt", "name": "Portuguese"},
	{"code": "es", "name": "Spanish"},
	{"code": "ja", "name": "Japanese"},
	{"code": "ko", "name": "Korean"},
	{"code": "fr", "name": "French"},
	{"code": "ru", "name": "Russian"},
}

func (h *VideoHandler) GetLanguages(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(SupportedLanguages)
}

// TranscriptRequest represents the request body for getting transcript
type TranscriptRequest struct {
	VideoURL string `json:"video_url"`
	Language string `json:"language"`
}

// TranscriptResponse represents the response for transcript endpoint
type TranscriptResponse struct {
	VideoID    string                       `json:"video_id"`
	Language   string                       `json:"language"`
	Kind       string                       `json:"kind"`
	PlainText  string                       `json:"plain_text"`
	Entries    []services.TranscriptEntry  `json:"entries"`
	Available  []map[string]string         `json:"available_languages,omitempty"`
}

// GetTranscript handles GET /api/video/transcript
func (h *VideoHandler) GetTranscript(w http.ResponseWriter, r *http.Request) {
	videoURL := r.URL.Query().Get("video_url")
	if videoURL == "" {
		http.Error(w, "video_url is required", http.StatusBadRequest)
		return
	}

	lang := r.URL.Query().Get("lang")

	// First, get available languages
	available, err := h.ytService.GetAvailableLanguages(videoURL)
	if err != nil {
		http.Error(w, "Failed to get transcript: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Get the transcript
	transcript, err := h.ytService.GetTranscript(videoURL, lang)
	if err != nil {
		http.Error(w, "Failed to get transcript: "+err.Error(), http.StatusBadRequest)
		return
	}

	response := TranscriptResponse{
		VideoID:   transcript.VideoID,
		Language:  transcript.Language,
		Kind:      transcript.Kind,
		PlainText: transcript.PlainText,
		Entries:   transcript.Entries,
		Available: available,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetAvailableTranscriptLanguages handles GET /api/video/transcript/languages
func (h *VideoHandler) GetAvailableTranscriptLanguages(w http.ResponseWriter, r *http.Request) {
	videoURL := r.URL.Query().Get("video_url")
	if videoURL == "" {
		http.Error(w, "video_url is required", http.StatusBadRequest)
		return
	}

	available, err := h.ytService.GetAvailableLanguages(videoURL)
	if err != nil {
		http.Error(w, "Failed to get available languages: "+err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"languages": available,
	})
}
