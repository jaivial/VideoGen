package config

import (
	"os"
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
	WavespeedAPIKey   string
	OpenRouterAPIKey  string
	BunnyStorageName  string
	BunnyStoragePass  string
	BunnyStorageHost  string
	BunnyCDNHost      string // CDN hostname (e.g., jaimedigitalstudio.b-cdn.net)

	// SMTP
	SMTPHost string
	SMTPPort string
	SMTPUser string
	SMTPPass string
	SMTPFrom string
}

func Load() *Config {
	return &Config{
		DBHost:            getEnv("DB_HOST", "localhost"),
		DBPort:            getEnv("DB_PORT", "3306"),
		DBUser:            getEnv("DB_USER", "video_user"),
		DBPassword:        getEnv("DB_PASSWORD", "video_pass"),
		DBName:            getEnv("DB_NAME", "video_generator"),
		JWTSecret:          getEnv("JWT_SECRET", "change-me-in-production"),
		WavespeedAPIKey:   getEnv("WAVESPEED_API_KEY", ""),
		OpenRouterAPIKey:  getEnv("OPENROUTER_API_KEY", ""),
		BunnyStorageName:  getEnv("BUNNY_STORAGE_NAME", ""),
		BunnyStoragePass:  getEnv("BUNNY_STORAGE_PASSWORD", ""),
		BunnyStorageHost:  getEnv("BUNNY_STORAGE_HOST", ""),
		BunnyCDNHost:     getEnv("BUNNY_CDN_HOST", ""), // Will be derived from storage name if empty
		SMTPHost:          getEnv("SMTP_HOST", ""),
		SMTPPort:          getEnv("SMTP_PORT", "587"),
		SMTPUser:          getEnv("SMTP_USER", ""),
		SMTPPass:          getEnv("SMTP_PASS", ""),
		SMTPFrom:          getEnv("SMTP_FROM", "noreply@localhost"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
