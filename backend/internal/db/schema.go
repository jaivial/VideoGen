package db

import (
	"fmt"
	"time"

	mysql "github.com/go-sql-driver/mysql"
	"github.com/jmoiron/sqlx"
)

var Schema = `
CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users_verified (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED UNIQUE NOT NULL,
    verified_state BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_verification (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    token_expiration_date TIMESTAMP NOT NULL,
    token_creation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    token_used BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_session (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    session_id VARCHAR(255) UNIQUE NOT NULL,
    expiration_date TIMESTAMP NOT NULL,
    creation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_video_urls (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    video_url VARCHAR(512) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS videos_requested (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    user_video_url_id BIGINT UNSIGNED NOT NULL,
    transcribed_text TEXT,
    is_generating BOOLEAN DEFAULT FALSE,
    phase_of_generation VARCHAR(50) DEFAULT 'pending',
    error_message TEXT,
    output_language VARCHAR(10) NOT NULL,
    bunny_video_id VARCHAR(255),
    bunny_video_url VARCHAR(512),
    bunny_audio_url VARCHAR(512),
    editor_caption_segments LONGTEXT,
    editor_audio_segments LONGTEXT,
    editor_image_segments LONGTEXT,
    download_expires_at TIMESTAMP,
    downloaded BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_video_url_id) REFERENCES user_video_urls(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS text_translation (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    video_requested_id BIGINT UNSIGNED NOT NULL,
    is_generating BOOLEAN DEFAULT FALSE,
    texts_to_translate JSON,
    texts_translated JSON,
    language_input VARCHAR(10),
    language_output VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (video_requested_id) REFERENCES videos_requested(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS images_generated (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    video_requested_id BIGINT UNSIGNED NOT NULL,
    is_generating BOOLEAN DEFAULT FALSE,
    image_urls JSON,
    chunk_ids JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (video_requested_id) REFERENCES videos_requested(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_edition_composition (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    video_requested_id BIGINT UNSIGNED NOT NULL,
    is_generating BOOLEAN DEFAULT FALSE,
    video_full_generated_url VARCHAR(512),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (video_requested_id) REFERENCES videos_requested(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_transcription (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    video_requested_id BIGINT UNSIGNED NOT NULL,
    is_generating BOOLEAN DEFAULT FALSE,
    transcription_text TEXT,
    chunks JSON,
    detected_language VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (video_requested_id) REFERENCES videos_requested(id) ON DELETE CASCADE
);
`

type DB struct {
	*sqlx.DB
}

func NewConnection(host, port, user, password, dbname string) (*DB, error) {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&multiStatements=true", user, password, host, port, dbname)

	db, err := sqlx.Connect("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	// Initialize schema
	if _, err := db.Exec(Schema); err != nil {
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	// Backward-compatible migration for existing databases created before
	// newer columns were added to videos_requested.
	if err := ensureVideosRequestedColumns(db); err != nil {
		return nil, fmt.Errorf("failed to migrate videos_requested columns: %w", err)
	}

	return &DB{db}, nil
}

func ensureVideosRequestedColumns(db *sqlx.DB) error {
	type columnSpec struct {
		name       string
		definition string
	}

	required := []columnSpec{
		{name: "error_message", definition: "TEXT NULL"},
		{name: "bunny_video_url", definition: "VARCHAR(512) NULL"},
		{name: "bunny_audio_url", definition: "VARCHAR(512) NULL"},
		{name: "editor_caption_segments", definition: "LONGTEXT NULL"},
		{name: "editor_audio_segments", definition: "LONGTEXT NULL"},
		{name: "editor_image_segments", definition: "LONGTEXT NULL"},
	}

	for _, column := range required {
		var exists int
		err := db.Get(&exists, `
			SELECT COUNT(*)
			FROM information_schema.columns
			WHERE table_schema = DATABASE()
			  AND table_name = 'videos_requested'
			  AND column_name = ?`,
			column.name,
		)
		if err != nil {
			return err
		}
		if exists > 0 {
			continue
		}

		statement := fmt.Sprintf("ALTER TABLE videos_requested ADD COLUMN %s %s", column.name, column.definition)
		if _, err := db.Exec(statement); err != nil {
			// If another process added the column concurrently, ignore.
			if mysqlErr, ok := err.(*mysql.MySQLError); ok && mysqlErr.Number == 1060 {
				continue
			}
			return err
		}
	}

	return nil
}
