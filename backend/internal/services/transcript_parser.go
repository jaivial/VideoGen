package services

import (
	"regexp"
	"strconv"
	"strings"
)

// TranscriptSegment represents a segment of a transcript with translation and audio
type TranscriptSegment struct {
	Index           int
	Timestamp       string  // Original timestamp if YouTube format
	OriginalText    string
	TranslatedText  string
	AudioPath       string  // Path to generated audio
	StartTime       float64 // Start time in seconds
	Duration        float64 // Duration in seconds
}

// ImageGroup represents a group of text chunks used to generate a single image
type ImageGroup struct {
	ID          int    // Group index (0, 1, 2, ...)
	ChunkStart  int    // Starting chunk index
	ChunkEnd    int    // Ending chunk index (exclusive)
	ChunkCount  int    // Number of chunks in group
	Prompt      string // Combined text for image prompt
	ImageURL    string // Generated image URL
	ImagePath   string // Local file path after download
}

// ParseTranscript parses a transcript input and determines format
// Returns segments with parsed data
func ParseTranscript(input string) ([]TranscriptSegment, error) {
	if IsYouTubeFormat(input) {
		return parseYouTubeTranscript(input)
	}
	return parsePlainTextTranscript(input), nil
}

// IsYouTubeFormat checks if the input is in YouTube timestamped format
// Format: "00:00:00.320 text..." or "00:00:00 --> 00:00:05.000"
func IsYouTubeFormat(input string) bool {
	lines := strings.Split(input, "\n")
	if len(lines) == 0 {
		return false
	}

	// Check for timestamp patterns
	timestampRegex := regexp.MustCompile(`^(\d{2}):(\d{2}):(\d{2})[\.,](\d{3})`)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Check for HH:MM:SS.mmm pattern at start of line
		if timestampRegex.MatchString(line) {
			return true
		}

		// Check for --> pattern (YouTube subtitle format)
		if strings.Contains(line, "-->") {
			return true
		}
	}

	return false
}

// parseYouTubeTranscript parses YouTube timestamped format
// Supports formats:
// 1. "00:00:00.320 text..." (tactiq.io format - same line)
// 2. "00:00:00.320" followed by "text..." (separate lines)
// 3. "00:00:00 --> 00:00:05.000" (YouTube subtitle format)
func parseYouTubeTranscript(text string) ([]TranscriptSegment, error) {
	var segments []TranscriptSegment

	// Regex for tactiq format: HH:MM:SS.mmm text... (same line)
	tactiqRegex := regexp.MustCompile(`^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+(.+)$`)

	// Regex for timestamp only: HH:MM:SS.mmm (at start of line)
	timestampOnlyRegex := regexp.MustCompile(`^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*$`)

	// Regex for YouTube subtitle format: HH:MM:SS.mmm --> HH:MM:SS.mmm
	youtubeRegex := regexp.MustCompile(`^(\d{2}):(\d{2}):(\d{2})[\.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[\.,](\d{3})`)

	lines := strings.Split(text, "\n")
	var prevEndTime float64 = 0

	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])

		// Skip empty lines and comment lines
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Skip index lines (lines that are just numbers like "1", "2", "3"...)
		// This handles Whisper/YouTube format with index numbers
		if matched, _ := regexp.MatchString(`^\d+$`, line); matched {
			continue
		}

		// Handle "text first, then timestamp" format
		// Check if current line is text (not a timestamp) and next line is a timestamp
		if !timestampOnlyRegex.MatchString(line) && !tactiqRegex.MatchString(line) && !youtubeRegex.MatchString(line) {
			// This is a text line - check if next line is a timestamp
			if i+1 < len(lines) {
				nextLine := strings.TrimSpace(lines[i+1])
				timestampMatch := timestampOnlyRegex.FindStringSubmatch(nextLine)
				if timestampMatch != nil {
					// Parse timestamp
					hours, _ := strconv.Atoi(timestampMatch[1])
					minutes, _ := strconv.Atoi(timestampMatch[2])
					seconds, _ := strconv.Atoi(timestampMatch[3])
					millis, _ := strconv.Atoi(timestampMatch[4])
					startTime := float64(hours*3600+minutes*60+seconds) + float64(millis)/1000

					segmentText := line

					// Skip "No text" entries
					if strings.ToLower(segmentText) == "no text" || segmentText == "" {
						i++ // Skip timestamp line
						continue
					}

					// Calculate duration - look ahead for next timestamp
					duration := 3.0 // Default duration
					for j := i + 2; j < len(lines); j++ {
						nextTsLine := strings.TrimSpace(lines[j])
						if nextTsMatch := timestampOnlyRegex.FindStringSubmatch(nextTsLine); nextTsMatch != nil {
							nextHours, _ := strconv.Atoi(nextTsMatch[1])
							nextMinutes, _ := strconv.Atoi(nextTsMatch[2])
							nextSeconds, _ := strconv.Atoi(nextTsMatch[3])
							nextMillis, _ := strconv.Atoi(nextTsMatch[4])
							nextTime := float64(nextHours*3600+nextMinutes*60+nextSeconds) + float64(nextMillis)/1000
							duration = nextTime - startTime
							if duration < 0 {
								duration = 3.0
							}
							break
						}
					}

					segment := TranscriptSegment{
						Index:        len(segments),
						Timestamp:    timestampMatch[1] + ":" + timestampMatch[2] + ":" + timestampMatch[3] + "." + timestampMatch[4],
						OriginalText: segmentText,
						StartTime:    startTime,
						Duration:     duration,
					}

					segments = append(segments, segment)
					i++ // Skip the timestamp line
					continue
				}
			}
		}

		// Try tactiq format first (timestamp + text on same line)
		matches := tactiqRegex.FindStringSubmatch(line)
		if matches != nil {
			// Parse timestamp
			hours, _ := strconv.Atoi(matches[1])
			minutes, _ := strconv.Atoi(matches[2])
			seconds, _ := strconv.Atoi(matches[3])
			millis, _ := strconv.Atoi(matches[4])
			segmentText := matches[5]

			// Skip "No text" entries
			if strings.ToLower(segmentText) == "no text" {
				continue
			}

			startTime := float64(hours*3600+minutes*60+seconds) + float64(millis)/1000

			// Calculate duration
			duration := startTime - prevEndTime
			if duration < 0 {
				duration = 0
			}

			segment := TranscriptSegment{
				Index:        len(segments),
				Timestamp:    matches[1] + ":" + matches[2] + ":" + matches[3] + "." + matches[4],
				OriginalText: segmentText,
				StartTime:    startTime,
				Duration:     duration,
			}

			segments = append(segments, segment)
			prevEndTime = startTime + duration
			continue
		}

		// Try timestamp-only line followed by text on next line
		timestampMatch := timestampOnlyRegex.FindStringSubmatch(line)
		if timestampMatch != nil {
			// Parse timestamp
			hours, _ := strconv.Atoi(timestampMatch[1])
			minutes, _ := strconv.Atoi(timestampMatch[2])
			seconds, _ := strconv.Atoi(timestampMatch[3])
			millis, _ := strconv.Atoi(timestampMatch[4])
			startTime := float64(hours*3600+minutes*60+seconds) + float64(millis)/1000

			// Look at next line for text
			segmentText := ""
			if i+1 < len(lines) {
				nextLine := strings.TrimSpace(lines[i+1])
				// Check if next line is NOT a timestamp (i.e., it's the actual text)
				if !timestampOnlyRegex.MatchString(nextLine) && !tactiqRegex.MatchString(nextLine) && nextLine != "" {
					segmentText = nextLine
					i++ // Skip the next line since we consumed it
				}
			}

			// Skip "No text" entries
			if strings.ToLower(segmentText) == "no text" || segmentText == "" {
				continue
			}

			// Calculate duration
			duration := startTime - prevEndTime
			if duration < 0 {
				duration = 0
			}

			segment := TranscriptSegment{
				Index:        len(segments),
				Timestamp:    timestampMatch[1] + ":" + timestampMatch[2] + ":" + timestampMatch[3] + "." + timestampMatch[4],
				OriginalText: segmentText,
				StartTime:    startTime,
				Duration:     duration,
			}

			segments = append(segments, segment)
			prevEndTime = startTime + duration
			continue
		}

		// Try YouTube subtitle format
		youtubeMatches := youtubeRegex.FindStringSubmatch(line)
		if youtubeMatches != nil {
			// Parse start time
			startHours, _ := strconv.Atoi(youtubeMatches[1])
			startMinutes, _ := strconv.Atoi(youtubeMatches[2])
			startSeconds, _ := strconv.Atoi(youtubeMatches[3])
			startMillis, _ := strconv.Atoi(youtubeMatches[4])
			startTime := float64(startHours*3600+startMinutes*60+startSeconds) + float64(startMillis)/1000

			// Parse end time
			endHours, _ := strconv.Atoi(youtubeMatches[5])
			endMinutes, _ := strconv.Atoi(youtubeMatches[6])
			endSeconds, _ := strconv.Atoi(youtubeMatches[7])
			endMillis, _ := strconv.Atoi(youtubeMatches[8])
			endTime := float64(endHours*3600+endMinutes*60+endSeconds) + float64(endMillis)/1000

			duration := endTime - startTime

			// Get the text from the NEXT line (not same line - SRT format)
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
			if segmentText == "" {
				continue
			}

			segment := TranscriptSegment{
				Index:        len(segments),
				Timestamp:    youtubeMatches[1] + ":" + youtubeMatches[2] + ":" + youtubeMatches[3] + "." + youtubeMatches[4],
				OriginalText: segmentText,
				StartTime:    startTime,
				Duration:     duration,
			}

			segments = append(segments, segment)
			i++ // Skip the text line since we consumed it
			prevEndTime = endTime
			continue
		}

		// If no timestamp match, append to previous segment text if exists
		if len(segments) > 0 && line != "" {
			segments[len(segments)-1].OriginalText += " " + line
		}
	}

	return segments, nil
}

// parsePlainTextTranscript treats the entire text as a single segment or splits by sentences
func parsePlainTextTranscript(text string) []TranscriptSegment {
	text = strings.TrimSpace(text)
	if text == "" {
		return []TranscriptSegment{}
	}

	// Check if text is short enough to be a single segment
	if len(text) < 500 {
		return []TranscriptSegment{
			{
				Index:        0,
				OriginalText: text,
			},
		}
	}

	// Split by sentences (roughly)
	var segments []TranscriptSegment
	sentences := splitBySentences(text)

	for i, sentence := range sentences {
		if strings.TrimSpace(sentence) == "" {
			continue
		}
		segments = append(segments, TranscriptSegment{
			Index:        i,
			OriginalText: strings.TrimSpace(sentence),
		})
	}

	// If splitting resulted in too many small segments, combine them
	if len(segments) > 50 {
		var combined []TranscriptSegment
		var current strings.Builder

		for i, seg := range segments {
			current.WriteString(seg.OriginalText)
			if current.Len() > 300 || i == len(segments)-1 {
				combined = append(combined, TranscriptSegment{
					Index:        len(combined),
					OriginalText: strings.TrimSpace(current.String()),
				})
				current.Reset()
			}
		}
		segments = combined
	}

	// Ensure we have at least one segment
	if len(segments) == 0 {
		segments = []TranscriptSegment{
			{
				Index:        0,
				OriginalText: text,
			},
		}
	}

	// Re-index segments
	for i := range segments {
		segments[i].Index = i
	}

	return segments
}

// splitBySentences splits text by sentence-ending punctuation
func splitBySentences(text string) []string {
	// Split by common sentence endings: . ! ?
	// Keep the delimiter
	re := regexp.MustCompile(`([.!?]+\s*)`)
	parts := re.Split(text, -1)

	var sentences []string
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			sentences = append(sentences, part)
		}
	}

	return sentences
}

// CreateImageGroups groups TranscriptSegments into ImageGroups of specified size
// Each group contains up to groupSize consecutive segments
func CreateImageGroups(segments []TranscriptSegment, groupSize int) []ImageGroup {
	if len(segments) == 0 {
		return []ImageGroup{}
	}

	if groupSize <= 0 {
		groupSize = 10 // Default group size
	}

	var groups []ImageGroup
	numGroups := (len(segments) + groupSize - 1) / groupSize // Ceiling division

	for i := 0; i < numGroups; i++ {
		start := i * groupSize
		end := start + groupSize
		if end > len(segments) {
			end = len(segments)
		}

		// Build combined prompt from segment texts
		var promptBuilder strings.Builder
		for j := start; j < end; j++ {
			text := segments[j].TranslatedText
			if text == "" {
				text = segments[j].OriginalText
			}
			if j > start {
				promptBuilder.WriteString(" ")
			}
			promptBuilder.WriteString(text)
		}

		group := ImageGroup{
			ID:         i,
			ChunkStart: start,
			ChunkEnd:   end,
			ChunkCount: end - start,
			Prompt:     promptBuilder.String(),
		}

		groups = append(groups, group)
	}

	return groups
}

// GenerateUnifiedTranscriptText creates a single text from all segments with timing info
// Format: "Text content here" (without timestamps - for TTS only)
func GenerateUnifiedTranscriptText(segments []TranscriptSegment) string {
	var textBuilder strings.Builder

	for i, seg := range segments {
		// Use translated text if available, otherwise original
		text := seg.TranslatedText
		if text == "" {
			text = seg.OriginalText
		}

		if text == "" {
			continue
		}

		if i > 0 {
			textBuilder.WriteString(" ")
		}
		textBuilder.WriteString(text)
	}

	return textBuilder.String()
}
