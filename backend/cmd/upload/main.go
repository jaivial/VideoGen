package main

import (
	"fmt"
	"log"
	"os"

	"github.com/joho/godotenv"
	"video-generator/internal/config"
	"video-generator/internal/services"
)

func main() {
	// Load .env
	godotenv.Load("/root/video-generator/.env")

	cfg := config.Load()
	bunny := services.NewBunnyService(cfg)

	// Read video file - use a NEW filename to avoid caching
	videoPath := "/tmp/video_generator/1772030750/processing/test_output.mp4"
	data, err := os.ReadFile(videoPath)
	if err != nil {
		log.Fatalf("Failed to read video: %v", err)
	}

	log.Printf("Video size: %d bytes", len(data))

	// Upload with NEW filename to avoid cache
	filename := fmt.Sprintf("test_%d_v2.mp4", 1772030750)
	url, err := bunny.UploadVideo(filename, data)
	if err != nil {
		log.Fatalf("Upload failed: %v", err)
	}

	log.Printf("Upload URL: %s", url)
}
