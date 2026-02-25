package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"

	"video-generator/internal/config"
)

type OpenRouterService struct {
	cfg    *config.Config
	client *http.Client
}

type OpenRouterMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type OpenRouterRequest struct {
	Model    string               `json:"model"`
	Messages []OpenRouterMessage  `json:"messages"`
}

type OpenRouterResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func NewOpenRouterService(cfg *config.Config) *OpenRouterService {
	return &OpenRouterService{
		cfg:    cfg,
		client: &http.Client{},
	}
}

func (s *OpenRouterService) TranslateText(text, sourceLang, targetLang string) (string, error) {
	if s.cfg.OpenRouterAPIKey == "" {
		// Return placeholder translation in dev
		return fmt.Sprintf("[Translated to %s] %s", targetLang, text), nil
	}

	prompt := fmt.Sprintf(`Translate the following text from %s to %s. Only respond with the translation, nothing else:

%s`, sourceLang, targetLang, text)

	reqBody := OpenRouterRequest{
		Model: "google/gemini-2.0-flash-001",
		Messages: []OpenRouterMessage{
			{Role: "user", Content: prompt},
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", "https://openrouter.ai/api/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.cfg.OpenRouterAPIKey)
	req.Header.Set("HTTP-Referer", "https://video-generator.local")
	req.Header.Set("X-Title", "Video Generator")

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("openrouter API error: %d - %s", resp.StatusCode, string(respBody))
	}

	var result OpenRouterResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	if len(result.Choices) == 0 {
		return "", fmt.Errorf("no translation returned from API")
	}

	return result.Choices[0].Message.Content, nil
}

func (s *OpenRouterService) TranslateTexts(texts []string, sourceLang, targetLang string) ([]string, error) {
	results := make([]string, len(texts))

	for i, text := range texts {
		translated, err := s.TranslateText(text, sourceLang, targetLang)
		if err != nil {
			return nil, fmt.Errorf("failed to translate text %d: %w", i, err)
		}
		results[i] = translated
	}

	return results, nil
}

// TranslateUnifiedText translates the entire transcript as one piece
// This provides better context and coherence than translating segment-by-segment
// If text exceeds API limits, automatically chunks and combines translations
func (s *OpenRouterService) TranslateUnifiedText(unifiedText, sourceLang, targetLang string) (string, error) {
	// Check if text needs chunking (OpenRouter has limits, use conservative 10000 chars)
	if len(unifiedText) > MaxTranslationChars {
		return s.TranslateChunkedText(unifiedText, sourceLang, targetLang)
	}
	return s.TranslateText(unifiedText, sourceLang, targetLang)
}

// TranslateChunkedText handles long text by chunking and combining translations
func (s *OpenRouterService) TranslateChunkedText(unifiedText, sourceLang, targetLang string) (string, error) {
	// Chunk the text
	chunks := ChunkText(unifiedText, MaxTranslationChars)
	log.Printf("Chunking translation text into %d chunks", len(chunks))

	if len(chunks) == 0 {
		return "", fmt.Errorf("no text to translate")
	}

	// If only one chunk, use regular translation
	if len(chunks) == 1 {
		return s.TranslateText(chunks[0], sourceLang, targetLang)
	}

	// Translate each chunk
	var translations []string
	for i, chunk := range chunks {
		log.Printf("Translating chunk %d/%d (%d chars)", i+1, len(chunks), len(chunk))

		translated, err := s.TranslateText(chunk, sourceLang, targetLang)
		if err != nil {
			return "", fmt.Errorf("failed to translate chunk %d: %w", i, err)
		}

		translations = append(translations, translated)
	}

	// Combine translations
	return strings.Join(translations, " "), nil
}

// TTSRequest and TTSResponse structures
type TTSRequest struct {
	Model   string `json:"model"`
	Input   string `json:"input"`
	Voice   string `json:"voice"`
	Speed   float64 `json:"speed,omitempty"`
}

type TTSResponse struct {
	AudioData string `json:"audio_data,omitempty"`
}

func (s *OpenRouterService) GenerateSpeech(text, voice string) ([]byte, error) {
	if s.cfg.OpenRouterAPIKey == "" {
		// Return placeholder audio in dev
		return []byte("PLACEHOLDER_AUDIO"), nil
	}

	// Use OpenAI TTS-1 model via OpenRouter
	reqBody := map[string]interface{}{
		"model": "openai/tts-1",
		"input": text,
		"voice": voice,
		"speed": 1.0,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", "https://openrouter.ai/api/v1/audio/speech", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.cfg.OpenRouterAPIKey)
	req.Header.Set("HTTP-Referer", "https://video-generator.local")
	req.Header.Set("X-Title", "Video Generator")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("openrouter TTS API error: %d - %s", resp.StatusCode, string(respBody))
	}

	return io.ReadAll(resp.Body)
}

// TranslationBroadcaster interface for broadcasting translation progress
type TranslationBroadcaster interface {
	BroadcastStep(videoID uint64, phase, step string, progress int, message string)
	BroadcastError(videoID uint64, phase, step, errorMsg string)
}

// TranslateSegmentsParallel translates all segments concurrently using goroutines
// Uses WaitGroup to coordinate and broadcasts progress for each chunk
func (s *OpenRouterService) TranslateSegmentsParallel(
	segments []TranscriptSegment,
	sourceLang, targetLang string,
	broadcaster TranslationBroadcaster,
	videoID uint64,
) error {
	total := len(segments)
	if total == 0 {
		return nil
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	completed := 0
	errors := make([]error, 0)

	// Create a semaphore to limit concurrent translations
	semaphore := make(chan struct{}, 5) // Max 5 concurrent translations

	for i := range segments {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()

			// Acquire semaphore
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			// Translate the segment
			translated, err := s.TranslateText(segments[index].OriginalText, sourceLang, targetLang)

			mu.Lock()
			defer mu.Unlock()

			if err != nil {
				log.Printf("Translation error for segment %d: %v", index, err)
				errors = append(errors, fmt.Errorf("segment %d: %w", index, err))
				// Broadcast error for this chunk
				if broadcaster != nil {
					broadcaster.BroadcastError(videoID, "translating", "translate_chunk",
						fmt.Sprintf("Failed to translate chunk %d/%d: %v", index+1, total, err))
				}
				return
			}

			segments[index].TranslatedText = translated
			completed++

			// Broadcast progress for this chunk
			if broadcaster != nil {
				broadcaster.BroadcastStep(videoID, "translating", "translate_chunk",
					(completed*100)/total,
					fmt.Sprintf("Translated chunk %d/%d", index+1, total))
			}

			log.Printf("Translated segment %d/%d", index+1, total)
		}(i)
	}

	wg.Wait()

	if len(errors) > 0 {
		// Log errors but don't fail completely if some translations succeeded
		log.Printf("Translation completed with %d errors out of %d segments", len(errors), total)
	}

	log.Printf("Parallel translation complete: %d/%d segments translated", completed, total)
	return nil
}
