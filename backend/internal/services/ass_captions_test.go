package services

import (
	"os"
	"strings"
	"testing"
)

func TestGenerateASSFile(t *testing.T) {
	segments := []CaptionSegment{
		{Text: "Hello world", StartTime: 1.0, EndTime: 3.0},
		{Text: "This is a test", StartTime: 4.0, EndTime: 6.0},
	}
	config := DefaultKineticConfig()
	outputPath := "/tmp/test_captions.ass"

	err := GenerateASSFile(segments, config, outputPath, 1920, 1080)
	if err != nil {
		t.Fatalf("GenerateASSFile failed: %v", err)
	}
	defer os.Remove(outputPath)

	// Read and verify the file content
	content, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("Failed to read ASS file: %v", err)
	}

	contentStr := string(content)

	// Check Script Info section
	if !strings.Contains(contentStr, "[Script Info]") {
		t.Error("Missing Script Info section")
	}
	if !strings.Contains(contentStr, "WrapStyle: 1") {
		t.Error("Missing WrapStyle: 1")
	}

	// Check Styles section
	if !strings.Contains(contentStr, "[V4+ Styles]") {
		t.Error("Missing V4+ Styles section")
	}
	if !strings.Contains(contentStr, "Style: Kinetic") {
		t.Error("Missing Kinetic style")
	}

	// Check Events section
	if !strings.Contains(contentStr, "[Events]") {
		t.Error("Missing Events section")
	}
	if !strings.Contains(contentStr, "Format: Layer, Start, End") {
		t.Error("Missing Events format line")
	}

	// Check dialogue lines with correct timestamps
	if !strings.Contains(contentStr, "Dialogue: 0,0:00:01.00,0:00:03.00") {
		t.Error("Missing first dialogue line with correct timing")
	}
	if !strings.Contains(contentStr, "Dialogue: 0,0:00:04.00,0:00:06.00") {
		t.Error("Missing second dialogue line with correct timing")
	}

	// Check fade animation tags are present
	if !strings.Contains(contentStr, "\\fad(") {
		t.Error("Missing fade animation tags")
	}
}

func TestFormatASSTime(t *testing.T) {
	tests := []struct {
		input    float64
		expected string
	}{
		{0.0, "0:00:00.00"},
		{1.5, "0:00:01.50"},
		{65.25, "0:01:05.25"},
		{3661.9, "1:01:01.90"},
	}

	for _, tt := range tests {
		result := FormatASSTime(tt.input)
		if result != tt.expected {
			t.Errorf("FormatASSTime(%f) = %q; want %q", tt.input, result, tt.expected)
		}
	}
}

func TestBuildASSStyle(t *testing.T) {
	config := DefaultKineticConfig()
	style := BuildASSStyle(config, 1920, 1080)

	// Check style contains expected components
	if !strings.Contains(style, "Style: Kinetic") {
		t.Error("Missing Style name")
	}
	if !strings.Contains(style, "DejaVuSans") {
		t.Error("Missing font name")
	}
	if !strings.Contains(style, ",90,") {
		t.Error("Missing font size 90")
	}
	if !strings.Contains(style, ",2,") && !strings.Contains(style, ",5,") && !strings.Contains(style, ",8,") {
		t.Error("Missing alignment")
	}
}
