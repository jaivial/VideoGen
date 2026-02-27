package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"video-generator/internal/config"
)

type WaveSpeedService struct {
	cfg    *config.Config
	client        *http.Client
	clientNoTimeout *http.Client // For long-running operations like TTS
}

type WaveSpeedImageRequest struct {
	EnableBase64Output bool    `json:"enable_base64_output"`
	EnableSyncMode     bool    `json:"enable_sync_mode"`
	OutputFormat       string  `json:"output_format"`
	Prompt             string  `json:"prompt"`
	Seed               int     `json:"seed"`
	Size               string  `json:"size"`
	Strength           float64 `json:"strength"`
}

type WaveSpeedImageResponseWrapper struct {
	// New flat format fields
	ID      string   `json:"id"`
	Status  string   `json:"status"`
	Outputs []string `json:"outputs"`
	Error   string   `json:"error"`

	// Old wrapped format fields
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		ID        string   `json:"id"`
		Status    string   `json:"status"`
		Outputs   []string `json:"outputs"`
		Error     string   `json:"error"`
	} `json:"data"`
}

// GetStatus returns the status from either format
func (r *WaveSpeedImageResponseWrapper) GetStatus() string {
	if r.Status != "" {
		return r.Status
	}
	return r.Data.Status
}

// GetOutputs returns the outputs from either format
func (r *WaveSpeedImageResponseWrapper) GetOutputs() []string {
	if len(r.Outputs) > 0 {
		return r.Outputs
	}
	return r.Data.Outputs
}

// GetError returns the error from either format
func (r *WaveSpeedImageResponseWrapper) GetError() string {
	if r.Error != "" {
		return r.Error
	}
	return r.Data.Error
}

// GetID returns the ID from either format
func (r *WaveSpeedImageResponseWrapper) GetID() string {
	if r.ID != "" {
		return r.ID
	}
	return r.Data.ID
}

func NewWaveSpeedService(cfg *config.Config) *WaveSpeedService {
	return &WaveSpeedService{
		cfg:    cfg,
		client: &http.Client{},
		clientNoTimeout: &http.Client{
			Timeout: 0, // No timeout for long-running background operations
		},
	}
}

func (s *WaveSpeedService) GenerateImage(prompt string) (string, error) {
	if s.cfg.WavespeedAPIKey == "" {
		// Return placeholder in dev
		return "https://via.placeholder.com/1024x576.png?text=Generated+Image", nil
	}

	reqBody := WaveSpeedImageRequest{
		EnableBase64Output: false,
		EnableSyncMode:     false,
		OutputFormat:       "jpeg",
		Prompt:             prompt,
		Seed:               -1, // Random seed
		Size:               "1024x576", // 16:9 aspect ratio
		Strength:           0.8,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", "https://api.wavespeed.ai/api/v3/wavespeed-ai/z-image/turbo", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.cfg.WavespeedAPIKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("wavespeed API error: %d - %s", resp.StatusCode, string(respBody))
	}

	var result WaveSpeedImageResponseWrapper
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	// Check for API error (support both old wrapped format and new flat format)
	if result.Code != 200 && result.Code != 0 {
		return "", fmt.Errorf("wavespeed image API error: %s", result.Message)
	}

	// Get task ID - support both old wrapped format and new flat format
	taskID := result.GetID()
	if taskID == "" {
		return "", fmt.Errorf("wavespeed image API error: no task ID returned")
	}

	// Poll for completion
	return s.pollImageResult(taskID)
}

// pollImageResult polls for image generation task completion
func (s *WaveSpeedService) pollImageResult(taskID string) (string, error) {
	maxAttempts := 90 // Max 90 seconds for image generation
	attempt := 0

	for attempt < maxAttempts {
		attempt++
		req, err := http.NewRequest("GET", fmt.Sprintf("https://api.wavespeed.ai/api/v3/predictions/%s/result", taskID), nil)
		if err != nil {
			return "", fmt.Errorf("failed to create polling request: %w", err)
		}

		req.Header.Set("Authorization", "Bearer "+s.cfg.WavespeedAPIKey)

		resp, err := s.client.Do(req)
		if err != nil {
			return "", fmt.Errorf("failed to poll image result: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			// Wait and retry
			time.Sleep(2 * time.Second)
			continue
		}

		var result WaveSpeedImageResponseWrapper
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			resp.Body.Close()
			return "", fmt.Errorf("failed to decode image polling response: %w", err)
		}
		resp.Body.Close()

		// Use helper methods to support both old and new response formats
		status := result.GetStatus()
		outputs := result.GetOutputs()
		errMsg := result.GetError()

		if status == "completed" && len(outputs) > 0 {
			return outputs[0], nil
		}

		if status == "failed" {
			return "", fmt.Errorf("wavespeed image generation failed: %s", errMsg)
		}

		// Wait before next poll (longer for images)
		time.Sleep(2 * time.Second)
	}

	return "", fmt.Errorf("image generation timed out after %d attempts", maxAttempts)
}

func (s *WaveSpeedService) GenerateImages(prompts []string) ([]string, error) {
	results := make([]string, len(prompts))

	for i, prompt := range prompts {
		url, err := s.GenerateImage(prompt)
		if err != nil {
			return nil, fmt.Errorf("failed to generate image for chunk %d: %w", i, err)
		}
		results[i] = url
	}

	return results, nil
}

// GenerateImagesParallel generates images in parallel from ImageGroups
// Downloads and saves images to {outputDir}/images/group_{start}-{end}.jpg (e.g., group_0-9.jpg)
// Uses WaitGroup to coordinate and broadcasts progress for each image
func (s *WaveSpeedService) GenerateImagesParallel(
	imageGroups []ImageGroup,
	outputDir string,
	broadcaster TTSBroadcaster,
	videoID uint64,
) ([]ImageGroup, error) {
	total := len(imageGroups)
	if total == 0 {
		return nil, nil
	}

	// Create output directory for images
	imagesDir := filepath.Join(outputDir, "images")
	if err := os.MkdirAll(imagesDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create images directory: %w", err)
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	completed := 0
	errors := make([]error, 0)

	// Create a semaphore to limit concurrent image generations
	semaphore := make(chan struct{}, 3) // Max 3 concurrent image generations

	for i := range imageGroups {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()

			// Acquire semaphore
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			// Generate image
			imageURL, err := s.GenerateImage(imageGroups[index].Prompt)
			if err != nil {
				mu.Lock()
				log.Printf("Image generation error for group %d: %v", index, err)
				errors = append(errors, fmt.Errorf("group %d: %w", index, err))
				if broadcaster != nil {
					broadcaster.BroadcastError(videoID, "generating_images", "generate_image",
						fmt.Sprintf("Failed to generate image %d/%d: %v", index+1, total, err))
				}
				mu.Unlock()
				return
			}

			// Download the image
			imageData, err := s.downloadImage(imageURL)
			if err != nil {
				mu.Lock()
				log.Printf("Image download error for group %d: %v", index, err)
				errors = append(errors, fmt.Errorf("group %d: %w", index, err))
				if broadcaster != nil {
					broadcaster.BroadcastError(videoID, "generating_images", "generate_image",
						fmt.Sprintf("Failed to download image %d/%d: %v", index+1, total, err))
				}
				mu.Unlock()
				return
			}

			// Save image to file with chunk range naming (e.g., {videoID}_group_0-9.jpg)
			imagePath := filepath.Join(imagesDir, fmt.Sprintf("%d_group_%d-%d.jpg", videoID, imageGroups[index].ChunkStart, imageGroups[index].ChunkEnd-1))
			if err := os.WriteFile(imagePath, imageData, 0644); err != nil {
				mu.Lock()
				log.Printf("Failed to save image for group %d: %v", index, err)
				errors = append(errors, fmt.Errorf("group %d: %w", index, err))
				if broadcaster != nil {
					broadcaster.BroadcastError(videoID, "generating_images", "generate_image",
						fmt.Sprintf("Failed to save image %d/%d: %v", index+1, total, err))
				}
				mu.Unlock()
				return
			}

			mu.Lock()
			imageGroups[index].ImageURL = imageURL
			imageGroups[index].ImagePath = imagePath
			completed++

			// Broadcast progress for this image
			if broadcaster != nil {
				broadcaster.BroadcastStep(videoID, "generating_images", "generate_image",
					(completed*100)/total,
					fmt.Sprintf("Generated image %d/%d", index+1, total))
			}

			log.Printf("Generated image for group %d/%d: %s", index+1, total, imagePath)
			mu.Unlock()
		}(i)
	}

	wg.Wait()

	if len(errors) > 0 {
		log.Printf("Image generation completed with %d errors out of %d groups", len(errors), total)
	}

	log.Printf("Parallel image generation complete: %d/%d groups processed", completed, total)
	return imageGroups, nil
}

// downloadImage downloads an image from a URL and returns the bytes
func (s *WaveSpeedService) downloadImage(imageURL string) ([]byte, error) {
	req, err := http.NewRequest("GET", imageURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create download request: %w", err)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to download image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to download image: status %d", resp.StatusCode)
	}

	return io.ReadAll(resp.Body)
}

// WaveSpeed TTS types for Qwen3 TTS Text-to-Speech
// Supports both old format (with data wrapper) and new flat format

type WaveSpeedTTSRequest struct {
	Text            string `json:"text"`
	Language        string `json:"language"`
	Voice           string `json:"voice"`
	StyleInstruction string `json:"style_instruction"`
}

// Available voices for Qwen3 TTS
var Qwen3Voices = []string{"Vivian", "Serena", "Ono_Anna", "Sohee", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden"}

// DefaultVoice is the default voice to use
const DefaultVoice = "Vivian"

// DefaultStyleInstruction is the default style for narration
const DefaultStyleInstruction = "A clear, professional narrator voice. Moderate pace, storytelling style, perfect for educational content. Consistent tone and rhythm throughout."

// Language code to full name mapping for WaveSpeed TTS API
var languageCodeToName = map[string]string{
	"auto": "auto",
	"en":   "English",
	"zh":   "Chinese",
	"de":   "German",
	"it":   "Italian",
	"pt":   "Portuguese",
	"es":   "Spanish",
	"ja":   "Japanese",
	"ko":   "Korean",
	"fr":   "French",
	"ru":   "Russian",
}

// getLanguageName converts language code to full name for WaveSpeed TTS
func getLanguageName(code string) string {
	if name, ok := languageCodeToName[code]; ok {
		return name
	}
	return "auto" // Default to auto if not found
}

// WaveSpeedTTSResponseWrapper supports both response formats:
// - New flat format: {id, status, outputs, error}
// - Old wrapped format: {code, message, data: {id, status, outputs, error}}
type WaveSpeedTTSResponseWrapper struct {
	// New flat format fields
	ID      string   `json:"id"`
	Status  string   `json:"status"`
	Outputs []string `json:"outputs"`
	Error   string   `json:"error"`

	// Old wrapped format fields
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    struct {
		ID        string   `json:"id"`
		Status    string   `json:"status"`
		Outputs   []string `json:"outputs"`
		Error     string   `json:"error"`
		URLs      struct {
			Get string `json:"get"`
		} `json:"urls"`
	} `json:"data"`
}

// GetStatus returns the status from either format
func (r *WaveSpeedTTSResponseWrapper) GetStatus() string {
	if r.Status != "" {
		return r.Status
	}
	return r.Data.Status
}

// GetOutputs returns the outputs from either format
func (r *WaveSpeedTTSResponseWrapper) GetOutputs() []string {
	if len(r.Outputs) > 0 {
		return r.Outputs
	}
	return r.Data.Outputs
}

// GetError returns the error from either format
func (r *WaveSpeedTTSResponseWrapper) GetError() string {
	if r.Error != "" {
		return r.Error
	}
	return r.Data.Error
}

// GetID returns the ID from either format
func (r *WaveSpeedTTSResponseWrapper) GetID() string {
	if r.ID != "" {
		return r.ID
	}
	return r.Data.ID
}

// GenerateSpeech generates speech using WaveSpeed Qwen3 TTS Text-to-Speech API
// Returns the audio URL or audio data
// voice parameter specifies the voice name, styleInstruction specifies the speaking style
func (s *WaveSpeedService) GenerateSpeech(text, voiceDescription string) (string, error) {
	return s.GenerateSpeechWithVoice(text, "", voiceDescription, "")
}

// GenerateSpeechWithVoice generates speech with explicit voice and style parameters
func (s *WaveSpeedService) GenerateSpeechWithVoice(text, voice, styleInstruction, language string) (string, error) {
	if s.cfg.WavespeedAPIKey == "" {
		// Return placeholder in dev
		return "PLACEHOLDER_AUDIO", nil
	}

	// Use default voice and style if not provided
	selectedVoice := DefaultVoice
	selectedStyle := DefaultStyleInstruction

	// Use provided voice if valid
	if voice != "" {
		for _, v := range Qwen3Voices {
			if voice == v {
				selectedVoice = voice
				break
			}
		}
	}

	// Use provided style instruction if not empty
	if styleInstruction != "" {
		selectedStyle = styleInstruction
	}

	// Use the provided language, default to "auto" if not set
	selectedLanguage := getLanguageName(language)

	log.Printf("[TTS] Using voice: %s, style: %s, language: %s", selectedVoice, selectedStyle, selectedLanguage)

	reqBody := WaveSpeedTTSRequest{
		Text:             text,
		Language:         selectedLanguage,
		Voice:            selectedVoice,
		StyleInstruction: selectedStyle,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal TTS request: %w", err)
	}

	req, err := http.NewRequest("POST", "https://api.wavespeed.ai/api/v3/wavespeed-ai/qwen3-tts/text-to-speech", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("failed to create TTS request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.cfg.WavespeedAPIKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send TTS request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("wavespeed TTS API error: %d - %s", resp.StatusCode, string(respBody))
	}

	var result WaveSpeedTTSResponseWrapper
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode TTS response: %w", err)
	}

	// Check for API error (support both old wrapped format and new flat format)
	if result.Code != 200 && result.Code != 0 {
		return "", fmt.Errorf("wavespeed TTS API error: %s", result.Message)
	}

	// Get task ID - support both old wrapped format and new flat format
	taskID := result.GetID()
	if taskID == "" {
		return "", fmt.Errorf("wavespeed TTS API error: no task ID returned")
	}

	// Poll for completion
	return s.pollTTSResult(taskID)
}

// pollTTSResult polls for TTS task completion
func (s *WaveSpeedService) pollTTSResult(taskID string) (string, error) {
	maxAttempts := 300 // Max 300 seconds (5 minutes) wait for TTS
	attempt := 0

	for attempt < maxAttempts {
		attempt++
		req, err := http.NewRequest("GET", fmt.Sprintf("https://api.wavespeed.ai/api/v3/predictions/%s/result", taskID), nil)
		if err != nil {
			return "", fmt.Errorf("failed to create polling request: %w", err)
		}

		req.Header.Set("Authorization", "Bearer "+s.cfg.WavespeedAPIKey)

		resp, err := s.client.Do(req)
		if err != nil {
			return "", fmt.Errorf("failed to poll TTS result: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			// Wait and retry
			time.Sleep(1 * time.Second)
			continue
		}

		var result WaveSpeedTTSResponseWrapper
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			resp.Body.Close()
			return "", fmt.Errorf("failed to decode TTS polling response: %w", err)
		}
		resp.Body.Close()

		// Use helper methods to support both old and new response formats
		status := result.GetStatus()
		outputs := result.GetOutputs()
		errMsg := result.GetError()

		if status == "completed" && len(outputs) > 0 {
			log.Printf("TTS task %s completed after %d attempts", taskID, attempt)
			return outputs[0], nil
		}

		if status == "failed" {
			return "", fmt.Errorf("wavespeed TTS generation failed: %s", errMsg)
		}

		// Wait before next poll
		time.Sleep(1 * time.Second)
	}

	return "", fmt.Errorf("TTS generation timed out after %d attempts", maxAttempts)
}

// CaptionSegment represents a caption with timing
type CaptionSegment struct {
	Index     int     `json:"Index"`
	Text      string  `json:"text"`
	StartTime float64 `json:"start"`
	EndTime   float64 `json:"end"`
}

// WaveSpeed Whisper request/response types
type WaveSpeedWhisperRequest struct {
	Audio              string `json:"audio"`
	Model              string `json:"model"`
	EnableTimestamps   bool   `json:"enable_timestamps"`
	EnableSyncMode     bool   `json:"enable_sync_mode"`
	InitialPrompt      string `json:"initial_prompt,omitempty"`
	Language           string `json:"language,omitempty"`
}

type WaveSpeedWhisperResponseWrapper struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	// Data field contains the actual result including outputs array
	Data struct {
		ID      string `json:"id"`
		Status  string `json:"status"`
		Outputs []struct {
			ID          string           `json:"id"`
			Status      string           `json:"status"`
			Text        string           `json:"text"`
			TextDetails []CaptionSegment `json:"text_details"` // Primary field for Whisper captions
			SRT         string           `json:"srt"`         // SRT format fallback
			Segments    []CaptionSegment `json:"segments"`
			Error       string           `json:"error"`
		} `json:"outputs"`
		Text        string           `json:"text"`
		TextDetails []CaptionSegment `json:"text_details"`
		SRT         string           `json:"srt"`
		Segments    []CaptionSegment `json:"segments"`
		Error       string           `json:"error"`
	} `json:"data"`
}

// API limits for text processing
const (
	MaxTTSTextLength    = 1800  // WaveSpeed TTS limit
	MaxTranslationChars = 10000 // OpenRouter limit (conservative)
)

// ConsistentVoice is a fixed voice profile for consistent TTS output across runs
// This ensures the same voice characteristics every time (used as style_instruction)
const ConsistentVoice = "A warm, engaging narrator voice. Moderate pace, storytelling style, professional audiobook narrator quality. " +
	"Expressive but not dramatic, perfect for educational content. Consistent tone and rhythm throughout. Clear diction, confident delivery."

// ChunkText splits text into chunks that fit within the limit
// Splits on sentence boundaries where possible
func ChunkText(text string, maxLen int) []string {
	if len(text) <= maxLen {
		return []string{text}
	}

	var chunks []string
	// Split by common sentence-ending punctuation
	sentences := splitIntoSentences(text)

	var currentChunk strings.Builder
	for _, sentence := range sentences {
		// Check if adding this sentence would exceed the limit
		if currentChunk.Len()+len(sentence)+1 > maxLen {
			// Current chunk is full, save it
			if currentChunk.Len() > 0 {
				chunks = append(chunks, strings.TrimSpace(currentChunk.String()))
				currentChunk.Reset()
			}

			// If single sentence is longer than maxLen, force split
			if len(sentence) > maxLen {
				// Split by words
				words := strings.Fields(sentence)
				var wordChunk strings.Builder
				for _, word := range words {
					if wordChunk.Len()+len(word)+1 > maxLen {
						if wordChunk.Len() > 0 {
							chunks = append(chunks, strings.TrimSpace(wordChunk.String()))
							wordChunk.Reset()
						}
					}
					if wordChunk.Len() > 0 {
						wordChunk.WriteString(" ")
					}
					wordChunk.WriteString(word)
				}
				if wordChunk.Len() > 0 {
					currentChunk.WriteString(wordChunk.String())
				}
			} else {
				currentChunk.WriteString(sentence)
			}
		} else {
			// Add sentence to current chunk
			if currentChunk.Len() > 0 {
				currentChunk.WriteString(" ")
			}
			currentChunk.WriteString(sentence)
		}
	}

	// Add remaining chunk
	if currentChunk.Len() > 0 {
		chunks = append(chunks, strings.TrimSpace(currentChunk.String()))
	}

	// If still empty (edge case), return original text as single chunk
	if len(chunks) == 0 {
		return []string{text}
	}

	return chunks
}

// splitIntoSentences splits text into sentences
func splitIntoSentences(text string) []string {
	// Split on sentence-ending punctuation: . ! ?
	// But preserve the punctuation
	re := regexp.MustCompile(`([.!?])\s+`)
	parts := re.Split(text, -1)

	var sentences []string
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		// Add back the punctuation
		sentences = append(sentences, part)
	}

	if len(sentences) == 0 && text != "" {
		// If no sentences found, return the whole text
		return []string{text}
	}

	return sentences
}

// GenerateUnifiedSpeech generates a single audio file from unified transcript text
// Uses the WaveSpeed Qwen3 TTS API
// If text exceeds API limits, automatically chunks and concatenates audio
func (s *WaveSpeedService) GenerateUnifiedSpeech(unifiedText, voiceDescription string) (string, error) {
	if s.cfg.WavespeedAPIKey == "" {
		// Return placeholder in dev
		return "PLACEHOLDER_AUDIO", nil
	}

	// Default voice description if not provided
	if voiceDescription == "" {
		voiceDescription = DefaultStyleInstruction
	}

	// The Qwen3 TTS API has a limit on text length (~2000 chars)
	// Chunk text if it exceeds the limit
	if len(unifiedText) > MaxTTSTextLength {
		return s.GenerateChunkedSpeech(unifiedText, voiceDescription)
	}

	reqBody := WaveSpeedTTSRequest{
		Text:             unifiedText,
		Language:         "auto",
		Voice:            DefaultVoice,
		StyleInstruction: voiceDescription,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal unified TTS request: %w", err)
	}

	req, err := http.NewRequest("POST", "https://api.wavespeed.ai/api/v3/wavespeed-ai/qwen3-tts/text-to-speech", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("failed to create unified TTS request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.cfg.WavespeedAPIKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send unified TTS request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("wavespeed unified TTS API error: %d - %s", resp.StatusCode, string(respBody))
	}

	var result WaveSpeedTTSResponseWrapper
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode unified TTS response: %w", err)
	}

	// Check for API error (support both old wrapped format and new flat format)
	if result.Code != 200 && result.Code != 0 {
		return "", fmt.Errorf("wavespeed unified TTS API error: %s", result.Message)
	}

	// Get task ID - support both old wrapped format and new flat format
	taskID := result.GetID()
	if taskID == "" {
		return "", fmt.Errorf("wavespeed unified TTS API error: no task ID returned")
	}

	// Poll for completion using no-timeout client
	return s.pollTTSResultBackground(taskID)
}

// GenerateUnifiedSpeechBackground generates audio without HTTP timeout constraints
// Uses a dedicated HTTP client with no timeout for long-running TTS operations
func (s *WaveSpeedService) GenerateUnifiedSpeechBackground(unifiedText, voiceDescription string) (string, error) {
	return s.GenerateUnifiedSpeechBackgroundWithVoice(unifiedText, "", voiceDescription, "")
}

// GenerateUnifiedSpeechBackgroundWithVoice generates audio with explicit voice and style
func (s *WaveSpeedService) GenerateUnifiedSpeechBackgroundWithVoice(unifiedText, voice, styleInstruction, language string) (string, error) {
	if s.cfg.WavespeedAPIKey == "" {
		// Return placeholder in dev
		return "PLACEHOLDER_AUDIO", nil
	}

	// Use defaults if not provided
	selectedVoice := DefaultVoice
	selectedStyle := DefaultStyleInstruction

	// Use provided voice if valid
	if voice != "" {
		for _, v := range Qwen3Voices {
			if voice == v {
				selectedVoice = voice
				break
			}
		}
	}

	// Use provided style instruction if not empty
	if styleInstruction != "" {
		selectedStyle = styleInstruction
	}

	// Use the provided language, default to "auto" if not set
	selectedLanguage := getLanguageName(language)

	// The Qwen3 TTS API has a limit on text length (~2000 chars)
	// Chunk text if it exceeds the limit
	if len(unifiedText) > MaxTTSTextLength {
		log.Printf("[TTS] Text length %d exceeds limit %d, chunking for TTS", len(unifiedText), MaxTTSTextLength)
		return s.GenerateChunkedSpeechBackgroundWithVoice(unifiedText, selectedVoice, selectedStyle, selectedLanguage)
	}
	log.Printf("[TTS] Single TTS call for %d chars, voice: %s, language: %s", len(unifiedText), selectedVoice, selectedLanguage)

	reqBody := WaveSpeedTTSRequest{
		Text:             unifiedText,
		Language:         selectedLanguage,
		Voice:            selectedVoice,
		StyleInstruction: selectedStyle,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal unified TTS request: %w", err)
	}

	req, err := http.NewRequest("POST", "https://api.wavespeed.ai/api/v3/wavespeed-ai/qwen3-tts/text-to-speech", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("failed to create unified TTS request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.cfg.WavespeedAPIKey)

	// Use no-timeout client for initial request
	resp, err := s.clientNoTimeout.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send unified TTS request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("wavespeed unified TTS API error: %d - %s", resp.StatusCode, string(respBody))
	}

	var resultB WaveSpeedTTSResponseWrapper
	if err := json.NewDecoder(resp.Body).Decode(&resultB); err != nil {
		return "", fmt.Errorf("failed to decode unified TTS response: %w", err)
	}

	// Check for API error (support both old wrapped format and new flat format)
	if resultB.Code != 200 && resultB.Code != 0 {
		return "", fmt.Errorf("wavespeed unified TTS API error: %s", resultB.Message)
	}

	// Get task ID - support both old wrapped format and new flat format
	taskID := resultB.GetID()
	if taskID == "" {
		return "", fmt.Errorf("wavespeed unified TTS API error: no task ID returned")
	}
	log.Printf("TTS task submitted: %s, text length: %d chars", taskID, len(unifiedText))

	// Poll for completion using no-timeout client
	return s.pollTTSResultBackground(taskID)
}

// pollTTSResultBackground polls for TTS task completion using no-timeout client
func (s *WaveSpeedService) pollTTSResultBackground(taskID string) (string, error) {
	maxAttempts := 300 // Max 300 seconds (5 minutes) wait for TTS
	attempt := 0

	for attempt < maxAttempts {
		attempt++
		req, err := http.NewRequest("GET", fmt.Sprintf("https://api.wavespeed.ai/api/v3/predictions/%s/result", taskID), nil)
		if err != nil {
			return "", fmt.Errorf("failed to create polling request: %w", err)
		}

		req.Header.Set("Authorization", "Bearer "+s.cfg.WavespeedAPIKey)

		// Use no-timeout client for polling
		resp, err := s.clientNoTimeout.Do(req)
		if err != nil {
			return "", fmt.Errorf("failed to poll TTS result: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			// Wait and retry
			time.Sleep(1 * time.Second)
			continue
		}

		var result WaveSpeedTTSResponseWrapper
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			resp.Body.Close()
			return "", fmt.Errorf("failed to decode TTS polling response: %w", err)
		}
		resp.Body.Close()

		if result.Data.Status == "completed" && len(result.Data.Outputs) > 0 {
			log.Printf("TTS task %s completed after %d attempts", taskID, attempt)
			return result.Data.Outputs[0], nil
		}

		if result.Data.Status == "failed" {
			return "", fmt.Errorf("wavespeed TTS generation failed: %s", result.Data.Error)
		}

		// Log progress every 30 attempts
		if attempt%30 == 0 {
			log.Printf("TTS task %s still processing (attempt %d/%d)", taskID, attempt, maxAttempts)
		}

		// Wait before next poll
		time.Sleep(1 * time.Second)
	}

	return "", fmt.Errorf("TTS generation timed out after %d attempts", maxAttempts)
}

// GenerateChunkedSpeech handles long text by chunking and concatenating audio
func (s *WaveSpeedService) GenerateChunkedSpeech(unifiedText, voiceDescription string) (string, error) {
	// Chunk the text
	chunks := ChunkText(unifiedText, MaxTTSTextLength)
	log.Printf("Chunking text into %d chunks for TTS", len(chunks))

	if len(chunks) == 0 {
		return "", fmt.Errorf("no text to generate speech from")
	}

	// If only one chunk, use regular generation
	if len(chunks) == 1 {
		return s.GenerateSpeech(chunks[0], voiceDescription)
	}

	// Generate audio for each chunk
	var audioDataList [][]byte
	for i, chunk := range chunks {
		log.Printf("Generating TTS for chunk %d/%d (%d chars)", i+1, len(chunks), len(chunk))

		audioURL, err := s.GenerateSpeech(chunk, voiceDescription)
		if err != nil {
			return "", fmt.Errorf("failed to generate speech for chunk %d: %w", i, err)
		}

		// Download audio
		audioData, err := s.DownloadAudio(audioURL)
		if err != nil {
			return "", fmt.Errorf("failed to download audio for chunk %d: %w", i, err)
		}

		audioDataList = append(audioDataList, audioData)
	}

	// Concatenate all audio chunks
	return s.concatenateAudio(audioDataList)
}

// GenerateChunkedSpeechBackground handles long text by chunking and concatenating audio using background client
func (s *WaveSpeedService) GenerateChunkedSpeechBackground(unifiedText, voiceDescription string) (string, error) {
	return s.GenerateChunkedSpeechBackgroundWithVoice(unifiedText, "", voiceDescription, "")
}

// GenerateChunkedSpeechBackgroundWithVoice handles long text by chunking with explicit voice and style
func (s *WaveSpeedService) GenerateChunkedSpeechBackgroundWithVoice(unifiedText, voice, styleInstruction, language string) (string, error) {
	// Chunk the text
	chunks := ChunkText(unifiedText, MaxTTSTextLength)
	log.Printf("Chunking text into %d chunks for TTS (background)", len(chunks))

	if len(chunks) == 0 {
		return "", fmt.Errorf("no text to generate speech from")
	}

	// If only one chunk, use background generation
	if len(chunks) == 1 {
		return s.GenerateSpeechWithVoice(chunks[0], voice, styleInstruction, language)
	}

	// Generate audio for each chunk using background client
	var audioDataList [][]byte
	for i, chunk := range chunks {
		log.Printf("Generating TTS for chunk %d/%d (%d chars)", i+1, len(chunks), len(chunk))

		audioURL, err := s.GenerateSpeechWithVoice(chunk, voice, styleInstruction, language)
		if err != nil {
			return "", fmt.Errorf("failed to generate speech for chunk %d: %w", i, err)
		}

		// Download audio
		audioData, err := s.DownloadAudio(audioURL)
		if err != nil {
			return "", fmt.Errorf("failed to download audio for chunk %d: %w", i, err)
		}

		audioDataList = append(audioDataList, audioData)
	}

	// Concatenate all audio chunks
	return s.concatenateAudio(audioDataList)
}

// GenerateSpeechBackground generates speech using background client without timeout
func (s *WaveSpeedService) GenerateSpeechBackground(text, voiceDescription string) (string, error) {
	return s.GenerateSpeechWithVoice(text, "", voiceDescription, "")
}

// concatenateAudio concatenates multiple audio files into one
func (s *WaveSpeedService) concatenateAudio(audioDataList [][]byte) (string, error) {
	if len(audioDataList) == 0 {
		return "", fmt.Errorf("no audio data to concatenate")
	}

	if len(audioDataList) == 1 {
		// Save to temp file and return URL-like path
		tempFile := filepath.Join(os.TempDir(), fmt.Sprintf("tts_concatenated_%d.wav", time.Now().UnixNano()))
		if err := os.WriteFile(tempFile, audioDataList[0], 0644); err != nil {
			return "", fmt.Errorf("failed to write audio: %w", err)
		}
		return tempFile, nil
	}

	// Write all audio chunks to temp files
	var tempFiles []string
	for i, data := range audioDataList {
		tempFile := filepath.Join(os.TempDir(), fmt.Sprintf("tts_chunk_%d_%d.wav", i, time.Now().UnixNano()))
		if err := os.WriteFile(tempFile, data, 0644); err != nil {
			// Cleanup on error
			for _, f := range tempFiles {
				os.Remove(f)
			}
			return "", fmt.Errorf("failed to write audio chunk %d: %w", i, err)
		}
		tempFiles = append(tempFiles, tempFile)
	}

	// Create concat file
	concatFile := filepath.Join(os.TempDir(), fmt.Sprintf("tts_concat_%d.txt", time.Now().UnixNano()))
	var concatLines []string
	for _, f := range tempFiles {
		concatLines = append(concatLines, "file '"+f+"'")
	}
	concatContent := strings.Join(concatLines, "\n")
	if err := os.WriteFile(concatFile, []byte(concatContent), 0644); err != nil {
		for _, f := range tempFiles {
			os.Remove(f)
		}
		return "", fmt.Errorf("failed to write concat file: %w", err)
	}

	// Concatenate using FFmpeg
	outputFile := filepath.Join(os.TempDir(), fmt.Sprintf("tts_concatenated_%d.wav", time.Now().UnixNano()))
	cmd := exec.Command("ffmpeg",
		"-f", "concat",
		"-safe", "0",
		"-i", concatFile,
		"-c", "copy",
		"-y",
		outputFile,
	)

	if output, err := cmd.CombinedOutput(); err != nil {
		for _, f := range tempFiles {
			os.Remove(f)
		}
		os.Remove(concatFile)
		return "", fmt.Errorf("ffmpeg concat failed: %w\noutput: %s", err, string(output))
	}

	// Cleanup temp files
	for _, f := range tempFiles {
		os.Remove(f)
	}
	os.Remove(concatFile)

	return outputFile, nil
}

// GenerateCaptionsFromAudio uses WaveSpeed Whisper to generate accurate captions
// Returns caption segments with word-level timestamps for kinetic caption display
func (s *WaveSpeedService) GenerateCaptionsFromAudio(audioURL string) ([]CaptionSegment, error) {
	if s.cfg.WavespeedAPIKey == "" {
		// Return placeholder in dev
		return []CaptionSegment{
			{Index: 0, Text: "Caption generation not available in dev mode", StartTime: 0, EndTime: 5},
		}, nil
	}

	reqBody := WaveSpeedWhisperRequest{
		Audio:            audioURL,
		Model:            "wavespeed-ai/openai-whisper",
		EnableTimestamps: true,
		EnableSyncMode:   true,
		Language:         "auto",
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal Whisper request: %w", err)
	}

	req, err := http.NewRequest("POST", "https://api.wavespeed.ai/api/v3/wavespeed-ai/openai-whisper", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create Whisper request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.cfg.WavespeedAPIKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send Whisper request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("wavespeed Whisper API error: %d - %s", resp.StatusCode, string(respBody))
	}

	// Read response body for debugging
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read Whisper response body: %w", err)
	}
	log.Printf("[Whisper] Raw response body: %s", string(respBody))

	var result WaveSpeedWhisperResponseWrapper
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("failed to decode Whisper response: %w", err)
	}

	// Check for API error (code 0 means success)
	if result.Code != 0 && result.Code != 200 {
		return nil, fmt.Errorf("wavespeed Whisper API error: %s", result.Message)
	}

	// Return the segments from the response
	// Priority: Outputs[0].TextDetails (new format) > Data.TextDetails > Segments > SRT parsing

	// Check outputs array inside Data (API format: result.Data.Outputs)
	var textDetails []CaptionSegment
	var srtContent string
	var fullText string

	log.Printf("[Whisper] Raw response: Code=%d, Data.Outputs count=%d", result.Code, len(result.Data.Outputs))

	if len(result.Data.Outputs) > 0 {
		log.Printf("[Whisper] Output[0]: TextDetails count=%d, SRT len=%d, Text len=%d",
			len(result.Data.Outputs[0].TextDetails), len(result.Data.Outputs[0].SRT), len(result.Data.Outputs[0].Text))
		textDetails = result.Data.Outputs[0].TextDetails
		srtContent = result.Data.Outputs[0].SRT
		fullText = result.Data.Outputs[0].Text
	} else {
		// Fall back to legacy fields in Data
		log.Printf("[Whisper] Using Data fields: TextDetails count=%d", len(result.Data.TextDetails))
		textDetails = result.Data.TextDetails
		srtContent = result.Data.SRT
		fullText = result.Data.Text
	}

	if len(textDetails) > 0 {
		log.Printf("[Whisper] Using TextDetails: %d segments", len(textDetails))
		return textDetails, nil
	}

	if len(result.Data.Segments) > 0 {
		log.Printf("[Whisper] Using Segments: %d segments", len(result.Data.Segments))
		return result.Data.Segments, nil
	}

	// Fall back to SRT parsing if available
	if srtContent != "" {
		log.Printf("[Whisper] Falling back to SRT parsing")
		segments, err := parseSRT(srtContent)
		if err == nil && len(segments) > 0 {
			return segments, nil
		}
		log.Printf("[Whisper] SRT parsing failed: %v", err)
	}

	// If no segments, return single segment with full text
	return []CaptionSegment{
		{
			Index:     0,
			Text:      fullText,
			StartTime: 0,
			EndTime:   0, // Unknown duration
		},
	}, nil
}

// DownloadAudio downloads audio from a URL
func (s *WaveSpeedService) DownloadAudio(audioURL string) ([]byte, error) {
	if audioURL == "PLACEHOLDER_AUDIO" {
		return []byte("PLACEHOLDER_AUDIO"), nil
	}

	req, err := http.NewRequest("GET", audioURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create download request: %w", err)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to download audio: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to download audio: status %d", resp.StatusCode)
	}

	return io.ReadAll(resp.Body)
}

// GetAudioDuration returns the duration of an audio file in seconds using FFprobe
func (s *WaveSpeedService) GetAudioDuration(audioPath string) (float64, error) {
	if audioPath == "" || audioPath == "PLACEHOLDER_AUDIO" {
		// Return default duration for placeholder
		return 5.0, nil
	}

	// Check if file exists
	if _, err := os.Stat(audioPath); os.IsNotExist(err) {
		return 0, fmt.Errorf("audio file does not exist: %s", audioPath)
	}

	// Use ffprobe to get duration
	cmd := exec.Command("ffprobe",
		"-i", audioPath,
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		"-v", "error",
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("ffprobe failed: %w\noutput: %s", err, string(output))
	}

	// Parse the output (it's the duration in seconds as a string)
	durationStr := strings.TrimSpace(string(output))
	if durationStr == "" {
		return 0, fmt.Errorf("ffprobe returned empty duration")
	}

	duration, err := strconv.ParseFloat(durationStr, 64)
	if err != nil {
		return 0, fmt.Errorf("failed to parse duration: %w", err)
	}

	return duration, nil
}

// TTSBroadcaster interface for broadcasting TTS progress
type TTSBroadcaster interface {
	BroadcastStep(videoID uint64, phase, step string, progress int, message string)
	BroadcastError(videoID uint64, phase, step, errorMsg string)
}

// GenerateSpeechParallel generates speech for all segments concurrently using goroutines
// Saves audio files to the specified output directory
// Uses WaitGroup to coordinate and broadcasts progress for each chunk
func (s *WaveSpeedService) GenerateSpeechParallel(
	segments []TranscriptSegment,
	voiceDescription, outputDir string,
	broadcaster TTSBroadcaster,
	videoID uint64,
) error {
	total := len(segments)
	if total == 0 {
		return nil
	}

	// Create output directory if it doesn't exist
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	completed := 0
	errors := make([]error, 0)

	// Create a semaphore to limit concurrent TTS generations
	semaphore := make(chan struct{}, 3) // Max 3 concurrent TTS generations

	for i := range segments {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()

			// Acquire semaphore
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			// Get the text to convert - use translated text if available, otherwise original
			text := segments[index].TranslatedText
			if text == "" {
				text = segments[index].OriginalText
			}

			// Generate speech
			audioURL, err := s.GenerateSpeech(text, voiceDescription)
			if err != nil {
				mu.Lock()
				log.Printf("TTS error for segment %d: %v", index, err)
				errors = append(errors, fmt.Errorf("segment %d: %w", index, err))
				if broadcaster != nil {
					broadcaster.BroadcastError(videoID, "tts", "tts_chunk",
						fmt.Sprintf("Failed to generate audio for chunk %d/%d: %v", index+1, total, err))
				}
				mu.Unlock()
				return
			}

			// Download the audio
			audioData, err := s.DownloadAudio(audioURL)
			if err != nil {
				mu.Lock()
				log.Printf("Audio download error for segment %d: %v", index, err)
				errors = append(errors, fmt.Errorf("segment %d: %w", index, err))
				if broadcaster != nil {
					broadcaster.BroadcastError(videoID, "tts", "tts_chunk",
						fmt.Sprintf("Failed to download audio for chunk %d/%d: %v", index+1, total, err))
				}
				mu.Unlock()
				return
			}

			// Save audio to file
			audioPath := filepath.Join(outputDir, fmt.Sprintf("chunk_%d.wav", index))
			if err := os.WriteFile(audioPath, audioData, 0644); err != nil {
				mu.Lock()
				log.Printf("Failed to save audio for segment %d: %v", index, err)
				errors = append(errors, fmt.Errorf("segment %d: %w", index, err))
				if broadcaster != nil {
					broadcaster.BroadcastError(videoID, "tts", "tts_chunk",
						fmt.Sprintf("Failed to save audio for chunk %d/%d: %v", index+1, total, err))
				}
				mu.Unlock()
				return
			}

			mu.Lock()
			segments[index].AudioPath = audioPath
			completed++

			// Broadcast progress for this chunk
			if broadcaster != nil {
				broadcaster.BroadcastStep(videoID, "tts", "tts_chunk",
					(completed*100)/total,
					fmt.Sprintf("Generated audio for chunk %d/%d", index+1, total))
			}

			log.Printf("Generated audio for segment %d/%d: %s", index+1, total, audioPath)
			mu.Unlock()
		}(i)
	}

	wg.Wait()

	if len(errors) > 0 {
		log.Printf("TTS generation completed with %d errors out of %d segments", len(errors), total)
	}

	log.Printf("Parallel TTS complete: %d/%d segments processed", completed, total)
	return nil
}

// parseSRT parses SRT format and returns caption segments
// SRT format:
// 1
// 00:00:00,000 --> 00:00:04,040
// The text here
//
// 2
// 00:00:04,560 --> 00:00:09,900
// More text here
func parseSRT(srtContent string) ([]CaptionSegment, error) {
	var segments []CaptionSegment

	lines := strings.Split(srtContent, "\n")
	i := 0

	// Regex for SRT timestamp: HH:MM:SS,mmm --> HH:MM:SS,mmm
	timestampRegex := regexp.MustCompile(`(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})`)

	for i < len(lines) {
		line := strings.TrimSpace(lines[i])

		// Skip empty lines
		if line == "" {
			i++
			continue
		}

		// Check if this is an index line (just a number)
		if matched, _ := regexp.MatchString(`^\d+$`, line); matched {
			i++
			continue
		}

		// Try to match timestamp line
		matches := timestampRegex.FindStringSubmatch(line)
		if matches != nil {
			// Parse start time
			startHours, _ := strconv.Atoi(matches[1])
			startMinutes, _ := strconv.Atoi(matches[2])
			startSeconds, _ := strconv.Atoi(matches[3])
			startMillis, _ := strconv.Atoi(matches[4])
			startTime := float64(startHours*3600+startMinutes*60+startSeconds) + float64(startMillis)/1000

			// Parse end time
			endHours, _ := strconv.Atoi(matches[5])
			endMinutes, _ := strconv.Atoi(matches[6])
			endSeconds, _ := strconv.Atoi(matches[7])
			endMillis, _ := strconv.Atoi(matches[8])
			endTime := float64(endHours*3600+endMinutes*60+endSeconds) + float64(endMillis)/1000

			// Get text from the next line (not same line)
			segmentText := ""
			if i+1 < len(lines) {
				nextLine := strings.TrimSpace(lines[i+1])
				// Skip empty lines to find actual text
				for nextLine == "" && i+2 < len(lines) {
					i++
					nextLine = strings.TrimSpace(lines[i+1])
				}
				segmentText = nextLine
			}

			// Skip empty text
			if segmentText != "" {
				segments = append(segments, CaptionSegment{
					Index:     len(segments),
					Text:      segmentText,
					StartTime: startTime,
					EndTime:   endTime,
				})
			}

			i += 2 // Skip timestamp line and text line
			continue
		}

		i++
	}

	return segments, nil
}
