package services

import (
	"fmt"
	"strings"
)

// HorizontalPadding defines the padding on left/right edges in pixels
const HorizontalPadding = 100

// MaxCharsPerLine defines maximum characters per line for text wrapping
// At 72pt DejaVu Sans, roughly 10 chars per 100px, so ~82 chars per line with padding
const MaxCharsPerLine = 35

// MaxLines defines maximum number of lines per caption
const MaxLines = 3

// KineticCaptionConfig holds styling configuration for kinetic captions
type KineticCaptionConfig struct {
	FontFile     string  // Path to font file
	FontSize     int     // Font size in points
	FontColor    string  // Main text color (e.g., "white")
	BorderWidth  int     // Border/stroke width in pixels
	BorderColor  string  // Border color (e.g., "black")
	Position     string  // Position: "center", "top", "bottom"
	AnimationIn  float64 // Fade in duration in seconds
	AnimationOut float64 // Fade out duration in seconds
	YOffset      int     // Y offset from position (negative moves up)
}

// DefaultKineticConfig returns default configuration for kinetic captions
func DefaultKineticConfig() KineticCaptionConfig {
	return KineticCaptionConfig{
		FontFile:    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
		FontSize:    90,
		FontColor:   "white",
		BorderWidth: 3,
		BorderColor: "black",
		Position:    "center",
		AnimationIn: 0.3,
		AnimationOut: 0.3,
		YOffset:     100, // Slightly above center for better visibility
	}
}

// GenerateKineticFilterComplex generates FFmpeg filter_complex for kinetic caption animation
// Returns the filter_complex string and filter inputs
func GenerateKineticFilterComplex(chunk Chunk, config KineticCaptionConfig) (string, error) {
	// Wrap text and escape for FFmpeg
	wrappedText := wrapText(chunk.Text)
	text := escapeDrawtextText(wrappedText)
	duration := chunk.Duration
	if duration <= 0 {
		duration = 3.0 // Default duration
	}

	// Calculate animation timings
	animIn := config.AnimationIn
	animOut := config.AnimationOut
	holdStart := animIn
	holdEnd := duration - animOut

	// Determine position
	xPos, yPos := getPositionCoords(config.Position, config.YOffset)

	// Build filter parts
	var filterParts []string

	// 1. Fade in: alpha 0 -> 1 from t=0 to t=animIn
	fadeInFilter := fmt.Sprintf(
		"drawtext=fontfile='%s':text='%s':fontcolor=%s:fontsize=%d:borderw=%d:bordercolor=%s:x=%s:y=%s:enable='between(t,0,%f)':alpha=eval=t/%f",
		config.FontFile, text, config.FontColor, config.FontSize, config.BorderWidth, config.BorderColor,
		xPos, yPos, animIn, animIn,
	)

	// 2. Hold: alpha = 1 from t=animIn to t=holdEnd
	holdFilter := fmt.Sprintf(
		"drawtext=fontfile='%s':text='%s':fontcolor=%s:fontsize=%d:borderw=%d:bordercolor=%s:x=%s:y=%s:enable='between(t,%f,%f)':alpha=1",
		config.FontFile, text, config.FontColor, config.FontSize, config.BorderWidth, config.BorderColor,
		xPos, yPos, holdStart, holdEnd,
	)

	// 3. Fade out: alpha 1 -> 0 from t=holdEnd to t=duration
	fadeOutFilter := fmt.Sprintf(
		"drawtext=fontfile='%s':text='%s':fontcolor=%s:fontsize=%d:borderw=%d:bordercolor=%s:x=%s:y=%s:enable='between(t,%f,%f)':alpha=eval:1-(t-%f)/%f",
		config.FontFile, text, config.FontColor, config.FontSize, config.BorderWidth, config.BorderColor,
		xPos, yPos, holdEnd, duration, holdEnd, animOut,
	)

	filterParts = append(filterParts, fadeInFilter, holdFilter, fadeOutFilter)

	return strings.Join(filterParts, ","), nil
}

// GenerateKineticFilterComplexWithScale generates a more dynamic kinetic caption with scale animation
// Uses zoom effect: starts small, zooms to full size, then fades out
func GenerateKineticFilterComplexWithScale(chunk Chunk, config KineticCaptionConfig) (string, error) {
	// Wrap text and escape for FFmpeg
	wrappedText := wrapText(chunk.Text)
	text := escapeDrawtextText(wrappedText)
	duration := chunk.Duration
	if duration <= 0 {
		duration = 3.0
	}

	// Calculate animation timings
	animIn := config.AnimationIn
	animOut := config.AnimationOut
	holdStart := animIn
	holdEnd := duration - animOut

	// Get position
	xPos, yPos := getPositionCoords(config.Position, config.YOffset)

	var filterParts []string

	// Scale animation: zoom in from 0.5 to 1.0 during fade in
	// Using text scaling through the fontsize parameter with enable expression
	scaleInFilter := fmt.Sprintf(
		"drawtext=fontfile='%s':text='%s':fontcolor=%s:fontsize=%d:borderw=%d:bordercolor=%s:x=%s:y=%s:enable='between(t,0,%f)':alpha=eval:t/%f:fontsize=eval:%d*(0.5+0.5*t/%f)",
		config.FontFile, text, config.FontColor, config.FontSize, config.BorderWidth, config.BorderColor,
		xPos, yPos, animIn, animIn, config.FontSize, animIn,
	)

	// Hold with full size
	holdFilter := fmt.Sprintf(
		"drawtext=fontfile='%s':text='%s':fontcolor=%s:fontsize=%d:borderw=%d:bordercolor=%s:x=%s:y=%s:enable='between(t,%f,%f)':alpha=1",
		config.FontFile, text, config.FontColor, config.FontSize, config.BorderWidth, config.BorderColor,
		xPos, yPos, holdStart, holdEnd,
	)

	// Fade out
	fadeOutFilter := fmt.Sprintf(
		"drawtext=fontfile='%s':text='%s':fontcolor=%s:fontsize=%d:borderw=%d:bordercolor=%s:x=%s:y=%s:enable='between(t,%f,%f)':alpha=eval:1-(t-%f)/%f",
		config.FontFile, text, config.FontColor, config.FontSize, config.BorderWidth, config.BorderColor,
		xPos, yPos, holdEnd, duration, holdEnd, animOut,
	)

	filterParts = append(filterParts, scaleInFilter, holdFilter, fadeOutFilter)

	return strings.Join(filterParts, ","), nil
}

// GenerateSimpleKineticFilter generates a simpler kinetic filter with just fade in/out
// More compatible across different FFmpeg versions
func GenerateSimpleKineticFilter(chunk Chunk, config KineticCaptionConfig) string {
	// Wrap text and escape for FFmpeg
	wrappedText := wrapText(chunk.Text)
	text := escapeDrawtextText(wrappedText)
	duration := chunk.Duration
	if duration <= 0 {
		duration = 3.0
	}

	animIn := config.AnimationIn
	animOut := config.AnimationOut
	holdStart := animIn
	holdEnd := duration - animOut

	xPos, yPos := getPositionCoords(config.Position, config.YOffset)

	// Single drawtext with complex enable expression
	// alpha = 0 when t < 0
	// alpha = t/animIn when 0 <= t < animIn
	// alpha = 1 when animIn <= t < holdEnd
	// alpha = 1 - (t - holdEnd)/animOut when holdEnd <= t < duration
	// alpha = 0 when t >= duration
	enableExpr := fmt.Sprintf(
		"if(lt(t,%f),0,if(lt(t,%f),%f/t,if(lt(t,%f),1,if(lt(t,%f),1-(t-%f)/%f,0))))",
		animIn, holdStart, 1.0/animIn, holdEnd, duration, holdEnd, animOut,
	)

	return fmt.Sprintf(
		"drawtext=fontfile='%s':text='%s':fontcolor=%s:fontsize=%d:borderw=%d:bordercolor=%s:x=%s:y=%s:enable='%s'",
		config.FontFile, text, config.FontColor, config.FontSize, config.BorderWidth, config.BorderColor,
		xPos, yPos, enableExpr,
	)
}

// wrapText wraps text into multiple lines based on MaxCharsPerLine and MaxLines
func wrapText(text string) string {
	words := strings.Fields(text)
	if len(words) == 0 {
		return text
	}

	var lines []string
	var currentLine strings.Builder

	for _, word := range words {
		// Handle words longer than MaxCharsPerLine by splitting them
		if len(word) > MaxCharsPerLine {
			// If there's content in currentLine, save it first
			if currentLine.Len() > 0 {
				lines = append(lines, currentLine.String())
				currentLine.Reset()
			}
			// Split long word into chunks
			for len(word) > MaxCharsPerLine {
				lines = append(lines, word[:MaxCharsPerLine])
				word = word[MaxCharsPerLine:]
			}
			// Add remaining part
			currentLine.WriteString(word)
			continue
		}

		if currentLine.Len()+len(word)+1 > MaxCharsPerLine && currentLine.Len() > 0 {
			lines = append(lines, currentLine.String())
			currentLine.Reset()

			// Check if we've reached max lines
			if len(lines) >= MaxLines {
				break
			}
		}
		if currentLine.Len() > 0 {
			currentLine.WriteString(" ")
		}
		currentLine.WriteString(word)
	}
	if currentLine.Len() > 0 && len(lines) < MaxLines {
		lines = append(lines, currentLine.String())
	}

	if len(lines) == 0 {
		return text
	}
	return strings.Join(lines, "\\n")
}

// countLines counts the number of lines in wrapped text
func countLines(text string) int {
	return strings.Count(text, "\\n") + 1
}

// escapeDrawtextText escapes special characters for FFmpeg drawtext
func escapeDrawtextText(text string) string {
	// FFmpeg drawtext supports actual newlines when escaped properly
	// First convert actual newlines to \n escape sequence for FFmpeg
	// (do this BEFORE escaping backslashes to avoid double-escaping)
	text = strings.ReplaceAll(text, "\n", "\\n")
	text = strings.ReplaceAll(text, "\r", "")

	// Then escape single quotes
	text = strings.ReplaceAll(text, "'", "\\'")
	// Then escape colons (special in drawtext)
	text = strings.ReplaceAll(text, ":", "\\:")
	// Finally escape any remaining backslashes (but not the \n we just added)
	// We need to be careful not to double-escape the \n sequences
	// Use a temporary placeholder for \n, escape, then restore
	text = strings.ReplaceAll(text, "\\n", "\x00TEMP_NEWLINE\x00")
	text = strings.ReplaceAll(text, "\\", "\\\\")
	text = strings.ReplaceAll(text, "\x00TEMP_NEWLINE\x00", "\\n")

	return text
}

// getPositionCoords returns x and y position expressions based on position config
// Uses HorizontalPadding for safe margins on left/right edges
func getPositionCoords(position string, yOffset int) (string, string) {
	// Center horizontally with padding: (w - 2*padding - text_w) / 2 + padding
	xPos := fmt.Sprintf("(w-%d-text_w)/2+%d", HorizontalPadding*2, HorizontalPadding)

	var yPos string
	switch position {
	case "top":
		yPos = fmt.Sprintf("h-text_h-%d", yOffset)
	case "bottom":
		yPos = fmt.Sprintf("%d", yOffset)
	case "center":
		yPos = fmt.Sprintf("(h-text_h)/2+%d", yOffset)
	default:
		yPos = fmt.Sprintf("(h-text_h)/2+%d", yOffset)
	}

	return xPos, yPos
}

// BuildKineticVideoCommand builds the FFmpeg command for generating a video with kinetic captions
func BuildKineticVideoCommand(imagePath, audioPath, outputPath string, chunk Chunk, config KineticCaptionConfig) []string {
	duration := chunk.Duration
	if duration <= 0 {
		duration = 3.0
	}

	// Generate the filter
	filterComplex := GenerateSimpleKineticFilter(chunk, config)

	cmd := []string{
		"-loop", "1",
		"-i", imagePath,
		"-i", audioPath,
		"-vf", fmt.Sprintf("scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,%s", filterComplex),
		"-c:v", "libx264",
		"-preset", "fast",
		"-crf", "23",
		"-c:a", "aac",
		"-b:a", "128k",
		"-shortest",
		"-y",
		outputPath,
	}

	return cmd
}

// GetImagePathForChunk returns the image path that should be used for a specific chunk
// based on the ImageGroups mapping
func GetImagePathForChunk(chunkIndex int, imageGroups []ImageGroup, imagePaths []string) string {
	for _, group := range imageGroups {
		if chunkIndex >= group.ChunkStart && chunkIndex < group.ChunkEnd {
			// Return the image for this group
			if group.ID < len(imagePaths) {
				return imagePaths[group.ID]
			}
		}
	}

	// Fallback: if no groups or index out of bounds, use corresponding image
	if chunkIndex < len(imagePaths) {
		return imagePaths[chunkIndex]
	}

	return ""
}
