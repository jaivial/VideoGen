package services

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"video-generator/internal/config"
)

type VideoProcessor struct {
	tempDir string
	cfg     *config.Config
}

type Chunk struct {
	ID        string `json:"id"`
	Text      string `json:"text"`
	StartTime float64 `json:"start_time"`
	EndTime   float64 `json:"end_time"`
	Duration  float64 `json:"duration"`
}

type CompositionInput struct {
	Chunks         []Chunk
	ImageGroups    []ImageGroup // Groups of chunks that share the same image
	Images         []string     // Individual images (one per chunk) - for backward compatibility
	Audios         [][]byte
	OutputLang     string
	CaptionSegments []CaptionSegment // Whisper caption segments for precise timing
}

func NewVideoProcessor(tempDir string, cfg *config.Config) *VideoProcessor {
	return &VideoProcessor{
		tempDir: tempDir,
		cfg:     cfg,
	}
}

func (vp *VideoProcessor) GenerateVideo(input CompositionInput) (string, error) {
	outputFile := filepath.Join(vp.tempDir, fmt.Sprintf("output_%d.mp4", time.Now().Unix()))

	// Create temp directory for chunks
	chunkDir := filepath.Join(vp.tempDir, "chunks")
	if err := os.MkdirAll(chunkDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create chunk dir: %w", err)
	}

	// Determine image paths for each chunk based on ImageGroups
	// If ImageGroups is provided, use it; otherwise fall back to individual Images
	var imagePaths []string
	if len(input.ImageGroups) > 0 && len(input.Images) > 0 {
		// Map chunks to their group's image
		for i := range input.Chunks {
			imgPath := GetImagePathForChunk(i, input.ImageGroups, input.Images)
			imagePaths = append(imagePaths, imgPath)
		}
	} else {
		// Fallback: use individual images
		imagePaths = input.Images
	}

	// Determine if we should use caption-based timing
	useCaptionTiming := len(input.CaptionSegments) > 0 && len(input.Chunks) > 0

	var segmentFiles []string

	if useCaptionTiming {
		// Use Whisper caption segments for precise timing
		// Each caption segment becomes a video segment with its own timing
		segmentFiles, err := vp.generateCaptionBasedVideo(input, chunkDir)
		if err != nil {
			return "", fmt.Errorf("failed to generate caption-based video: %w", err)
		}

		// Concatenate all segments
		if len(segmentFiles) == 1 {
			return segmentFiles[0], nil
		}

		return vp.concatenateSegments(segmentFiles, outputFile, chunkDir)
	}

	// Fallback: Use chunk-based timing (original behavior)
	for i, chunk := range input.Chunks {
		chunkFile := filepath.Join(chunkDir, fmt.Sprintf("segment_%d.mp4", i))

		// Get image path for this chunk
		imgPath := imagePaths[i]
		if imgPath == "" {
			// Generate placeholder if no image available
			imgPath = filepath.Join(vp.tempDir, "placeholder.png")
		}

		// Generate video for this chunk with kinetic captions
		if err := vp.generateChunkVideo(chunk, imgPath, input.Audios[i], chunkFile); err != nil {
			return "", fmt.Errorf("failed to generate chunk %d: %w", i, err)
		}

		segmentFiles = append(segmentFiles, chunkFile)
	}

	// Concatenate all segments
	if len(segmentFiles) == 1 {
		return segmentFiles[0], nil
	}

	return vp.concatenateSegments(segmentFiles, outputFile, chunkDir)
}

// generateCaptionBasedVideo generates video based on Whisper caption timestamps
// Creates a single video with caption overlays at precise timestamps
func (vp *VideoProcessor) generateCaptionBasedVideo(input CompositionInput, chunkDir string) ([]string, error) {
	captionSegments := input.CaptionSegments

	// Get the unified audio path
	audioPath := ""
	if len(input.Audios) > 0 && len(input.Audios[0]) > 100 && !strings.Contains(string(input.Audios[0]), "PLACEHOLDER") {
		audioPath = filepath.Join(vp.tempDir, "unified_audio.wav")
		if err := os.WriteFile(audioPath, input.Audios[0], 0644); err != nil {
			log.Printf("Warning: failed to write unified audio: %v", err)
			audioPath = ""
		}
	}

	// Determine image - use first image for now (can be enhanced to change based on timing)
	imagePath := ""
	if len(input.Images) > 0 {
		imagePath = input.Images[0]
	}
	if imagePath == "" {
		imagePath = filepath.Join(vp.tempDir, "placeholder.png")
	} else if _, err := os.Stat(imagePath); err != nil {
		imagePath = filepath.Join(vp.tempDir, "placeholder.png")
	}
	// Generate placeholder if needed
	if _, err := os.Stat(imagePath); os.IsNotExist(err) {
		genCmd := exec.Command("ffmpeg", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080:d=1", "-frames:v", "1", "-y", imagePath)
		if genOut, genErr := genCmd.CombinedOutput(); genErr != nil {
			return nil, fmt.Errorf("failed to generate placeholder: %w\noutput: %s", genErr, string(genOut))
		}
	}

	// Generate single video with caption timing overlays
	outputFile := filepath.Join(chunkDir, "caption_video.mp4")

	if err := vp.generateVideoWithCaptionTiming(imagePath, audioPath, captionSegments, outputFile); err != nil {
		return nil, fmt.Errorf("failed to generate video with caption timing: %w", err)
	}

	// Cleanup temp audio file
	if audioPath != "" {
		os.Remove(audioPath)
	}

	return []string{outputFile}, nil
}

// generateVideoWithCaptionTiming creates a video with multiple caption overlays at precise timestamps
func (vp *VideoProcessor) generateVideoWithCaptionTiming(imagePath, audioPath string, captionSegments []CaptionSegment, outputFile string) error {
	// Handle audio
	audioInputPath := audioPath
	if audioInputPath != "" {
		if _, err := os.Stat(audioInputPath); err != nil {
			audioInputPath = "" // File doesn't exist
		}
	}
	if audioInputPath == "" {
		// Generate silent audio as fallback
		silentPath := filepath.Join(vp.tempDir, "silent_audio.mp3")
		silentCmd := exec.Command("ffmpeg", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "10", "-y", silentPath)
		if silentOut, silentErr := silentCmd.CombinedOutput(); silentErr != nil {
			return fmt.Errorf("failed to generate silent audio: %w\noutput: %s", silentErr, string(silentOut))
		}
		audioInputPath = silentPath
		defer os.Remove(silentPath)
	}

	// Build complex filter for multiple caption overlays
	filterComplex := vp.buildCaptionTimingFilter(captionSegments)

	// FFmpeg command
	ffmpegCmd := exec.Command("ffmpeg",
		"-loop", "1",
		"-i", imagePath,
		"-i", audioInputPath,
		"-vf", fmt.Sprintf("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,%s", filterComplex),
		"-c:v", "libx264",
		"-preset", "fast",
		"-crf", "23",
		"-c:a", "aac",
		"-b:a", "128k",
		"-shortest",
		"-y",
		outputFile,
	)

	if output, err := ffmpegCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg failed: %w\noutput: %s", err, string(output))
	}

	return nil
}

// buildCaptionTimingFilter builds an FFmpeg filter for multiple caption overlays at precise times
func (vp *VideoProcessor) buildCaptionTimingFilter(captionSegments []CaptionSegment) string {
	config := DefaultKineticConfig()
	xPos, yPos := getPositionCoords(config.Position, config.YOffset)

	var drawtextFilters []string

	for _, caption := range captionSegments {
		text := escapeDrawtextText(caption.Text)
		startTime := caption.StartTime
		endTime := caption.EndTime

		if endTime <= startTime {
			endTime = startTime + 3.0 // Default 3 second display
		}

		// Calculate animation timing
		animIn := config.AnimationIn
		animOut := config.AnimationOut
		holdStart := startTime + animIn
		holdEnd := endTime - animOut

		// Build enable expression for this caption
		// Show caption between startTime and endTime with fade in/out
		enableExpr := fmt.Sprintf(
			"between(t,%f,%f)",
			startTime, endTime,
		)

		// Alpha expression for fade in/out within the display window
		alphaExpr := fmt.Sprintf(
			"if(lt(t,%f),0,if(lt(t,%f),%f/(t-%f),if(lt(t,%f),1,if(lt(t,%f),1-(t-%f)/%f,0))))",
			startTime + animIn,
			holdStart, animIn, startTime,
			holdEnd, endTime, holdEnd, animOut,
		)

		filter := fmt.Sprintf(
			"drawtext=fontfile='%s':text='%s':fontcolor=%s:fontsize=%d:borderw=%d:bordercolor=%s:x=%s:y=%s:enable='%s':alpha=%s",
			config.FontFile, text, config.FontColor, config.FontSize, config.BorderWidth, config.BorderColor,
			xPos, yPos, enableExpr, alphaExpr,
		)

		drawtextFilters = append(drawtextFilters, filter)
	}

	return strings.Join(drawtextFilters, ",")
}

// concatenateSegments concatenates multiple video segments into one
func (vp *VideoProcessor) concatenateSegments(segmentFiles []string, outputFile, chunkDir string) (string, error) {
	// Create concat file (FFmpeg concat demuxer requires "file " prefix)
	concatFile := filepath.Join(chunkDir, "concat.txt")
	var concatLines []string
	for _, f := range segmentFiles {
		concatLines = append(concatLines, "file '"+f+"'")
	}
	concatContent := strings.Join(concatLines, "\n")
	if err := os.WriteFile(concatFile, []byte(concatContent), 0644); err != nil {
		return "", fmt.Errorf("failed to write concat file: %w", err)
	}

	// Concatenate
	cmd := exec.Command("ffmpeg",
		"-f", "concat",
		"-safe", "0",
		"-i", concatFile,
		"-c", "copy",
		outputFile,
	)

	if output, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("ffmpeg concat failed: %w\noutput: %s", err, string(output))
	}

	return outputFile, nil
}

func (vp *VideoProcessor) generateChunkVideo(chunk Chunk, imagePath string, audioData []byte, outputFile string) error {
	// Check if image file exists, if not generate a placeholder
	if _, err := os.Stat(imagePath); os.IsNotExist(err) {
		log.Printf("Image not found at %s, generating placeholder", imagePath)
		placeholderPath := filepath.Join(vp.tempDir, "placeholder.png")
		if _, err := os.Stat(placeholderPath); os.IsNotExist(err) {
			// Create a simple solid color placeholder using ffmpeg
			genCmd := exec.Command("ffmpeg", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080:d=1", "-frames:v", "1", "-y", placeholderPath)
			if genOut, genErr := genCmd.CombinedOutput(); genErr != nil {
				return fmt.Errorf("failed to generate placeholder image: %w\noutput: %s", genErr, string(genOut))
			}
		}
		if err := copyFile(placeholderPath, imagePath); err != nil {
			return fmt.Errorf("failed to copy placeholder: %w", err)
		}
	}

	// Save audio - if placeholder or too small, generate silent audio
	audioPath := filepath.Join(vp.tempDir, "temp_audio.mp3")
	audioLen := len(audioData)
	if audioLen < 100 || strings.Contains(string(audioData), "PLACEHOLDER") {
		// Generate silent audio with duration matching chunk
		duration := chunk.Duration
		if duration <= 0 {
			duration = 5 // default 5 seconds
		}
		silentCmd := exec.Command("ffmpeg", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", fmt.Sprintf("%f", duration), "-y", audioPath)
		if silentOut, silentErr := silentCmd.CombinedOutput(); silentErr != nil {
			return fmt.Errorf("failed to generate silent audio: %w\noutput: %s", silentErr, string(silentOut))
		}
	} else {
		if err := os.WriteFile(audioPath, audioData, 0644); err != nil {
			return fmt.Errorf("failed to write audio: %w", err)
		}
	}

	// Generate video with kinetic captions
	config := DefaultKineticConfig()
	kineticFilter := GenerateSimpleKineticFilter(chunk, config)

	// FFmpeg command with kinetic captions (drawtext filter)
	// Use scale=1920:1080:force_original_aspect_ratio=increase to fill the screen (crop if needed)
	// Then use setsar=1 to ensure square pixels
	ffmpegCmd := exec.Command("ffmpeg",
		"-loop", "1",
		"-i", imagePath,
		"-i", audioPath,
		"-vf", fmt.Sprintf("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,%s", kineticFilter),
		"-c:v", "libx264",
		"-preset", "fast",
		"-crf", "23",
		"-c:a", "aac",
		"-b:a", "128k",
		"-shortest",
		"-y",
		outputFile,
	)

	if output, err := ffmpegCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg failed: %w\noutput: %s", err, string(output))
	}

	// Cleanup temp audio file (image path is managed by caller)
	os.Remove(audioPath)

	return nil
}

func (vp *VideoProcessor) createSubtitleFile(chunk Chunk, path string) error {
	startTime := formatSRTTime(chunk.StartTime)
	endTime := formatSRTTime(chunk.EndTime)

	content := fmt.Sprintf("1\n%s --> %s\n%s\n", startTime, endTime, chunk.Text)

	return os.WriteFile(path, []byte(content), 0644)
}

func formatSRTTime(seconds float64) string {
	h := int(seconds) / 3600
	m := (int(seconds) % 3600) / 60
	s := int(seconds) % 60
	ms := int((seconds - float64(int(seconds))) * 1000)
	return fmt.Sprintf("%02d:%02d:%02d,%03d", h, m, s, ms)
}

// ChunkText splits text into chunks of approximately maxTokens tokens
func (vp *VideoProcessor) ChunkText(text string, maxTokens int) ([]Chunk, error) {
	// Simple chunking by sentences and approximate token count
	// In production, use proper tokenization
	sentences := strings.Split(text, ". ")

	var chunks []Chunk
	var currentChunk strings.Builder
	var currentTokenCount int
	startTime := 0.0

	for i, sentence := range sentences {
		sentence = strings.TrimSpace(sentence)
		if sentence == "" {
			continue
		}

		// Approximate tokens (1 word ≈ 1.25 tokens)
		wordCount := len(strings.Fields(sentence))
		approxTokens := wordCount * 125 / 100

		if currentTokenCount+approxTokens > maxTokens && currentTokenCount > 0 {
			// Save current chunk
			text := currentChunk.String()
			if !strings.HasSuffix(text, ".") {
				text += "."
			}

			chunks = append(chunks, Chunk{
				ID:        fmt.Sprintf("chunk_%d", len(chunks)),
				Text:      text,
				StartTime: startTime,
				Duration:  float64(wordCount) / 2.5, // Approximate duration
			})

			startTime += float64(wordCount) / 2.5

			// Start new chunk
			currentChunk.Reset()
			currentChunk.WriteString(sentence)
			if i < len(sentences)-1 {
				currentChunk.WriteString(". ")
			}
			currentTokenCount = approxTokens
		} else {
			if currentChunk.Len() > 0 && i < len(sentences)-1 {
				currentChunk.WriteString(". ")
			}
			currentChunk.WriteString(sentence)
			currentTokenCount += approxTokens
		}
	}

	// Add final chunk
	if currentChunk.Len() > 0 {
		text := currentChunk.String()
		if !strings.HasSuffix(text, ".") {
			text += "."
		}
		chunks = append(chunks, Chunk{
			ID:        fmt.Sprintf("chunk_%d", len(chunks)),
			Text:      text,
			StartTime: startTime,
			Duration:  float64(currentTokenCount) * 0.8,
		})
	}

	// Set end times
	for i := range chunks {
		if i < len(chunks)-1 {
			chunks[i].EndTime = chunks[i+1].StartTime
		} else {
			chunks[i].EndTime = chunks[i].StartTime + chunks[i].Duration
		}
	}

	return chunks, nil
}

func ChunksToJSON(chunks []Chunk) (string, error) {
	data, err := json.Marshal(chunks)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func JSONToChunks(data string) ([]Chunk, error) {
	var chunks []Chunk
	err := json.Unmarshal([]byte(data), &chunks)
	return chunks, err
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0644)
}
