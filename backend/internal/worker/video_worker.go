package worker

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"video-generator/internal/config"
	"video-generator/internal/db"
	"video-generator/internal/services"
)

// Broadcaster interface for WebSocket notifications
type Broadcaster interface {
	BroadcastPhase(videoID uint64, phase string, progress int, message string)
	BroadcastStep(videoID uint64, phase, step string, progress int, message string)
	BroadcastError(videoID uint64, phase, step, errorMsg string)
	BroadcastComplete(videoID uint64, downloadURL string)
}

type VideoWorker struct {
	db              *db.DB
	ytService       *services.YouTubeService
	waveSpeed       *services.WaveSpeedService
	openRouter      *services.OpenRouterService
	bunny           *services.BunnyService
	videoProcessor  *services.VideoProcessor
	broadcaster     Broadcaster
	tempDir         string
	cfg             *config.Config
}

func NewVideoWorker(
	database *db.DB,
	yt *services.YouTubeService,
	ws *services.WaveSpeedService,
	or *services.OpenRouterService,
	bunny *services.BunnyService,
	vp *services.VideoProcessor,
	broadcaster Broadcaster,
	tempDir string,
	cfg *config.Config,
) *VideoWorker {
	return &VideoWorker{
		db:             database,
		ytService:      yt,
		waveSpeed:      ws,
		openRouter:     or,
		bunny:          bunny,
		videoProcessor: vp,
		broadcaster:    broadcaster,
		tempDir:        tempDir,
		cfg:            cfg,
	}
}

func (w *VideoWorker) ProcessVideo(videoRequestID, userID uint64, videoURL, transcribedText, outputLang string) {
	log.Printf("Starting video processing for request %d", videoRequestID)

	// Create directories for this video
	videoDir := filepath.Join(w.tempDir, fmt.Sprintf("%d", videoRequestID))
	textsDir := filepath.Join(videoDir, "texts")
	audiosDir := filepath.Join(videoDir, "audios")

	if err := os.MkdirAll(textsDir, 0755); err != nil {
		w.handleError(videoRequestID, "setup", "create_dirs", fmt.Sprintf("Failed to create texts directory: %v", err))
		return
	}
	if err := os.MkdirAll(audiosDir, 0755); err != nil {
		w.handleError(videoRequestID, "setup", "create_dirs", fmt.Sprintf("Failed to create audios directory: %v", err))
		return
	}

	var transcriptionText string
	var segments []services.TranscriptSegment
	var chunks []services.Chunk

	// Phase 1: Get transcript - either from pasted text or from YouTube
	if transcribedText != "" {
		// User provided transcribed text directly - skip transcript API
		w.updatePhase(videoRequestID, "chunking")
		w.broadcastStep(videoRequestID, "chunking", "chunking_start", 10, "Processing transcribed text")

		// Parse the transcript (detects YouTube format or plain text)
		var err error
		segments, err = services.ParseTranscript(transcribedText)
		if err != nil {
			w.handleError(videoRequestID, "chunking", "parse_transcript", fmt.Sprintf("Failed to parse transcript: %v", err))
			return
		}

		w.broadcastStep(videoRequestID, "chunking", "chunking_parse", 15, "Parsing transcript text")

		// If parsing didn't yield segments, fall back to treating entire text as one segment
		if len(segments) == 0 {
			segments = []services.TranscriptSegment{
				{
					Index:        0,
					OriginalText: transcribedText,
				},
			}
			transcriptionText = transcribedText
		} else {
			// Build full text from segments
			var sb strings.Builder
			for _, seg := range segments {
				sb.WriteString(seg.OriginalText)
				sb.WriteString(" ")
			}
			transcriptionText = strings.TrimSpace(sb.String())
		}

		w.broadcastStep(videoRequestID, "chunking", "chunking_complete", 20, fmt.Sprintf("Created %d segments", len(segments)))
	} else {
		// Fetch transcript from YouTube
		w.updatePhase(videoRequestID, "transcribing")
		w.broadcastStep(videoRequestID, "transcribing", "transcribing_start", 5, "Starting transcription")

		transcript, err := w.ytService.GetTranscript(videoURL, "en")
		if err != nil {
			w.handleError(videoRequestID, "transcribing", "transcribing_youtube", fmt.Sprintf("Failed to get transcript: %v", err))
			return
		}

		w.broadcastStep(videoRequestID, "transcribing", "transcribing_youtube", 8, "Downloading transcript from YouTube")

		// Use the plain text from transcript
		transcriptionText = transcript.PlainText

		// Convert transcript entries to segments for parallel processing
		for i, entry := range transcript.Entries {
			startTime, _ := strconv.ParseFloat(entry.Start, 64)
			endTime, _ := strconv.ParseFloat(entry.End, 64)
			segments = append(segments, services.TranscriptSegment{
				Index:        i,
				OriginalText: entry.Text,
				StartTime:    startTime,
				Duration:     endTime - startTime,
			})
		}

		w.broadcastStep(videoRequestID, "transcribing", "transcribing_complete", 10, "Transcription complete")
	}

	// Phase 2: Download audio for voiceover (if video URL is available)
	var audioPath string
	if videoURL != "" && transcribedText == "" {
		// Only download audio if we have a video URL and user didn't paste transcript
		var err error
		audioPath, err = w.ytService.DownloadAudio(videoURL)
		if err != nil {
			w.handleError(videoRequestID, "transcribing", "transcribing_audio", fmt.Sprintf("Failed to download audio: %v", err))
			return
		}
		defer os.Remove(audioPath)
	}

	// Save transcription
	// Convert segments to chunks for storage
	chunksForDB := make([]services.Chunk, len(segments))
	for i, seg := range segments {
		chunksForDB[i] = services.Chunk{
			ID:        fmt.Sprintf("chunk_%d", i),
			Text:      seg.OriginalText,
			StartTime: seg.StartTime,
			Duration:  seg.Duration,
		}
	}

	chunksJSON, err := services.ChunksToJSON(chunksForDB)
	if err != nil {
		w.handleError(videoRequestID, "transcribing", "transcribing_save", fmt.Sprintf("Failed to chunk text: %v", err))
		return
	}

	_, err = w.db.Exec(`
		INSERT INTO video_transcription
		(user_id, video_requested_id, is_generating, transcription_text, chunks, detected_language)
		VALUES (?, ?, FALSE, ?, ?, 'en')
	`, userID, videoRequestID, transcriptionText, chunksJSON)
	if err != nil {
		w.handleError(videoRequestID, "transcribing", "transcribing_save", fmt.Sprintf("Failed to save transcription: %v", err))
		return
	}

	// Skip re-chunking phase - use parsed segments directly
	w.broadcastStep(videoRequestID, "chunking", "chunking_complete", 30, fmt.Sprintf("Using %d segments", len(segments)))

	// Phase 4: Translation - UNIFIED
	w.updatePhase(videoRequestID, "translating")
	w.broadcastStep(videoRequestID, "translating", "translating_start", 30, "Translating unified text")

	// Generate unified text from original segments (before translation)
	unifiedText := services.GenerateUnifiedTranscriptText(segments)
	if len(unifiedText) == 0 {
		w.handleError(videoRequestID, "translating", "translating_unified", "No text to translate")
		return
	}

	// Translate the unified text as ONE piece (better context and coherence)
	translatedText, err := w.openRouter.TranslateUnifiedText(unifiedText, "en", outputLang)
	if err != nil {
		w.handleError(videoRequestID, "translating", "translating_unified", fmt.Sprintf("Failed to translate: %v", err))
		return
	}

	// Store translated text in each segment for image prompts
	for i := range segments {
		segments[i].TranslatedText = translatedText
	}

	w.broadcastStep(videoRequestID, "translating", "translating_unified", 45, "Unified translation complete")

	// Save translated texts to files
	originalTexts := make([]string, len(segments))
	translatedTexts := make([]string, len(segments))
	for i, seg := range segments {
		originalTexts[i] = seg.OriginalText
		translatedTexts[i] = seg.TranslatedText

		// Save translated text to file
		textPath := filepath.Join(textsDir, fmt.Sprintf("chunk_%d.txt", i))
		if err := os.WriteFile(textPath, []byte(seg.TranslatedText), 0644); err != nil {
			w.handleError(videoRequestID, "translating", "save_text", fmt.Sprintf("Failed to save translated text: %v", err))
			return
		}
	}

	// Save translations to database
	translatedJSON, _ := json.Marshal(translatedTexts)
	originalJSON, _ := json.Marshal(originalTexts)

	_, err = w.db.Exec(`
		INSERT INTO text_translation
		(user_id, video_requested_id, is_generating, texts_to_translate, texts_translated, language_input, language_output)
		VALUES (?, ?, FALSE, ?, ?, 'en', ?)
	`, userID, videoRequestID, string(originalJSON), string(translatedJSON), outputLang)
	if err != nil {
		w.handleError(videoRequestID, "translating", "translating_save", fmt.Sprintf("Failed to save translations: %v", err))
		return
	}

	w.broadcastStep(videoRequestID, "translating", "translating_save", 45, "Translations saved")
	w.broadcastStep(videoRequestID, "translating", "translating_complete", 50, "Translation complete")

	// Phase 5: Generate assets (images + audio)
	w.updatePhase(videoRequestID, "generating_assets")
	w.broadcastStep(videoRequestID, "generating_assets", "assets_start", 50, "Generating images and voiceover")

	// Convert segments to chunks for image generation
	chunks = make([]services.Chunk, len(segments))
	for i, seg := range segments {
		chunks[i] = services.Chunk{
			ID:        fmt.Sprintf("chunk_%d", i),
			Text:      seg.TranslatedText,
			StartTime: seg.StartTime,
			Duration:  seg.Duration,
		}
	}

	// Create images directory
	imagesDir := filepath.Join(videoDir, "images")
	if err := os.MkdirAll(imagesDir, 0755); err != nil {
		w.handleError(videoRequestID, "generating_assets", "create_images_dir", fmt.Sprintf("Failed to create images directory: %v", err))
		return
	}

	// Create image groups (groups of 10 chunks per image)
	imageGroups := services.CreateImageGroups(segments, 10)
	w.broadcastStep(videoRequestID, "generating_assets", "assets_images", 52, fmt.Sprintf("Created %d image groups from %d chunks", len(imageGroups), len(segments)))

	// Run image generation and unified audio generation in parallel
	var wg sync.WaitGroup
	var imageGenErr, audioGenErr error

	// Narrator voice description
	// Use consistent voice profile for deterministic TTS output
	narratorVoice := services.ConsistentVoice

	// Parallel image generation
	wg.Add(1)
	go func() {
		defer wg.Done()
		w.broadcastStep(videoRequestID, "generating_assets", "generating_images", 55, "Generating images in parallel")
		imageGroups, imageGenErr = w.waveSpeed.GenerateImagesParallel(imageGroups, videoDir, w.broadcaster, videoRequestID)
	}()

	// Unified audio generation (single TTS call)
	wg.Add(1)
	go func() {
		defer wg.Done()
		w.broadcastStep(videoRequestID, "generating_assets", "assets_audio", 55, "Generating unified audio")

		// Step 1: Generate unified text from all segments
		unifiedText := services.GenerateUnifiedTranscriptText(segments)
		if len(unifiedText) == 0 {
			audioGenErr = fmt.Errorf("no text to generate audio from")
			return
		}

		// Step 2: Generate single audio from unified text
		audioURL, err := w.waveSpeed.GenerateUnifiedSpeech(unifiedText, narratorVoice)
		if err != nil {
			audioGenErr = fmt.Errorf("failed to generate unified speech: %w", err)
			return
		}

		// Step 3: Download audio to file
		audioData, err := w.waveSpeed.DownloadAudio(audioURL)
		if err != nil {
			audioGenErr = fmt.Errorf("failed to download audio: %w", err)
			return
		}

		audioPath := filepath.Join(audiosDir, "unified.wav")
		if err := os.WriteFile(audioPath, audioData, 0644); err != nil {
			audioGenErr = fmt.Errorf("failed to save unified audio: %w", err)
			return
		}

		// Step 4: Get actual audio duration using FFprobe
		audioDuration, err := w.waveSpeed.GetAudioDuration(audioPath)
		if err != nil {
			log.Printf("Warning: failed to get audio duration: %v, using estimated duration", err)
			// Estimate duration based on text length (~150 chars per second for narration)
			audioDuration = float64(len(unifiedText)) / 150.0
		}

		// Step 5: Generate STT captions from audio using Whisper
		captionSegments, err := w.waveSpeed.GenerateCaptionsFromAudio(audioURL)
		if err != nil {
			log.Printf("Warning: failed to generate captions: %v", err)
			// Continue without captions - we'll use chunk text as fallback
			captionSegments = nil
		}

		// Step 6: Calculate chunk duration based on audio duration and number of images
		numImages := len(imageGroups)
		if numImages == 0 {
			numImages = 1
		}
		chunkDuration := audioDuration / float64(numImages)

		// Store the audio path and caption segments in segments for later use
		// We need to store these so they can be used in composition
		for i := range segments {
			segments[i].AudioPath = audioPath
		}

		// Store caption segments and chunk duration for composition
		// This is a bit of a hack - we store it in the first segment's duration field
		// and use the AudioPath to indicate unified audio is being used
		if len(segments) > 0 {
			// Mark that we have unified audio by storing caption segments info
			// We'll pass this info to composition via a different mechanism
		}

		// Store caption segments and metadata in a JSON file for composition
		captionInfo := map[string]interface{}{
			"audioPath":      audioPath,
			"audioDuration":  audioDuration,
			"chunkDuration":  chunkDuration,
			"captionSegments": captionSegments,
		}
		captionInfoJSON, _ := json.Marshal(captionInfo)
		captionInfoPath := filepath.Join(videoDir, "caption_info.json")
		if err := os.WriteFile(captionInfoPath, captionInfoJSON, 0644); err != nil {
			log.Printf("Warning: failed to save caption info: %v", err)
		}

		w.broadcastStep(videoRequestID, "generating_assets", "assets_audio", 65, fmt.Sprintf("Generated unified audio: %.1fs, %d images", audioDuration, numImages))
	}()

	// Wait for both to complete
	wg.Wait()

	if imageGenErr != nil {
		w.handleError(videoRequestID, "generating_assets", "generating_images", fmt.Sprintf("Failed to generate images: %v", imageGenErr))
		return
	}

	if audioGenErr != nil {
		w.handleError(videoRequestID, "generating_assets", "assets_audio", fmt.Sprintf("Failed to generate audio: %v", audioGenErr))
		return
	}

	// Collect image URLs and paths from image groups
	imageURLs := make([]string, len(imageGroups))
	imagePaths := make([]string, len(imageGroups))
	for i, group := range imageGroups {
		imageURLs[i] = group.ImageURL
		imagePaths[i] = group.ImagePath
	}

	w.broadcastStep(videoRequestID, "generating_assets", "assets_complete", 70, fmt.Sprintf("Generated %d images and unified audio", len(imageGroups)))

	// Read caption info that was saved during audio generation
	captionInfoPath := filepath.Join(videoDir, "caption_info.json")
	var captionInfo struct {
		AudioPath      string                    `json:"audioPath"`
		AudioDuration  float64                   `json:"audioDuration"`
		ChunkDuration  float64                   `json:"chunkDuration"`
		CaptionSegments []services.CaptionSegment `json:"captionSegments"`
	}

	captionInfoData, err := os.ReadFile(captionInfoPath)
	if err != nil {
		log.Printf("Warning: Failed to read caption info: %v", err)
	} else if err := json.Unmarshal(captionInfoData, &captionInfo); err != nil {
		log.Printf("Warning: Failed to parse caption info: %v", err)
	}

	// Read unified audio file
	var unifiedAudioData []byte
	if captionInfo.AudioPath != "" {
		unifiedAudioData, err = os.ReadFile(captionInfo.AudioPath)
		if err != nil {
			log.Printf("Warning: Failed to read unified audio: %v", err)
			unifiedAudioData = []byte("PLACEHOLDER_AUDIO")
		}
	} else {
		unifiedAudioData = []byte("PLACEHOLDER_AUDIO")
	}

	// Update chunks with duration from audio
	chunkDuration := captionInfo.ChunkDuration
	if chunkDuration <= 0 {
		chunkDuration = 5.0 // Default fallback
	}

	// Update each chunk's duration and prepare audio for each chunk
	numImages := len(imageGroups)
	if numImages == 0 {
		numImages = 1
	}

	audios := make([][]byte, len(chunks))
	for i := range chunks {
		// Set duration for each chunk
		chunks[i].Duration = chunkDuration
		chunks[i].StartTime = float64(i) * chunkDuration

		// For unified audio, we use the same audio for all chunks
		// The video processor will handle the timing
		if len(unifiedAudioData) > 100 && string(unifiedAudioData) != "PLACEHOLDER_AUDIO" {
			audios[i] = unifiedAudioData
		} else {
			audios[i] = []byte("PLACEHOLDER_AUDIO")
		}
	}

	// Save images
	imagesJSON, _ := json.Marshal(imageURLs)
	chunkIDsJSON, _ := json.Marshal(len(chunks)) // Simplified

	_, err = w.db.Exec(`
		INSERT INTO images_generated
		(user_id, video_requested_id, is_generating, image_urls, chunk_ids)
		VALUES (?, ?, FALSE, ?, ?)
	`, userID, videoRequestID, string(imagesJSON), string(chunkIDsJSON))
	if err != nil {
		w.handleError(videoRequestID, "generating_assets", "assets_save", fmt.Sprintf("Failed to save images: %v", err))
		return
	}

	w.broadcastStep(videoRequestID, "generating_assets", "assets_save", 75, "Saving assets")
	w.broadcastStep(videoRequestID, "generating_assets", "assets_complete", 75, "Assets generation complete")

	// Phase 6: Composition
	w.updatePhase(videoRequestID, "composing")
	w.broadcastStep(videoRequestID, "composing", "composing_start", 75, "Composing video with kinetic captions")

	input := services.CompositionInput{
		Chunks:          chunks,
		ImageGroups:     imageGroups,
		Images:          imagePaths, // Use local paths for FFmpeg
		Audios:          audios,
		OutputLang:      outputLang,
		CaptionSegments: captionInfo.CaptionSegments,
	}

	outputPath, err := w.videoProcessor.GenerateVideo(input)
	if err != nil {
		w.handleError(videoRequestID, "composing", "composing_video", fmt.Sprintf("Failed to compose video: %v", err))
		return
	}
	defer os.Remove(outputPath)

	w.broadcastStep(videoRequestID, "composing", "composing_video", 85, "Rendering video")

	// Read final video
	videoData, err := os.ReadFile(outputPath)
	if err != nil {
		w.handleError(videoRequestID, "composing", "composing_complete", fmt.Sprintf("Failed to read output video: %v", err))
		return
	}

	w.broadcastStep(videoRequestID, "composing", "composing_complete", 90, "Video composition complete")

	// Phase 7: Upload to Bunny
	w.updatePhase(videoRequestID, "uploading")
	w.broadcastStep(videoRequestID, "uploading", "uploading_start", 90, "Uploading to CDN")

	filename := fmt.Sprintf("%d_%d.mp4", videoRequestID, time.Now().Unix())
	uploadURL, err := w.bunny.UploadVideo(filename, videoData)
	if err != nil {
		w.handleError(videoRequestID, "uploading", "uploading_progress", fmt.Sprintf("Failed to upload video: %v", err))
		return
	}

	w.broadcastStep(videoRequestID, "uploading", "uploading_complete", 95, "Upload complete")

	// Set expiration (48 hours)
	expiresAt := time.Now().Add(48 * time.Hour)

	// Save final video record
	_, err = w.db.Exec(`
		INSERT INTO video_edition_composition
		(user_id, video_requested_id, is_generating, video_full_generated_url)
		VALUES (?, ?, FALSE, ?)
	`, userID, videoRequestID, uploadURL)
	if err != nil {
		w.handleError(videoRequestID, "uploading", "uploading_complete", fmt.Sprintf("Failed to save video: %v", err))
		return
	}

	// Update videos_requested with final info (store filename and full URL)
	_, err = w.db.Exec(`
		UPDATE videos_requested
		SET phase_of_generation = 'completed',
			bunny_video_id = ?,
			bunny_video_url = ?,
			download_expires_at = ?
		WHERE id = ?
	`, filename, uploadURL, expiresAt, videoRequestID)
	if err != nil {
		log.Printf("Failed to update video request: %v", err)
	}

	// Broadcast completion
	w.broadcast(videoRequestID, "completed", 100, "Video generation complete!")

	log.Printf("Video processing complete for request %d", videoRequestID)
}

func (w *VideoWorker) updatePhase(videoRequestID uint64, phase string) {
	w.db.Exec("UPDATE videos_requested SET phase_of_generation = ? WHERE id = ?", phase, videoRequestID)
}

func (w *VideoWorker) broadcast(videoRequestID uint64, phase string, progress int, message string) {
	if w.broadcaster != nil {
		w.broadcaster.BroadcastPhase(videoRequestID, phase, progress, message)
	}
}

func (w *VideoWorker) broadcastStep(videoRequestID uint64, phase, step string, progress int, message string) {
	if w.broadcaster != nil {
		w.broadcaster.BroadcastStep(videoRequestID, phase, step, progress, message)
	}
}

func (w *VideoWorker) handleError(videoRequestID uint64, phase, step, errMsg string) {
	log.Printf("Error processing video %d: %s", videoRequestID, errMsg)
	w.db.Exec("UPDATE videos_requested SET phase_of_generation = 'error', error_message = ? WHERE id = ?", errMsg, videoRequestID)
	if w.broadcaster != nil {
		w.broadcaster.BroadcastError(videoRequestID, phase, step, errMsg)
	}
}

func (w *VideoWorker) GetSignedURL(filename string) (string, error) {
	return w.bunny.GetSignedURL(filename, 48*time.Hour)
}

// CleanupExpiredVideos removes videos older than 48 hours
func (w *VideoWorker) CleanupExpiredVideos() {
	var videos []struct {
		ID           uint64        `db:"id"`
		BunnyVideoID sql.NullString `db:"bunny_video_id"`
	}

	err := w.db.Select(&videos, `
		SELECT id, bunny_video_id
		FROM videos_requested
		WHERE download_expires_at < NOW()
		AND bunny_video_id IS NOT NULL
	`)
	if err != nil {
		log.Printf("Failed to fetch expired videos: %v", err)
		return
	}

	for _, video := range videos {
		if video.BunnyVideoID.Valid {
			w.bunny.DeleteVideo(video.BunnyVideoID.String)
			w.db.Exec("UPDATE videos_requested SET bunny_video_id = NULL, bunny_video_url = NULL WHERE id = ?", video.ID)
			log.Printf("Cleaned up expired video: %d", video.ID)
		}
	}
}

// parseTactiqTranscript parses tactiq.io format transcript and extracts chunks with timestamps
// Format: "00:00:00.320 stop using AI to learn English I know"
func parseTactiqTranscript(text string) ([]services.Chunk, string) {
	var chunks []services.Chunk
	var fullText strings.Builder

	// Regex to match timestamp lines: HH:MM:SS.mmm text...
	timestampRegex := regexp.MustCompile(`^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+(.+)$`)

	lines := strings.Split(text, "\n")
	var prevEndTime float64 = 0

	for _, line := range lines {
		line = strings.TrimSpace(line)

		// Skip empty lines and comment lines
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		matches := timestampRegex.FindStringSubmatch(line)
		if matches == nil {
			// If no timestamp match, append to previous chunk text if exists
			if len(chunks) > 0 {
				chunks[len(chunks)-1].Text += " " + line
			}
			continue
		}

		// Parse timestamp
		hours, _ := strconv.Atoi(matches[1])
		minutes, _ := strconv.Atoi(matches[2])
		seconds, _ := strconv.Atoi(matches[3])
		millis, _ := strconv.Atoi(matches[4])
		text := matches[5]

		// Skip "No text" entries
		if strings.ToLower(text) == "no text" {
			continue
		}

		startTime := float64(hours*3600+minutes*60+seconds) + float64(millis)/1000

		// Calculate duration
		duration := startTime - prevEndTime
		if duration < 0 {
			duration = 0
		}

		chunk := services.Chunk{
			ID:        fmt.Sprintf("chunk_%d", len(chunks)),
			Text:      text,
			StartTime: startTime,
			Duration:  duration,
		}

		chunks = append(chunks, chunk)
		fullText.WriteString(text + " ")
		prevEndTime = startTime + duration
	}

	return chunks, strings.TrimSpace(fullText.String())
}
