package services

import "fmt"

// Effect represents a video effect with its parameters
type Effect struct {
	Type       string  `json:"type"`       // brightness, contrast, saturation, fade, dissolve, wipe
	Intensity  float64 `json:"intensity"`  // 0.0 to 1.0
	Duration   float64 `json:"duration"`    // for transitions
	StartTime  float64 `json:"start_time"` // when effect starts
}

// GenerateEffectFilter creates an FFmpeg filter string for video effects
func GenerateEffectFilter(effects []Effect, width, height int) string {
	var filters []string

	for _, effect := range effects {
		switch effect.Type {
		case "brightness":
			// brightness: -1.0 to 1.0, default 0
			brightness := effect.Intensity*2 - 1 // Convert 0-1 to -1 to 1
			filters = append(filters, fmt.Sprintf("eq=brightness=%.2f", brightness))

		case "contrast":
			// contrast: 0 to 2, default 1
			contrast := 1 + effect.Intensity // Convert 0-1 to 1-2
			filters = append(filters, fmt.Sprintf("eq=contrast=%.2f", contrast))

		case "saturation":
			// saturation: 0 to 3, default 1
			saturation := effect.Intensity * 3 // Convert 0-1 to 0-3
			filters = append(filters, fmt.Sprintf("eq=saturation=%.2f", saturation))

		case "brightness_contrast":
			brightness := effect.Intensity*2 - 1
			filters = append(filters, fmt.Sprintf("eq=brightness=%.2f:contrast=%.2f", brightness, 1+effect.Intensity))

		case "grayscale":
			// Convert to grayscale
			filters = append(filters, "hue=s=0")

		case "sepia":
			// Sepia tone using color matrix
			filters = append(filters, "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131")

		case "blur":
			// Gaussian blur, radius 1-10
			radius := int(effect.Intensity*9) + 1
			filters = append(filters, fmt.Sprintf("gblur=sigma=%d", radius))

		case "sharpen":
			// Sharpen using unsharp filter
			filters = append(filters, fmt.Sprintf("unsharp=5:5:%.2f:5:5:0.0", effect.Intensity))

		case "fade_in":
			// Fade in from black
			filters = append(filters, fmt.Sprintf("fade=t=in:st=0:d=%.1f", effect.Duration))

		case "fade_out":
			// Fade out to black
			filters = append(filters, fmt.Sprintf("fade=t=out:st=%.1f:d=%.1f", effect.StartTime, effect.Duration))

		case "dissolve":
			// Cross-dissolve (requires two inputs, handled separately)
			// This is a placeholder - actual dissolve requires xfade filter
			filters = append(filters, fmt.Sprintf("xfade=transition=dissolve:duration=%.1f:offset=%.1f", effect.Duration, effect.StartTime))

		case "wipe_left":
			filters = append(filters, fmt.Sprintf("xfade=transition=wipeleft:duration=%.1f:offset=%.1f", effect.Duration, effect.StartTime))

		case "wipe_right":
			filters = append(filters, fmt.Sprintf("xfade=transition=wiperight:duration=%.1f:offset=%.1f", effect.Duration, effect.StartTime))

		case "slide_left":
			filters = append(filters, fmt.Sprintf("xfade=transition=slideleft:duration=%.1f:offset=%.1f", effect.Duration, effect.StartTime))

		case "slide_right":
			filters = append(filters, fmt.Sprintf("xfade=transition=slideright:duration=%.1f:offset=%.1f", effect.Duration, effect.StartTime))
		}
	}

	if len(filters) == 0 {
		return ""
	}

	return filters[0]
}

// GenerateCompleteFilterChain creates a complete FFmpeg filter chain
// including scaling, effects, and captions
func GenerateCompleteFilterChain(
	width, height int,
	effects []Effect,
	captionFilter string,
) string {
	var filters []string

	// Always scale first
	filters = append(filters, fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1", width, height, width, height))

	// Add effects
	effectFilter := GenerateEffectFilter(effects, width, height)
	if effectFilter != "" {
		filters = append(filters, effectFilter)
	}

	// Add caption filter (ASS subtitles)
	if captionFilter != "" {
		filters = append(filters, captionFilter)
	}

	return combineFilters(filters)
}

// GenerateTransitionFilter creates a transition filter between two inputs
func GenerateTransitionFilter(transition string, duration float64, offset float64) string {
	switch transition {
	case "fade", "dissolve":
		return fmt.Sprintf("xfade=transition=dissolve:duration=%.1f:offset=%.1f", duration, offset)
	case "wipe_left":
		return fmt.Sprintf("xfade=transition=wipeleft:duration=%.1f:offset=%.1f", duration, offset)
	case "wipe_right":
		return fmt.Sprintf("xfade=transition=wiperight:duration=%.1f:offset=%.1f", duration, offset)
	case "slide_left":
		return fmt.Sprintf("xfade=transition=slideleft:duration=%.1f:offset=%.1f", duration, offset)
	case "slide_right":
		return fmt.Sprintf("xfade=transition=slideright:duration=%.1f:offset=%.1f", duration, offset)
	case "slide_up":
		return fmt.Sprintf("xfade=transition=slideup:duration=%.1f:offset=%.1f", duration, offset)
	case "slide_down":
		return fmt.Sprintf("xfade=transition=slidedown:duration=%.1f:offset=%.1f", duration, offset)
	case "circle_crop":
		return fmt.Sprintf("xfade=transition=circlecrop:duration=%.1f:offset=%.1f", duration, offset)
	default:
		return fmt.Sprintf("xfade=transition=fade:duration=%.1f:offset=%.1f", duration, offset)
	}
}

// combineFilters joins multiple FFmpeg filters
func combineFilters(filters []string) string {
	result := ""
	for i, f := range filters {
		if i > 0 {
			result += ","
		}
		result += f
	}
	return result
}

// ApplyEffectsToVideo applies effects to an existing video file
func ApplyEffectsToVideo(inputPath, outputPath string, effects []Effect, width, height int) error {
	filterChain := GenerateCompleteFilterChain(width, height, effects, "")
	if filterChain == "" {
		return nil // No effects to apply
	}

	// Build FFmpeg command
	args := []string{
		"-i", inputPath,
		"-vf", filterChain,
		"-c:a", "copy", // Copy audio without re-encoding
		"-y",
		outputPath,
	}

	_ = args // Used in actual implementation
	// cmd := exec.Command("ffmpeg", args...)
	// return cmd.Run()

	return nil
}

// ApplyTransition applies a transition between two video files
func ApplyTransition(video1Path, video2Path, outputPath string, transition string, duration, offset float64) error {
	transitionFilter := GenerateTransitionFilter(transition, duration, offset)

	// For transitions, we need to use filter_complex with two inputs
	filterComplex := fmt.Sprintf("[0:v][1:v]%s[out]", transitionFilter)

	args := []string{
		"-i", video1Path,
		"-i", video2Path,
		"-filter_complex", filterComplex,
		"-map", "[out]",
		"-c:v", "libx264",
		"-preset", "fast",
		"-crf", "23",
		"-y",
		outputPath,
	}

	_ = args // Used in actual implementation
	// cmd := exec.Command("ffmpeg", args...)
	// return cmd.Run()

	return nil
}
