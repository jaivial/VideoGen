package services

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"video-generator/internal/config"
)

type EditorRenderService struct {
	tempDir string
	cfg     *config.Config
}

func NewEditorRenderService(tempDir string, cfg *config.Config) *EditorRenderService {
	return &EditorRenderService{
		tempDir: tempDir,
		cfg:     cfg,
	}
}

type EditorRenderRequest struct {
	Mode   string              `json:"mode"` // "preview" | "export"
	Tracks []EditorRenderTrack `json:"tracks"`
	Export EditorExportConfig  `json:"export"`
}

type EditorExportConfig struct {
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	FrameRate    int    `json:"frameRate"`
	Format       string `json:"format"` // "mp4" | "webm"
	CRF          int    `json:"crf"`
	IncludeAudio bool   `json:"includeAudio"`
}

type EditorRenderTrack struct {
	Type  string             `json:"type"` // "video" | "audio" | "caption"
	Clips []EditorRenderClip `json:"clips"`
}

type EditorRenderClip struct {
	ID        string  `json:"id"`
	Type      string  `json:"type"` // "video" | "image" | "audio"
	StartTime float64 `json:"startTime"`
	Duration  float64 `json:"duration"`
	TrimStart float64 `json:"trimStart"`
	TrimEnd   float64 `json:"trimEnd"`
	URL       string  `json:"url"`

	// Common controls (optional)
	Speed   float64              `json:"speed"`
	Volume  float64              `json:"volume"`
	FadeIn  float64              `json:"fadeIn"`
	FadeOut float64              `json:"fadeOut"`
	Effects []EditorRenderEffect `json:"effects"`

	// Caption fields (when clip type is "caption")
	Text  string             `json:"text"`
	Style EditorCaptionStyle `json:"style"`
}

type EditorRenderEffect struct {
	ID      string                 `json:"id"`
	Type    string                 `json:"type"`
	Name    string                 `json:"name"`
	Params  map[string]interface{} `json:"params"`
	Enabled bool                   `json:"enabled"`
}

type EditorCaptionStyle struct {
	FontFamily        string  `json:"fontFamily"`
	FontSize          float64 `json:"fontSize"`
	FontWeight        float64 `json:"fontWeight"`
	Italic            bool    `json:"italic"`
	Underline         bool    `json:"underline"`
	TextTransform     string  `json:"textTransform"`
	LetterSpacing     float64 `json:"letterSpacing"`
	Opacity           float64 `json:"opacity"`
	LineHeight        float64 `json:"lineHeight"`
	Color             string  `json:"color"`
	BackgroundColor   string  `json:"backgroundColor"`
	BackgroundOpacity float64 `json:"backgroundOpacity"`
	BoxStyle          string  `json:"boxStyle"`
	PaddingX          float64 `json:"paddingX"`
	PaddingY          float64 `json:"paddingY"`
	BorderRadius      float64 `json:"borderRadius"`
	StrokeColor       string  `json:"strokeColor"`
	StrokeWidth       float64 `json:"strokeWidth"`
	ShadowColor       string  `json:"shadowColor"`
	ShadowBlur        float64 `json:"shadowBlur"`
	ShadowOffsetX     float64 `json:"shadowOffsetX"`
	ShadowOffsetY     float64 `json:"shadowOffsetY"`
	Position          string  `json:"position"`  // "top" | "center" | "bottom"
	Alignment         string  `json:"alignment"` // "left" | "center" | "right"
	OffsetX           float64 `json:"offsetX"`
	OffsetY           float64 `json:"offsetY"`
	MaxWidthPercent   float64 `json:"maxWidthPercent"`
	Animation         string  `json:"animation"`
	AnimationDuration float64 `json:"animationDuration"`
	AnimationStrength float64 `json:"animationStrength"`
}

type renderSegment struct {
	kind     string // "video" | "image" | "gap"
	clip     *EditorRenderClip
	duration float64 // timeline duration in seconds
}

func (s *EditorRenderService) RenderTimeline(ctx context.Context, videoRequestedID uint64, sourceVideoURL string, req EditorRenderRequest) (string, string, error) {
	export := req.Export
	if export.Width <= 0 {
		export.Width = 1920
	}
	if export.Height <= 0 {
		export.Height = 1080
	}
	if export.FrameRate <= 0 {
		export.FrameRate = 30
	}
	if export.CRF <= 0 {
		export.CRF = 23
	}
	if export.Format == "" {
		export.Format = "mp4"
	}
	if req.Mode == "" {
		req.Mode = "export"
	}
	if req.Mode == "preview" {
		// Keep previews snappy (lower res / quality)
		export.Width = minInt(export.Width, 1280)
		export.Height = minInt(export.Height, 720)
		export.FrameRate = minInt(export.FrameRate, 30)
		export.CRF = maxInt(export.CRF, 28)
	}

	format := strings.ToLower(export.Format)
	switch format {
	case "mp4":
		// ok
	default:
		return "", "", fmt.Errorf("unsupported export format: %s", export.Format)
	}

	visualClips := collectVisualClips(req.Tracks)
	if len(visualClips) == 0 {
		return "", "", errors.New("no visual clips to render")
	}
	renderDuration := timelineDuration(req.Tracks)
	if renderDuration <= 0.05 {
		return "", "", errors.New("timeline duration must be > 0")
	}

	// Restrict protocols/hosts to avoid SSRF / local file access.
	allowedHosts := s.allowedMediaHosts(sourceVideoURL)

	// Inputs: source video is always input 0
	if !isAllowedHTTPURL(sourceVideoURL, allowedHosts) {
		return "", "", fmt.Errorf("source video URL host not allowed: %s", redactURLHost(sourceVideoURL))
	}

	inputArgs := []string{
		"-i", sourceVideoURL,
	}

	// Keep track of which extra inputs we've already added.
	type inputKey struct {
		url  string
		kind string
	}
	inputIndexByKey := map[inputKey]int{
		{url: sourceVideoURL, kind: "video"}: 0,
	}

	// Detect audio presence for video inputs on-demand.
	hasAudioByVideoURL := map[string]bool{}
	var firstProbeErr error
	getHasAudio := func(videoURL string) bool {
		if v, ok := hasAudioByVideoURL[videoURL]; ok {
			return v
		}
		has, err := hasAudioStream(ctx, videoURL)
		if err != nil && firstProbeErr == nil {
			firstProbeErr = err
		}
		if err != nil {
			// If probing fails, default to silence so rendering still works.
			has = false
		}
		hasAudioByVideoURL[videoURL] = has
		return has
	}

	// Build filter_complex
	w := export.Width
	h := export.Height
	fps := export.FrameRate
	includeAudio := export.IncludeAudio

	preparedVisualClips := buildPreparedVisualClips(req.Tracks)
	if len(preparedVisualClips) == 0 {
		return "", "", errors.New("no renderable visual clips")
	}
	sort.Slice(preparedVisualClips, func(i, j int) bool {
		if preparedVisualClips[i].layer != preparedVisualClips[j].layer {
			return preparedVisualClips[i].layer < preparedVisualClips[j].layer
		}
		return preparedVisualClips[i].timelineStart < preparedVisualClips[j].timelineStart
	})

	filterParts := make([]string, 0, len(preparedVisualClips)*4+32)
	filterParts = append(filterParts,
		fmt.Sprintf("color=c=black:s=%dx%d:r=%d:d=%s,format=yuv420p[vbase0]", w, h, fps, ffFloat(renderDuration)),
	)

	finalVideoLabel := "[vbase0]"
	finalAudioLabel := "[abase0]"
	audioMixInputs := []string{}

	if includeAudio {
		filterParts = append(filterParts,
			fmt.Sprintf("anullsrc=r=44100:cl=stereo,atrim=duration=%s,asetpts=PTS-STARTPTS[abase0]", ffFloat(renderDuration)),
		)
		audioMixInputs = append(audioMixInputs, "[abase0]")
	}

	for i := range preparedVisualClips {
		clipInfo := preparedVisualClips[i]
		clip := clipInfo.clip

		clipURL := clip.URL
		if clipInfo.kind == "video" && clipURL == "" {
			clipURL = sourceVideoURL
		}
		if clipURL == "" {
			continue
		}
		if !isAllowedHTTPURL(clipURL, allowedHosts) {
			return "", "", fmt.Errorf("%s URL host not allowed: %s", clipInfo.kind, redactURLHost(clipURL))
		}

		key := inputKey{url: clipURL, kind: clipInfo.kind}
		idx, ok := inputIndexByKey[key]
		if !ok {
			if clipInfo.kind == "image" {
				inputArgs = append(inputArgs, "-loop", "1", "-framerate", strconv.Itoa(fps), "-i", clipURL)
			} else {
				inputArgs = append(inputArgs, "-i", clipURL)
			}
			idx = len(inputIndexByKey)
			inputIndexByKey[key] = idx
		}

		effectChain := buildVideoEffectsChain(clip.Effects)
		alphaChain := buildTransitionAlphaChain(clipInfo.transitionIn, clipInfo.transitionOut, clipInfo.timelineDuration)
		visualLabel := fmt.Sprintf("vclip%d", i)

		if clipInfo.kind == "image" {
			filterParts = append(filterParts,
				fmt.Sprintf("[%d:v]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1,fps=%d,trim=duration=%s,setpts=PTS-STARTPTS%s,format=rgba%s[%s]",
					idx, w, h, w, h, fps, ffFloat(clipInfo.timelineDuration), effectChain, alphaChain, visualLabel),
			)
		} else {
			trimStart := clampFloat(clipInfo.sourceStart, 0, math.MaxFloat64)
			trimEnd := trimStart + clipInfo.sourceDuration
			speed := clampFloat(clipInfo.speed, 0.25, 4)

			filterParts = append(filterParts,
				fmt.Sprintf("[%d:v]trim=start=%s:end=%s,setpts=PTS-STARTPTS,setpts=PTS/%s,scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,setsar=1,fps=%d%s,format=rgba%s[%s]",
					idx, ffFloat(trimStart), ffFloat(trimEnd), ffFloat(speed), w, h, w, h, fps, effectChain, alphaChain, visualLabel),
			)

			if includeAudio && getHasAudio(clipURL) {
				volume := clip.Volume
				if volume <= 0 {
					volume = 1
				}
				volume = clampFloat(volume, 0, 2)

				audioLabel := fmt.Sprintf("avv%d", i)
				audioChain := fmt.Sprintf("[%d:a]atrim=start=%s:end=%s,asetpts=PTS-STARTPTS", idx, ffFloat(trimStart), ffFloat(trimEnd))
				audioChain += buildATempoChain(speed)

				clipDur := clipInfo.timelineDuration
				if clipInfo.transitionIn > 0 {
					audioChain += fmt.Sprintf(",afade=t=in:st=0:d=%s", ffFloat(clampFloat(clipInfo.transitionIn, 0, clipDur)))
				}
				if clipInfo.transitionOut > 0 {
					fadeDur := clampFloat(clipInfo.transitionOut, 0, clipDur)
					outStart := math.Max(0, clipDur-fadeDur)
					audioChain += fmt.Sprintf(",afade=t=out:st=%s:d=%s", ffFloat(outStart), ffFloat(fadeDur))
				}

				delayMs := int(math.Round(math.Max(0, clipInfo.timelineStart) * 1000))
				audioChain += fmt.Sprintf(",volume=%s,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=%d:all=1[%s]", ffFloat(volume), delayMs, audioLabel)
				filterParts = append(filterParts, audioChain)
				audioMixInputs = append(audioMixInputs, fmt.Sprintf("[%s]", audioLabel))
			}
		}

		start := clampFloat(clipInfo.timelineStart, 0, math.MaxFloat64)
		end := clampFloat(start+clipInfo.timelineDuration, start+0.01, math.MaxFloat64)
		outLabel := fmt.Sprintf("vov%d", i)
		filterParts = append(filterParts,
			fmt.Sprintf("%s[%s]overlay=eof_action=pass:format=auto:enable='between(t,%s,%s)'[%s]",
				finalVideoLabel, visualLabel, ffFloat(start), ffFloat(end), outLabel),
		)
		finalVideoLabel = fmt.Sprintf("[%s]", outLabel)
	}

	// Optional: mix in explicit audio tracks.
	if includeAudio {
		audioClipIndex := 0
		for _, audioTrack := range req.Tracks {
			if audioTrack.Type != "audio" {
				continue
			}
			for j := range audioTrack.Clips {
				ac := audioTrack.Clips[j]
				if ac.Type != "audio" || ac.URL == "" {
					continue
				}
				if !isAllowedHTTPURL(ac.URL, allowedHosts) {
					return "", "", fmt.Errorf("audio URL host not allowed: %s", redactURLHost(ac.URL))
				}

				key := inputKey{url: ac.URL, kind: "audio"}
				idx, ok := inputIndexByKey[key]
				if !ok {
					inputArgs = append(inputArgs, "-i", ac.URL)
					idx = len(inputIndexByKey)
					inputIndexByKey[key] = idx
				}

				trimStart := clampFloat(ac.TrimStart, 0, math.MaxFloat64)
				trimEnd := clampFloat(ac.TrimEnd, trimStart+0.05, math.MaxFloat64)
				volume := ac.Volume
				if volume <= 0 {
					volume = 1
				}
				volume = clampFloat(volume, 0, 2)

				delayMs := int(math.Round(math.Max(0, ac.StartTime) * 1000))
				segLabel := fmt.Sprintf("aext%d_%d", audioClipIndex, j)

				chain := fmt.Sprintf("[%d:a]atrim=start=%s:end=%s,asetpts=PTS-STARTPTS,volume=%s", idx, ffFloat(trimStart), ffFloat(trimEnd), ffFloat(volume))

				// Fades are relative to the clip itself.
				clipDur := math.Max(0.05, trimEnd-trimStart)
				if ac.FadeIn > 0 {
					chain += fmt.Sprintf(",afade=t=in:st=0:d=%s", ffFloat(clampFloat(ac.FadeIn, 0, clipDur)))
				}
				if ac.FadeOut > 0 {
					outStart := math.Max(0, clipDur-clampFloat(ac.FadeOut, 0, clipDur))
					chain += fmt.Sprintf(",afade=t=out:st=%s:d=%s", ffFloat(outStart), ffFloat(clampFloat(ac.FadeOut, 0, clipDur)))
				}

				chain += fmt.Sprintf(",aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=%d:all=1[%s]", delayMs, segLabel)
				filterParts = append(filterParts, chain)
				audioMixInputs = append(audioMixInputs, fmt.Sprintf("[%s]", segLabel))
				audioClipIndex++
			}
		}

		if len(audioMixInputs) > 1 {
			filterParts = append(filterParts,
				fmt.Sprintf("%samix=inputs=%d:duration=longest:normalize=0[amix]", strings.Join(audioMixInputs, ""), len(audioMixInputs)),
			)
			finalAudioLabel = "[amix]"
		}
	}

	// Optional: burn caption clips into the final video.
	captionClips := collectCaptionClips(req.Tracks)
	if len(captionClips) > 0 {
		sort.Slice(captionClips, func(i, j int) bool { return captionClips[i].StartTime < captionClips[j].StartTime })

		captionASSPath, err := os.CreateTemp(s.tempDir, "editor-captions-*.ass")
		if err != nil {
			return "", "", fmt.Errorf("create caption ass temp file: %w", err)
		}
		captionASSPath.Close()
		defer os.Remove(captionASSPath.Name())

		if err := GenerateEditorCaptionASSFile(captionClips, captionASSPath.Name(), w, h); err != nil {
			return "", "", fmt.Errorf("generate caption ass file: %w", err)
		}

		outLabel := "vcap_ass"
		filterParts = append(filterParts, fmt.Sprintf("%ssubtitles='%s'[%s]", finalVideoLabel, escapeFFmpegFilterPath(captionASSPath.Name()), outLabel))
		finalVideoLabel = fmt.Sprintf("[%s]", outLabel)
	}

	filter := strings.Join(filterParts, ";")

	// Output path
	jobDir := filepath.Join(s.tempDir, fmt.Sprintf("%d", videoRequestedID), "editor_renders")
	if err := os.MkdirAll(jobDir, 0755); err != nil {
		return "", "", fmt.Errorf("failed to create render dir: %w", err)
	}
	ext := "mp4"
	outPath := filepath.Join(jobDir, fmt.Sprintf("edited_%d_%d.%s", videoRequestedID, time.Now().Unix(), ext))

	preset := "fast"
	if req.Mode == "preview" {
		preset = "ultrafast"
	}

	args := []string{"-hide_banner", "-y", "-loglevel", "error"}
	args = append(args, inputArgs...)
	args = append(args, "-filter_complex", filter)
	args = append(args, "-map", finalVideoLabel)
	if includeAudio {
		args = append(args, "-map", finalAudioLabel)
	}

	// Encode
	args = append(args,
		"-c:v", "libx264",
		"-preset", preset,
		"-crf", strconv.Itoa(export.CRF),
		"-pix_fmt", "yuv420p",
	)
	if includeAudio {
		args = append(args,
			"-c:a", "aac",
			"-b:a", "192k",
		)
	} else {
		args = append(args, "-an")
	}

	args = append(args, "-movflags", "+faststart", outPath)

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	output, runErr := cmd.CombinedOutput()
	if runErr != nil {
		msg := strings.TrimSpace(string(output))
		if msg == "" {
			msg = runErr.Error()
		}
		if firstProbeErr != nil {
			return "", "", fmt.Errorf("ffmpeg render failed: %s (ffprobe audio check error: %v)", msg, firstProbeErr)
		}
		return "", "", fmt.Errorf("ffmpeg render failed: %s", msg)
	}

	return outPath, "video/mp4", nil
}

type normalizedCaptionStyle struct {
	fontSize    int
	fontColor   string
	strokeColor string
	strokeWidth float64
	shadowColor string
	shadowX     float64
	shadowY     float64
	boxColor    string
	boxOpacity  float64
	xExpr       string
	yExpr       string
	lineSpacing float64
}

type preparedVisualClip struct {
	clip             EditorRenderClip
	layer            int
	kind             string // "video" | "image"
	speed            float64
	sourceStart      float64
	sourceDuration   float64
	timelineStart    float64
	timelineDuration float64
	transitionIn     float64
	transitionOut    float64
}

func timelineDuration(tracks []EditorRenderTrack) float64 {
	maxEnd := 0.0
	for _, track := range tracks {
		for _, clip := range track.Clips {
			if clip.Duration <= 0 {
				continue
			}
			end := clip.StartTime + clip.Duration
			if end > maxEnd {
				maxEnd = end
			}
		}
	}
	return maxEnd
}

func buildPreparedVisualClips(tracks []EditorRenderTrack) []preparedVisualClip {
	out := make([]preparedVisualClip, 0, 64)
	videoLayer := 0

	for _, track := range tracks {
		if track.Type != "video" {
			continue
		}

		visual := make([]EditorRenderClip, 0, len(track.Clips))
		for _, clip := range track.Clips {
			if clip.Type == "video" || clip.Type == "image" {
				visual = append(visual, clip)
			}
		}
		sort.Slice(visual, func(i, j int) bool { return visual[i].StartTime < visual[j].StartTime })

		transitionIn := make([]float64, len(visual))
		transitionOut := make([]float64, len(visual))
		for i := 0; i+1 < len(visual); i++ {
			duration, _ := transitionToNext(visual[i], visual[i+1])
			if duration <= 0 {
				continue
			}
			transitionOut[i] = duration
			if duration > transitionIn[i+1] {
				transitionIn[i+1] = duration
			}
		}

		for i := range visual {
			clip := visual[i]
			if clip.Duration <= 0.01 {
				continue
			}

			speed := 1.0
			if clip.Type == "video" {
				speed = clip.Speed
				if speed <= 0 {
					speed = 1
				}
				speed = clampFloat(speed, 0.25, 4)
			}

			inDur := clampFloat(transitionIn[i], 0, math.Max(0, clip.Duration-0.05))
			outDur := clampFloat(transitionOut[i], 0, math.Max(0, clip.Duration-0.05))

			rawStart := clip.StartTime - inDur
			preRoll := 0.0
			if rawStart < 0 {
				preRoll = -rawStart
			}

			timelineStart := math.Max(0, rawStart)
			timelineDuration := clip.Duration + inDur - preRoll
			if timelineDuration <= 0.05 {
				continue
			}

			sourceStart := clampFloat(clip.TrimStart+preRoll*speed, 0, math.MaxFloat64)
			sourceDuration := timelineDuration * speed
			if clip.Type == "video" {
				maxSource := clip.TrimEnd - clip.TrimStart
				if maxSource > 0.05 && sourceDuration > maxSource {
					sourceDuration = maxSource
					timelineDuration = sourceDuration / speed
					inDur = clampFloat(inDur, 0, math.Max(0, timelineDuration-0.05))
					outDur = clampFloat(outDur, 0, math.Max(0, timelineDuration-0.05))
				}
			}

			out = append(out, preparedVisualClip{
				clip:             clip,
				layer:            videoLayer,
				kind:             clip.Type,
				speed:            speed,
				sourceStart:      sourceStart,
				sourceDuration:   sourceDuration,
				timelineStart:    timelineStart,
				timelineDuration: timelineDuration,
				transitionIn:     inDur,
				transitionOut:    outDur,
			})
		}

		videoLayer++
	}

	return out
}

func collectVisualClips(tracks []EditorRenderTrack) []EditorRenderClip {
	out := make([]EditorRenderClip, 0)
	for _, track := range tracks {
		if track.Type != "video" {
			continue
		}
		for _, clip := range track.Clips {
			if clip.Type == "video" || clip.Type == "image" {
				out = append(out, clip)
			}
		}
	}
	return out
}

func collectCaptionClips(tracks []EditorRenderTrack) []EditorRenderClip {
	out := make([]EditorRenderClip, 0)
	for _, track := range tracks {
		if track.Type != "caption" {
			continue
		}
		for _, clip := range track.Clips {
			if clip.Type != "caption" || clip.Duration <= 0 {
				continue
			}
			out = append(out, clip)
		}
	}
	return out
}

func transitionToNext(current EditorRenderClip, next EditorRenderClip) (float64, string) {
	if (current.Type != "video" && current.Type != "image") || (next.Type != "video" && next.Type != "image") {
		return 0, ""
	}

	cutDelta := math.Abs((current.StartTime + current.Duration) - next.StartTime)
	if cutDelta > 0.06 {
		return 0, ""
	}

	effect, ok := findTransitionEffect(current.Effects)
	if !ok {
		return 0, ""
	}

	style := strings.ToLower(strings.TrimSpace(effectParamString(effect.Params, "style", "fade")))
	if style == "" {
		style = "fade"
	}

	maxDur := math.Max(0, math.Min(current.Duration, next.Duration)-0.05)
	if maxDur <= 0 {
		return 0, style
	}

	duration := clampFloat(effectParamFloat(effect.Params, "duration", 0.35), 0, math.Min(2, maxDur))
	if duration < 0.05 {
		return 0, style
	}
	return duration, style
}

func findTransitionEffect(effects []EditorRenderEffect) (EditorRenderEffect, bool) {
	for _, effect := range effects {
		if !strings.EqualFold(strings.TrimSpace(effect.Type), "transition") {
			continue
		}
		enabled := effect.Enabled
		if !enabled {
			enabled = len(effect.Params) > 0
		}
		if !enabled {
			continue
		}
		return effect, true
	}
	return EditorRenderEffect{}, false
}

func buildVideoEffectsChain(effects []EditorRenderEffect) string {
	if len(effects) == 0 {
		return ""
	}

	brightness := 0.0
	contrast := 1.0
	saturation := 1.0
	blurSigma := 0.0

	hasBrightness := false
	hasContrast := false
	hasSaturation := false
	hasBlur := false

	for _, effect := range effects {
		enabled := effect.Enabled
		if !enabled {
			enabled = len(effect.Params) > 0
		}
		if !enabled {
			continue
		}

		switch strings.ToLower(strings.TrimSpace(effect.Type)) {
		case "brightness":
			value := effectParamFloat(effect.Params, "value", 0)
			brightness = clampFloat(value/100, -1, 1)
			hasBrightness = true
		case "contrast":
			value := effectParamFloat(effect.Params, "value", 0)
			contrast = clampFloat(1+value/100, 0, 3)
			hasContrast = true
		case "saturation":
			value := effectParamFloat(effect.Params, "value", 0)
			saturation = clampFloat(1+value/100, 0, 3)
			hasSaturation = true
		case "blur":
			value := effectParamFloat(effect.Params, "value", 0)
			blurSigma = clampFloat(value/4, 0, 12)
			hasBlur = blurSigma > 0
		}
	}

	parts := make([]string, 0, 2)
	if hasBrightness || hasContrast || hasSaturation {
		parts = append(parts, fmt.Sprintf(
			"eq=brightness=%s:contrast=%s:saturation=%s",
			ffFloat(brightness),
			ffFloat(contrast),
			ffFloat(saturation),
		))
	}
	if hasBlur {
		parts = append(parts, fmt.Sprintf("gblur=sigma=%s", ffFloat(blurSigma)))
	}

	if len(parts) == 0 {
		return ""
	}
	return "," + strings.Join(parts, ",")
}

func buildTransitionAlphaChain(inDuration, outDuration, clipDuration float64) string {
	clipDuration = math.Max(0.05, clipDuration)
	inDuration = clampFloat(inDuration, 0, clipDuration-0.01)
	outDuration = clampFloat(outDuration, 0, clipDuration-0.01)

	if inDuration <= 0 && outDuration <= 0 {
		return ""
	}

	expressions := []string{"1"}
	if inDuration > 0 {
		expressions = append(expressions,
			fmt.Sprintf("if(lt(t,%s),t/%s,1)", ffFloat(inDuration), ffFloat(inDuration)),
		)
	}
	if outDuration > 0 {
		start := math.Max(0, clipDuration-outDuration)
		expressions = append(expressions,
			fmt.Sprintf("if(gte(t,%s),max(0,(%s-t)/%s),1)", ffFloat(start), ffFloat(clipDuration), ffFloat(outDuration)),
		)
	}

	return fmt.Sprintf(",colorchannelmixer=aa='%s'", strings.Join(expressions, "*"))
}

func effectParamFloat(params map[string]interface{}, key string, fallback float64) float64 {
	if params == nil {
		return fallback
	}
	raw, ok := params[key]
	if !ok {
		return fallback
	}
	switch value := raw.(type) {
	case float64:
		return value
	case float32:
		return float64(value)
	case int:
		return float64(value)
	case int64:
		return float64(value)
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func effectParamString(params map[string]interface{}, key, fallback string) string {
	if params == nil {
		return fallback
	}
	raw, ok := params[key]
	if !ok {
		return fallback
	}
	value := strings.TrimSpace(fmt.Sprintf("%v", raw))
	if value == "" {
		return fallback
	}
	return value
}

func normalizeCaptionStyle(style EditorCaptionStyle) normalizedCaptionStyle {
	fontSize := int(math.Round(style.FontSize))
	if fontSize <= 0 {
		fontSize = 42
	}
	fontSize = int(clampFloat(float64(fontSize), 12, 140))

	lineHeight := style.LineHeight
	if lineHeight <= 0 {
		lineHeight = 1.2
	}
	lineHeight = clampFloat(lineHeight, 1, 2.2)

	strokeWidth := style.StrokeWidth
	if strokeWidth <= 0 {
		strokeWidth = 2
	}
	strokeWidth = clampFloat(strokeWidth, 0, 8)

	shadowX := style.ShadowOffsetX
	shadowY := style.ShadowOffsetY
	if shadowX == 0 && shadowY == 0 {
		shadowX = 2
		shadowY = 2
	}
	shadowX = clampFloat(shadowX, -20, 20)
	shadowY = clampFloat(shadowY, -20, 20)

	alignment := strings.ToLower(strings.TrimSpace(style.Alignment))
	if alignment != "left" && alignment != "right" {
		alignment = "center"
	}

	position := strings.ToLower(strings.TrimSpace(style.Position))
	if position != "top" && position != "center" {
		position = "bottom"
	}

	xExpr := "(w-text_w)/2"
	switch alignment {
	case "left":
		xExpr = "w*0.08"
	case "right":
		xExpr = "w-text_w-w*0.08"
	}

	yExpr := "h-text_h-h*0.1"
	switch position {
	case "top":
		yExpr = "h*0.08"
	case "center":
		yExpr = "(h-text_h)/2"
	}

	return normalizedCaptionStyle{
		fontSize:    fontSize,
		fontColor:   normalizeFFColor(style.Color, "white"),
		strokeColor: normalizeFFColor(style.StrokeColor, "black"),
		strokeWidth: strokeWidth,
		shadowColor: normalizeFFColor(style.ShadowColor, "black"),
		shadowX:     shadowX,
		shadowY:     shadowY,
		boxColor:    normalizeFFColor(style.BackgroundColor, "black"),
		boxOpacity:  clampFloat(style.BackgroundOpacity, 0, 1),
		xExpr:       xExpr,
		yExpr:       yExpr,
		lineSpacing: math.Max(0, (lineHeight-1)*float64(fontSize)),
	}
}

func normalizeFFColor(raw, fallback string) string {
	color := strings.TrimSpace(raw)
	if color == "" {
		color = fallback
	}

	if !strings.HasPrefix(color, "#") {
		return color
	}

	hex := strings.TrimPrefix(color, "#")
	if len(hex) == 3 {
		hex = strings.ToLower(fmt.Sprintf("%c%c%c%c%c%c", hex[0], hex[0], hex[1], hex[1], hex[2], hex[2]))
	}
	if len(hex) != 6 && len(hex) != 8 {
		return fallback
	}
	return "0x" + strings.ToLower(hex)
}

func escapeDrawtextCaptionText(input string) string {
	replacer := strings.NewReplacer(
		"\\", "\\\\",
		":", "\\:",
		"'", "\\'",
		"%", "\\%",
		",", "\\,",
		"\n", "\\n",
		"\r", "",
	)
	return replacer.Replace(input)
}

func buildSegments(clips []EditorRenderClip) ([]renderSegment, error) {
	const epsilon = 1e-4
	segments := make([]renderSegment, 0, len(clips)*2)

	prevEnd := 0.0
	for i := range clips {
		c := &clips[i]
		if c.StartTime < -epsilon {
			return nil, errors.New("clip startTime must be >= 0")
		}
		if c.Duration <= epsilon {
			return nil, errors.New("clip duration must be > 0")
		}

		// Overlapping visual clips are not yet composited as stacked layers.
		if c.StartTime < prevEnd-epsilon {
			return nil, errors.New("overlapping visual clips are not supported yet; flatten clips so only one visual clip is active at a time")
		}

		if c.StartTime > prevEnd+epsilon {
			gap := c.StartTime - prevEnd
			segments = append(segments, renderSegment{
				kind:     "gap",
				clip:     nil,
				duration: gap,
			})
		}

		switch c.Type {
		case "video":
			segments = append(segments, renderSegment{
				kind:     "video",
				clip:     c,
				duration: c.Duration,
			})
		case "image":
			segments = append(segments, renderSegment{
				kind:     "image",
				clip:     c,
				duration: c.Duration,
			})
		default:
			// ignore
		}

		prevEnd = c.StartTime + c.Duration
	}

	if len(segments) == 0 {
		return nil, errors.New("no renderable segments")
	}
	return segments, nil
}

func hasAudioStream(ctx context.Context, input string) (bool, error) {
	// ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 INPUT
	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "error",
		"-select_streams", "a:0",
		"-show_entries", "stream=index",
		"-of", "csv=p=0",
		input,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return false, fmt.Errorf("ffprobe failed: %w (output: %s)", err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)) != "", nil
}

func buildATempoChain(speed float64) string {
	speed = clampFloat(speed, 0.25, 4)
	if math.Abs(speed-1) < 1e-6 {
		return ""
	}

	parts := []string{}
	remaining := speed

	// Bring into [0.5, 2] by factoring.
	for remaining > 2.0 {
		parts = append(parts, "atempo=2.0")
		remaining /= 2.0
	}
	for remaining < 0.5 {
		parts = append(parts, "atempo=0.5")
		remaining /= 0.5
	}
	parts = append(parts, fmt.Sprintf("atempo=%s", ffFloat(remaining)))

	return "," + strings.Join(parts, ",")
}

func ffFloat(v float64) string {
	// Compact, stable float formatting for ffmpeg args.
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return "0"
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func clampFloat(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func (s *EditorRenderService) allowedMediaHosts(sourceVideoURL string) map[string]bool {
	hosts := map[string]bool{
		"localhost":            true,
		"127.0.0.1":            true,
		"0.0.0.0":              true,
		"::1":                  true,
		"storage.bunnycdn.com": true,
	}

	// Bunny CDN host (derived or explicit)
	if s.cfg != nil {
		if s.cfg.BunnyCDNHost != "" {
			hosts[strings.ToLower(s.cfg.BunnyCDNHost)] = true
		}
		if s.cfg.BunnyStorageName != "" {
			hosts[strings.ToLower(s.cfg.BunnyStorageName+".b-cdn.net")] = true
		}
	}

	// Also allow the host of the source video URL (it should already be bunny)
	if u, err := url.Parse(sourceVideoURL); err == nil && u.Hostname() != "" {
		hosts[strings.ToLower(u.Hostname())] = true
	}

	return hosts
}

func isAllowedHTTPURL(raw string, allowedHosts map[string]bool) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return false
	}
	return allowedHosts[host]
}

func redactURLHost(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "invalid-url"
	}
	if u.Hostname() == "" {
		return "unknown-host"
	}
	return u.Scheme + "://" + u.Hostname()
}
