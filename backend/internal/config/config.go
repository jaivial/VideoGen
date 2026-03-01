package config

import (
	"os"
	"path/filepath"
	"sync"

	"github.com/joho/godotenv"
)

type Config struct {
	// Database
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string

	// JWT
	JWTSecret string

	// APIs
	WavespeedAPIKey  string
	OpenRouterAPIKey string
	BunnyStorageName string
	BunnyStoragePass string
	BunnyStorageHost string
	BunnyCDNHost     string // CDN hostname (e.g., jaimedigitalstudio.b-cdn.net)

	// SMTP
	SMTPHost string
	SMTPPort string
	SMTPUser string
	SMTPPass string
	SMTPFrom string
}

var dotenvOnce sync.Once

func Load() *Config {
	dotenvOnce.Do(loadDotEnv)

	return &Config{
		DBHost:           getEnvFirst([]string{"DB_HOST", "MYSQL_HOST"}, "localhost"),
		DBPort:           getEnvFirst([]string{"DB_PORT", "MYSQL_PORT"}, "3306"),
		DBUser:           getEnvFirst([]string{"DB_USER", "MYSQL_USER"}, "video_user"),
		DBPassword:       getEnvFirst([]string{"DB_PASSWORD", "MYSQL_PASSWORD"}, "video_pass"),
		DBName:           getEnvFirst([]string{"DB_NAME", "MYSQL_DATABASE"}, "video_generator"),
		JWTSecret:        getEnv("JWT_SECRET", "change-me-in-production"),
		WavespeedAPIKey:  getEnv("WAVESPEED_API_KEY", ""),
		OpenRouterAPIKey: getEnv("OPENROUTER_API_KEY", ""),
		BunnyStorageName: getEnv("BUNNY_STORAGE_NAME", ""),
		BunnyStoragePass: getEnv("BUNNY_STORAGE_PASSWORD", ""),
		BunnyStorageHost: getEnv("BUNNY_STORAGE_HOST", ""),
		BunnyCDNHost:     getEnv("BUNNY_CDN_HOST", ""), // Will be derived from storage name if empty
		SMTPHost:         getEnv("SMTP_HOST", ""),
		SMTPPort:         getEnv("SMTP_PORT", "587"),
		SMTPUser:         getEnv("SMTP_USER", ""),
		SMTPPass:         getEnv("SMTP_PASS", ""),
		SMTPFrom:         getEnv("SMTP_FROM", "noreply@localhost"),
	}
}

func loadDotEnv() {
	// Prefer a local .env (current working directory). When running `go run` from
	// `./backend`, also fall back to the project root.
	_ = godotenv.Load()

	if wd, err := os.Getwd(); err == nil {
		_ = godotenv.Load(filepath.Join(wd, "..", ".env"))
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvFirst(keys []string, defaultValue string) string {
	for _, key := range keys {
		if value := os.Getenv(key); value != "" {
			return value
		}
	}
	return defaultValue
}
