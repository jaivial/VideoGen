package models

import (
	"database/sql"
	"time"
)

type User struct {
	ID           uint64         `db:"id" json:"id"`
	Name         string         `db:"name" json:"name"`
	Email        string         `db:"email" json:"email"`
	PasswordHash string         `db:"password_hash" json:"-"`
	CreatedAt    time.Time      `db:"created_at" json:"created_at"`
	UpdatedAt    time.Time      `db:"updated_at" json:"updated_at"`
}

type UserVerified struct {
	ID             uint64 `db:"id" json:"id"`
	UserID         uint64 `db:"user_id" json:"user_id"`
	VerifiedState  bool   `db:"verified_state" json:"verified_state"`
}

type EmailVerification struct {
	ID                    uint64    `db:"id" json:"id"`
	UserID                uint64    `db:"user_id" json:"user_id"`
	Token                 string    `db:"token" json:"token"`
	TokenExpirationDate   time.Time `db:"token_expiration_date" json:"token_expiration_date"`
	TokenCreationDate     time.Time `db:"token_creation_date" json:"token_creation_date"`
	TokenUsed             bool      `db:"token_used" json:"token_used"`
}

type UserSession struct {
	ID             uint64    `db:"id" json:"id"`
	UserID         uint64    `db:"user_id" json:"user_id"`
	SessionID      string    `db:"session_id" json:"session_id"`
	ExpirationDate time.Time `db:"expiration_date" json:"expiration_date"`
	CreationDate   time.Time `db:"creation_date" json:"creation_date"`
}

type UserVideoURL struct {
	ID        uint64    `db:"id" json:"id"`
	UserID    uint64    `db:"user_id" json:"user_id"`
	VideoURL  string    `db:"video_url" json:"video_url"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

type VideosRequested struct {
	ID                 uint64         `db:"id" json:"id"`
	UserID             uint64         `db:"user_id" json:"user_id"`
	UserVideoURLID     uint64         `db:"user_video_url_id" json:"user_video_url_id"`
	TranscribedText    sql.NullString `db:"transcribed_text" json:"transcribed_text"`
	IsGenerating       bool           `db:"is_generating" json:"is_generating"`
	PhaseOfGeneration string         `db:"phase_of_generation" json:"phase_of_generation"`
	ErrorMessage       sql.NullString `db:"error_message" json:"error_message,omitempty"`
	OutputLanguage     string         `db:"output_language" json:"output_language"`
	BunnyVideoID       sql.NullString `db:"bunny_video_id" json:"bunny_video_id"`
	BunnyVideoURL     sql.NullString `db:"bunny_video_url" json:"bunny_video_url"`
	DownloadExpiresAt  sql.NullTime    `db:"download_expires_at" json:"download_expires_at"`
	Downloaded         bool            `db:"downloaded" json:"downloaded"`
	CreatedAt          time.Time       `db:"created_at" json:"created_at"`
}

type TextTranslation struct {
	ID                uint64         `db:"id" json:"id"`
	UserID            uint64         `db:"user_id" json:"user_id"`
	VideoRequestedID  uint64         `db:"video_requested_id" json:"video_requested_id"`
	IsGenerating      bool           `db:"is_generating" json:"is_generating"`
	TextsToTranslate  sql.NullString `db:"texts_to_translate" json:"texts_to_translate"`
	TextsTranslated   sql.NullString `db:"texts_translated" json:"texts_translated"`
	LanguageInput     string         `db:"language_input" json:"language_input"`
	LanguageOutput    string         `db:"language_output" json:"language_output"`
	CreatedAt         time.Time      `db:"created_at" json:"created_at"`
}

type ImagesGenerated struct {
	ID               uint64         `db:"id" json:"id"`
	UserID           uint64         `db:"user_id" json:"user_id"`
	VideoRequestedID uint64         `db:"video_requested_id" json:"video_requested_id"`
	IsGenerating     bool           `db:"is_generating" json:"is_generating"`
	ImageURLs        sql.NullString `db:"image_urls" json:"image_urls"`
	ChunkIDs         sql.NullString `db:"chunk_ids" json:"chunk_ids"`
	CreatedAt        time.Time      `db:"created_at" json:"created_at"`
}

type VideoEditionComposition struct {
	ID                    uint64         `db:"id" json:"id"`
	UserID                uint64         `db:"user_id" json:"user_id"`
	VideoRequestedID      uint64         `db:"video_requested_id" json:"video_requested_id"`
	IsGenerating          bool           `db:"is_generating" json:"is_generating"`
	VideoFullGeneratedURL sql.NullString `db:"video_full_generated_url" json:"video_full_generated_url"`
	CreatedAt             time.Time      `db:"created_at" json:"created_at"`
}

type VideoTranscription struct {
	ID                uint64         `db:"id" json:"id"`
	UserID            uint64         `db:"user_id" json:"user_id"`
	VideoRequestedID  uint64         `db:"video_requested_id" json:"video_requested_id"`
	IsGenerating      bool           `db:"is_generating" json:"is_generating"`
	TranscriptionText sql.NullString `db:"transcription_text" json:"transcription_text"`
	Chunks            sql.NullString `db:"chunks" json:"chunks"`
	DetectedLanguage  string         `db:"detected_language" json:"detected_language"`
	CreatedAt         time.Time      `db:"created_at" json:"created_at"`
}

// Request/Response types
type RegisterRequest struct {
	Name     string `json:"name" validate:"required,min=2,max=100"`
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=8"`
}

type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
}

type VideoGenerateRequest struct {
	VideoURL         string `json:"video_url"`
	TranscribedText  string `json:"transcribed_text"`
	OutputLanguage   string `json:"output_language" validate:"required"`
	Voice            string `json:"voice"`
	StyleInstruction string `json:"style_instruction"`
}

type VideoStatusResponse struct {
	ID                 uint64 `json:"id"`
	PhaseOfGeneration string `json:"phase_of_generation"`
	Progress          int    `json:"progress"`
	DownloadURL       string `json:"download_url,omitempty"`
	Downloaded        bool   `json:"downloaded"`
	DownloadExpiresAt string `json:"download_expires_at,omitempty"`
	Error             string `json:"error,omitempty"`
}
