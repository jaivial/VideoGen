package services

import (
	"fmt"
	"os"
	"strings"
)

// GenerateASSFile generates an ASS subtitle file from caption segments
// Includes fade in/out animations using \fad() tag
func GenerateASSFile(segments []CaptionSegment, config KineticCaptionConfig, outputPath string, videoWidth, videoHeight int) error {
	var sb strings.Builder

	// Write Script Info section
	sb.WriteString("[Script Info]\n")
	sb.WriteString("Title: Kinetic Captions\n")
	sb.WriteString("ScriptType: v4.00+\n")
	sb.WriteString("WrapStyle: 1\n") // 1 = end-of-line only, prevents mid-word breaks
	sb.WriteString("ScaledBorderAndShadow: yes\n")
	sb.WriteString("YCbCr Matrix: None\n")
	sb.WriteString(fmt.Sprintf("PlayResX: %d\n", videoWidth))
	sb.WriteString(fmt.Sprintf("PlayResY: %d\n\n", videoHeight))

	// Write Styles section
	sb.WriteString("[V4+ Styles]\n")
	sb.WriteString("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
	sb.WriteString(BuildASSStyle(config, videoWidth, videoHeight))
	sb.WriteString("\n\n")

	// Write Events section
	sb.WriteString("[Events]\n")
	sb.WriteString("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")

	// Calculate fade durations from config (in milliseconds)
	fadeInMs := int(config.AnimationIn * 1000)
	fadeOutMs := int(config.AnimationOut * 1000)

	for _, seg := range segments {
		text := seg.Text
		if text == "" {
			continue
		}

		// Convert escaped newlines to ASS line break (\N)
		// Handle both actual newlines and literal "\n" (backslash + n)
		text = strings.ReplaceAll(text, "\\n", "\\N")
		text = strings.ReplaceAll(text, "\n", "\\N")

		startTime := seg.StartTime
		endTime := seg.EndTime

		// Ensure we have valid timing
		if endTime <= startTime {
			endTime = startTime + 3.0 // Default 3 second display
		}

		// Calculate actual fade durations (can't exceed segment duration)
		duration := endTime - startTime
		actualFadeIn := fadeInMs
		actualFadeOut := fadeOutMs
		if float64(actualFadeIn) > duration*1000/2 {
			actualFadeIn = int(duration * 1000 / 2)
		}
		if float64(actualFadeOut) > duration*1000/2 {
			actualFadeOut = int(duration * 1000 / 2)
		}

		// Format times in ASS format (H:MM:SS.cc)
		startStr := FormatASSTime(startTime)
		endStr := FormatASSTime(endTime)

		// Add fade animation - override tag in Text field
		// Format: {\fad(fadeIn,fadeOut)} where times are in milliseconds
		fadeOverride := fmt.Sprintf("{\\fad(%d,%d)}", actualFadeIn, actualFadeOut)

		// Write dialogue line
		// Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
		// Effect field (9th) is for animations like \fad(), Text field (10th) is for the actual text
		sb.WriteString(fmt.Sprintf("Dialogue: 0,%s,%s,Kinetic,,0,0,0,,%s%s\n", startStr, endStr, fadeOverride, text))
	}

	// Write the file
	return os.WriteFile(outputPath, []byte(sb.String()), 0644)
}

// BuildASSStyle builds an ASS style line from KineticCaptionConfig
func BuildASSStyle(config KineticCaptionConfig, videoWidth, videoHeight int) string {
	// Map position to ASS alignment
	// ASS alignment: 1=bottom left, 2=bottom center, 3=bottom right
	// 4=middle left, 5=middle center, 6=middle right
	// 7=top left, 8=top center, 9=top right
	var alignment int
	switch config.Position {
	case "top":
		alignment = 8
	case "bottom":
		alignment = 2
	case "center":
		alignment = 5 // Vertical center
	default:
		alignment = 5
	}

	// Calculate margin V (distance from edge based on position)
	marginV := 100 // Default vertical margin
	if config.YOffset != 0 {
		marginV = videoHeight/2 - config.YOffset
	}

	// Convert font color to ASS format (&HAABBGGRR)
	// White is &H00FFFFFF (BGR format)
	primaryColor := "&H00FFFFFF"
	if config.FontColor != "" {
		switch config.FontColor {
		case "white":
			primaryColor = "&H00FFFFFF"
		case "black":
			primaryColor = "&H00000000"
		case "yellow":
			primaryColor = "&H0000FFFF"
		}
	}

	// Border/outline color (black)
	outlineColor := "&H00000000"
	if config.BorderColor != "" {
		switch config.BorderColor {
		case "white":
			outlineColor = "&H00FFFFFF"
		case "black":
			outlineColor = "&H00000000"
		case "yellow":
			outlineColor = "&H0000FFFF"
		}
	}

	// Font name - extract from path or use default
	fontName := "DejaVuSans"
	if config.FontFile != "" {
		// Extract font name from path
		parts := strings.Split(config.FontFile, "/")
		if len(parts) > 0 {
			fontName = strings.TrimSuffix(parts[len(parts)-1], ".ttf")
			fontName = strings.TrimSuffix(fontName, ".TTF")
		}
	}

	// Bold: -1 means true, 0 means false
	bold := -1

	// BorderStyle: 1 = outline, 3 = opaque box
	borderStyle := 1

	// ScaleX/Y: 100 = normal
	// Spacing: 0 = normal
	// Angle: 0 = normal

	return fmt.Sprintf(
		"Style: Kinetic,%s,%d,%s,&H000000FF,%s,&H00000000,%d,0,0,0,100,100,0,0,%d,%d,0,%d,10,10,%d,1",
		fontName,
		config.FontSize,
		primaryColor,
		outlineColor,
		bold,
		borderStyle,
		config.BorderWidth,
		alignment,
		marginV,
	)
}

// FormatASSTime converts seconds to ASS timestamp format (H:MM:SS.cc)
// ASS uses centiseconds (2 decimal places)
func FormatASSTime(seconds float64) string {
	h := int(seconds) / 3600
	m := (int(seconds) % 3600) / 60
	s := int(seconds) % 60
	cs := int((seconds - float64(int(seconds))) * 100)
	return fmt.Sprintf("%d:%02d:%02d.%02d", h, m, s, cs)
}
