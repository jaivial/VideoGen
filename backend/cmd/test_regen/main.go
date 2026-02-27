package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/joho/godotenv"
	"video-generator/internal/config"
	"video-generator/internal/services"
)

func main() {
	// Load .env
	godotenv.Load("/root/video-generator/.env")

	videoID := 1772030750
	tempDir := "/tmp/video_generator"

	// Read caption info
	captionInfoPath := filepath.Join(tempDir, fmt.Sprintf("%d", videoID), "caption_info.json")
	data, err := os.ReadFile(captionInfoPath)
	if err != nil {
		log.Fatalf("Failed to read: %v", err)
	}

	type CaptionSegment struct {
		Text      string  `json:"text"`
		StartTime float64 `json:"start"`
		EndTime   float64 `json:"end"`
	}
	type Info struct {
		CaptionSegments []CaptionSegment `json:"captionSegments"`
	}
	var info Info
	if err := json.Unmarshal(data, &info); err != nil {
		log.Fatalf("Failed to parse: %v", err)
	}

	// Convert to services.CaptionSegment
	segments := make([]services.CaptionSegment, len(info.CaptionSegments))
	for i, s := range info.CaptionSegments {
		segments[i] = services.CaptionSegment{
			Text:      s.Text,
			StartTime: s.StartTime,
			EndTime:   s.EndTime,
		}
	}

	kineticConfig := services.DefaultKineticConfig()
	log.Printf("Font size: %d", kineticConfig.FontSize)

	assPath := filepath.Join(tempDir, fmt.Sprintf("%d", videoID), "processing", "captions.ass")
	if err := services.GenerateASSFile(segments, kineticConfig, assPath, 1920, 1080); err != nil {
		log.Fatalf("Failed to generate ASS: %v", err)
	}

	log.Printf("Generated: %s", assPath)

	// Now generate video
	videoDir := filepath.Join(tempDir, fmt.Sprintf("%d", videoID))
	imagePath := filepath.Join(videoDir, "images", "1772030750_group_0-0.jpg")
	audioPath := filepath.Join(videoDir, "audios", "1772030750_unified.wav")
	outputPath := filepath.Join(videoDir, "processing", "test_output_v3.mp4")

	cmd := exec.Command("ffmpeg",
		"-loop", "1",
		"-i", imagePath,
		"-i", audioPath,
		"-vf", fmt.Sprintf("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,ass='%s'", assPath),
		"-c:v", "libx264",
		"-preset", "fast",
		"-crf", "23",
		"-c:a", "aac",
		"-b:a", "128k",
		"-shortest",
		"-y",
		outputPath,
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		log.Fatalf("FFmpeg failed: %v", err)
	}

	log.Printf("Video generated: %s", outputPath)

	// Upload to Bunny CDN
	appCfg := config.Load()
	bunny := services.NewBunnyService(appCfg)

	videoData, err := os.ReadFile(outputPath)
	if err != nil {
		log.Fatalf("Failed to read video: %v", err)
	}

	log.Printf("Video size: %d bytes", len(videoData))

	// Upload with NEW filename
	filename := fmt.Sprintf("test_%d_v3.mp4", videoID)
	url, err := bunny.UploadVideo(filename, videoData)
	if err != nil {
		log.Fatalf("Upload failed: %v", err)
	}

	log.Printf("Upload URL: %s", url)
}
