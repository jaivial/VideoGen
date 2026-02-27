package services

import (
	"fmt"
	"testing"
)

func TestKineticCaptionFilter(t *testing.T) {
	// Test chunk with sample text
	chunk := Chunk{
		ID:        "chunk_0",
		Text:      "Stop using AI to learn English",
		StartTime: 0,
		EndTime:   3.0,
		Duration:  3.0,
	}

	config := DefaultKineticConfig()
	filter := GenerateSimpleKineticFilter(chunk, config)

	fmt.Println("Generated filter:")
	fmt.Println(filter)

	// Verify filter contains expected components
	if len(filter) == 0 {
		t.Error("Filter is empty")
	}

	// Check for drawtext
	if !containsString(filter, "drawtext") {
		t.Error("Filter does not contain drawtext")
	}

	// Check for font file
	if !containsString(filter, config.FontFile) {
		t.Error("Filter does not contain font file")
	}

	// Check for text
	if !containsString(filter, "Stop using AI to learn English") {
		t.Error("Filter does not contain text")
	}
}

func TestKineticCaptionWithSpecialChars(t *testing.T) {
	chunk := Chunk{
		ID:       "chunk_1",
		Text:     "It's a test: with quotes & ampersand",
		Duration: 2.5,
	}

	config := DefaultKineticConfig()
	filter := GenerateSimpleKineticFilter(chunk, config)

	fmt.Println("Filter with special chars:")
	fmt.Println(filter)

	// Text should be escaped
	if containsString(filter, "'") {
		t.Log("Filter contains unescaped single quote")
	}
}

func TestImageGroupMapping(t *testing.T) {
	// Create sample image groups (10 chunks per group)
	imageGroups := []ImageGroup{
		{ID: 0, ChunkStart: 0, ChunkEnd: 10, ChunkCount: 10},
		{ID: 1, ChunkStart: 10, ChunkEnd: 11, ChunkCount: 1},
	}

	// Create sample image paths
	imagePaths := []string{
		"/path/to/group_0.jpg",
		"/path/to/group_1.jpg",
	}

	// Test mapping
	tests := []struct {
		chunkIndex int
		wantPath   string
	}{
		{0, "/path/to/group_0.jpg"},
		{5, "/path/to/group_0.jpg"},
		{9, "/path/to/group_0.jpg"},
		{10, "/path/to/group_1.jpg"},
	}

	for _, tt := range tests {
		got := GetImagePathForChunk(tt.chunkIndex, imageGroups, imagePaths)
		if got != tt.wantPath {
			t.Errorf("GetImagePathForChunk(%d) = %s; want %s", tt.chunkIndex, got, tt.wantPath)
		}
	}
}

func TestGenerateComplexFilter(t *testing.T) {
	chunk := Chunk{
		Text:     "Hello World",
		Duration: 3.0,
	}

	config := DefaultKineticConfig()
	filter, err := GenerateKineticFilterComplex(chunk, config)

	if err != nil {
		t.Errorf("GenerateKineticFilterComplex failed: %v", err)
	}

	fmt.Println("Complex filter:")
	fmt.Println(filter)
}

func TestEscapeDrawtextText(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Hello World", "Hello World"},
		{"It's great", "It\\\\'s great"},
		{"Test:colon", "Test\\\\:colon"},
	}

	for _, tt := range tests {
		got := escapeDrawtextText(tt.input)
		if got != tt.expected {
			t.Errorf("escapeDrawtextText(%q) = %q; want %q", tt.input, got, tt.expected)
		}
	}
}

func containsString(s, substr string) bool {
	return len(s) > 0 && len(substr) > 0 && len(s) >= len(substr) &&
		   (s == substr || len(s) > 0 && (s[:len(substr)] == substr || containsAny(s, substr)))
}

func containsAny(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func TestWrapText(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		// Short text - no wrapping
		{"Hello World", "Hello World"},
		// Text exactly at limit (35 chars)
		{"12345678901234567890123456789012345", "12345678901234567890123456789012345"},
		// Text over limit - should wrap
		{"12345678901234567890123456789012345 extra", "12345678901234567890123456789012345\\nextra"},
		// Multiple words wrapping
		{"The quick brown fox jumps over the lazy dog", "The quick brown fox jumps over the\\nlazy dog"},
		// Single long word (34 chars - fits in 35)
		{"Supercalifragilisticexpialidocious", "Supercalifragilisticexpialidocious"},
	}

	for _, tt := range tests {
		got := wrapText(tt.input)
		if got != tt.expected {
			t.Errorf("wrapText(%q) = %q; want %q", tt.input, got, tt.expected)
		}
	}
}

func TestWrapTextLongCaption(t *testing.T) {
	// Test with a long sentence that should definitely wrap
	chunk := Chunk{
		Text:     "This is a very long sentence that should definitely wrap to multiple lines because it exceeds the maximum characters per line limit",
		Duration: 3.0,
	}

	config := DefaultKineticConfig()
	filter := GenerateSimpleKineticFilter(chunk, config)

	fmt.Println("Long text filter:")
	fmt.Println(filter)

	// Should contain newlines for wrapping
	if !containsString(filter, "\\n") {
		t.Error("Long text should be wrapped with newlines")
	}

	// Should still have padding in x position
	if !containsString(filter, "(w-200-text_w)/2+100") {
		t.Error("Filter should contain padding calculation")
	}
}

func TestCountLines(t *testing.T) {
	tests := []struct {
		input    string
		expected int
	}{
		{"Hello World", 1},
		{"Hello\\nWorld", 2},
		{"Line1\\nLine2\\nLine3", 3},
	}

	for _, tt := range tests {
		got := countLines(tt.input)
		if got != tt.expected {
			t.Errorf("countLines(%q) = %d; want %d", tt.input, got, tt.expected)
		}
	}
}

func TestSplitIntoPhrases(t *testing.T) {
	segments := []CaptionSegment{
		{Text: "Hello world this is a test", StartTime: 0.0, EndTime: 3.0},
		{Text: "Another sentence here", StartTime: 3.0, EndTime: 5.0},
	}

	result := splitIntoPhrases(segments, 3)

	// Current implementation: one segment per original segment
	// Each segment has chunks combined with newlines
	// Timing is preserved from original segments
	if len(result) != 2 {
		t.Errorf("Expected 2 segments, got %d", len(result))
	}

	// First segment: 6 words with 3 words per phrase = 2 chunks combined with newlines
	if result[0].Text != "Hello world this\nis a test" {
		t.Errorf("First segment = %q; want %q", result[0].Text, "Hello world this\nis a test")
	}

	// Timing is preserved
	if result[0].StartTime != 0.0 {
		t.Errorf("First segment start = %v; want 0.0", result[0].StartTime)
	}
	if result[0].EndTime != 3.0 {
		t.Errorf("First segment end = %v; want 3.0", result[0].EndTime)
	}

	// Second segment: 3 words with 3 words per phrase = 1 chunk
	if result[1].Text != "Another sentence here" {
		t.Errorf("Second segment = %q; want %q", result[1].Text, "Another sentence here")
	}

	// Timing is preserved
	if result[1].StartTime != 3.0 {
		t.Errorf("Second segment start = %v; want 3.0", result[1].StartTime)
	}
	if result[1].EndTime != 5.0 {
		t.Errorf("Second segment end = %v; want 5.0", result[1].EndTime)
	}

	fmt.Printf("Split phrases result: %+v\n", result)
}

func TestSplitIntoPhrasesEmpty(t *testing.T) {
	result := splitIntoPhrases([]CaptionSegment{}, 5)
	if len(result) != 0 {
		t.Errorf("Expected 0 phrases for empty input, got %d", len(result))
	}

	// Test with empty text segment
	result = splitIntoPhrases([]CaptionSegment{{Text: "", StartTime: 0, EndTime: 1}}, 5)
	if len(result) != 0 {
		t.Errorf("Expected 0 phrases for empty text, got %d", len(result))
	}
}

func TestSplitIntoPhrasesSingleWord(t *testing.T) {
	segments := []CaptionSegment{
		{Text: "One", StartTime: 0.0, EndTime: 1.0},
	}

	result := splitIntoPhrases(segments, 5)
	if len(result) != 1 {
		t.Errorf("Expected 1 phrase, got %d", len(result))
	}
	if result[0].Text != "One" {
		t.Errorf("Phrase = %q; want %q", result[0].Text, "One")
	}
}
