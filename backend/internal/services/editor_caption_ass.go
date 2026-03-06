package services

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
)

type normalizedEditorCaptionASSStyle struct {
	fontFamily        string
	fontSize          int
	fontWeight        int
	italic            bool
	underline         bool
	textTransform     string
	letterSpacing     float64
	opacity           float64
	lineHeight        float64
	color             string
	backgroundColor   string
	backgroundOpacity float64
	boxStyle          string
	paddingX          float64
	paddingY          float64
	strokeColor       string
	strokeWidth       float64
	shadowColor       string
	shadowBlur        float64
	shadowOffsetX     float64
	shadowOffsetY     float64
	position          string
	alignment         string
	offsetX           float64
	offsetY           float64
	maxWidthPercent   float64
	animation         string
	animationDuration float64
	animationStrength float64
}

func GenerateEditorCaptionASSFile(clips []EditorRenderClip, outputPath string, videoWidth, videoHeight int) error {
	content, err := buildEditorCaptionASSContent(clips, videoWidth, videoHeight)
	if err != nil {
		return err
	}
	return os.WriteFile(outputPath, []byte(content), 0644)
}

func buildEditorCaptionASSContent(clips []EditorRenderClip, videoWidth, videoHeight int) (string, error) {
	if videoWidth <= 0 || videoHeight <= 0 {
		return "", fmt.Errorf("invalid render size %dx%d", videoWidth, videoHeight)
	}

	var styles strings.Builder
	var events strings.Builder

	styleCount := 0
	for _, clip := range clips {
		if clip.Type != "caption" || clip.Duration <= 0 {
			continue
		}

		text := strings.TrimSpace(clip.Text)
		if text == "" {
			continue
		}

		styleName := fmt.Sprintf("Caption%d", styleCount)
		normalized := normalizeEditorCaptionASSStyle(clip.Style)
		styles.WriteString(buildEditorCaptionASSStyleLine(styleName, normalized))
		styles.WriteString("\n")

		wrappedText := wrapEditorCaptionText(applyCaptionTextTransform(text, normalized.textTransform), normalized, videoWidth)
		x, y := editorCaptionPosition(normalized, videoWidth, videoHeight)
		animationTags := buildEditorCaptionAnimationTags(normalized, x, y)
		positionTag := fmt.Sprintf("\\pos(%d,%d)", x, y)
		if strings.Contains(animationTags, `\move(`) {
			positionTag = ""
		}
		overrides := fmt.Sprintf("{\\an%d%s%s}", editorCaptionAlignmentCode(normalized.position, normalized.alignment), positionTag, animationTags)

		start := clampFloat(clip.StartTime, 0, math.MaxFloat64)
		end := start + clampFloat(clip.Duration, 0.05, math.MaxFloat64)
		events.WriteString(fmt.Sprintf(
			"Dialogue: 0,%s,%s,%s,,0,0,0,,%s%s\n",
			FormatASSTime(start),
			FormatASSTime(end),
			styleName,
			overrides,
			escapeASSDialogueText(wrappedText),
		))
		styleCount++
	}

	if styleCount == 0 {
		styles.WriteString(buildEditorCaptionASSStyleLine("Caption0", normalizeEditorCaptionASSStyle(EditorCaptionStyle{})))
		styles.WriteString("\n")
	}

	var sb strings.Builder
	sb.WriteString("[Script Info]\n")
	sb.WriteString("Title: Editor Captions\n")
	sb.WriteString("ScriptType: v4.00+\n")
	sb.WriteString("WrapStyle: 1\n")
	sb.WriteString("ScaledBorderAndShadow: yes\n")
	sb.WriteString(fmt.Sprintf("PlayResX: %d\n", videoWidth))
	sb.WriteString(fmt.Sprintf("PlayResY: %d\n\n", videoHeight))

	sb.WriteString("[V4+ Styles]\n")
	sb.WriteString("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
	sb.WriteString(styles.String())
	sb.WriteString("\n[Events]\n")
	sb.WriteString("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
	sb.WriteString(events.String())

	return sb.String(), nil
}

func normalizeEditorCaptionASSStyle(style EditorCaptionStyle) normalizedEditorCaptionASSStyle {
	fontFamily := strings.TrimSpace(style.FontFamily)
	if fontFamily == "" {
		fontFamily = "Arial"
	}

	fontSize := int(math.Round(style.FontSize))
	if fontSize <= 0 {
		fontSize = 32
	}
	fontSize = int(clampFloat(float64(fontSize), 12, 140))

	fontWeight := int(math.Round(style.FontWeight))
	if fontWeight <= 0 {
		fontWeight = 400
	}
	fontWeight = int(clampFloat(float64(fontWeight), 300, 900))

	opacity := style.Opacity
	if opacity <= 0 {
		opacity = 1
	}
	opacity = clampFloat(opacity, 0, 1)

	lineHeight := style.LineHeight
	if lineHeight <= 0 {
		lineHeight = 1.4
	}
	lineHeight = clampFloat(lineHeight, 1, 2.4)

	position := strings.ToLower(strings.TrimSpace(style.Position))
	if position != "top" && position != "center" {
		position = "bottom"
	}

	alignment := strings.ToLower(strings.TrimSpace(style.Alignment))
	if alignment != "left" && alignment != "right" {
		alignment = "center"
	}

	textTransform := strings.ToLower(strings.TrimSpace(style.TextTransform))
	if textTransform != "uppercase" && textTransform != "lowercase" && textTransform != "capitalize" {
		textTransform = "none"
	}

	boxStyle := strings.ToLower(strings.TrimSpace(style.BoxStyle))
	if boxStyle != "solid" && boxStyle != "pill" {
		boxStyle = "none"
	}

	animation := strings.ToLower(strings.TrimSpace(style.Animation))
	switch animation {
	case "none", "fade", "typewriter", "pop", "slide-up", "slide-down":
	default:
		animation = "fade"
	}

	animationDuration := style.AnimationDuration
	if animationDuration <= 0 {
		animationDuration = 0.35
	}
	animationDuration = clampFloat(animationDuration, 0, 2)

	animationStrength := style.AnimationStrength
	if animationStrength <= 0 {
		animationStrength = 0.8
	}
	animationStrength = clampFloat(animationStrength, 0, 1.5)

	maxWidthPercent := style.MaxWidthPercent
	if maxWidthPercent <= 0 {
		maxWidthPercent = 84
	}
	maxWidthPercent = clampFloat(maxWidthPercent, 30, 100)

	return normalizedEditorCaptionASSStyle{
		fontFamily:        fontFamily,
		fontSize:          fontSize,
		fontWeight:        fontWeight,
		italic:            style.Italic,
		underline:         style.Underline,
		textTransform:     textTransform,
		letterSpacing:     clampFloat(style.LetterSpacing, -2, 12),
		opacity:           opacity,
		lineHeight:        lineHeight,
		color:             normalizeHexColor(style.Color, "#ffffff"),
		backgroundColor:   normalizeHexColor(style.BackgroundColor, "#000000"),
		backgroundOpacity: clampFloat(style.BackgroundOpacity, 0, 1),
		boxStyle:          boxStyle,
		paddingX:          clampFloat(defaultIfZero(style.PaddingX, 24), 0, 80),
		paddingY:          clampFloat(defaultIfZero(style.PaddingY, 12), 0, 50),
		strokeColor:       normalizeHexColor(style.StrokeColor, "#000000"),
		strokeWidth:       clampFloat(defaultIfZero(style.StrokeWidth, 2), 0, 10),
		shadowColor:       normalizeHexColor(style.ShadowColor, "#000000"),
		shadowBlur:        clampFloat(defaultIfZero(style.ShadowBlur, 4), 0, 24),
		shadowOffsetX:     clampFloat(defaultIfZero(style.ShadowOffsetX, 2), -30, 30),
		shadowOffsetY:     clampFloat(defaultIfZero(style.ShadowOffsetY, 2), -30, 30),
		position:          position,
		alignment:         alignment,
		offsetX:           clampFloat(style.OffsetX, -800, 800),
		offsetY:           clampFloat(style.OffsetY, -600, 600),
		maxWidthPercent:   maxWidthPercent,
		animation:         animation,
		animationDuration: animationDuration,
		animationStrength: animationStrength,
	}
}

func buildEditorCaptionASSStyleLine(name string, style normalizedEditorCaptionASSStyle) string {
	borderStyle := 1
	outline := style.strokeWidth
	backColor := assColorWithOpacity(style.shadowColor, 1)
	if style.boxStyle != "none" && style.backgroundOpacity > 0 {
		borderStyle = 3
		outline = math.Max(style.strokeWidth, math.Max(style.paddingY*0.55, style.paddingX*0.18))
		backColor = assColorWithOpacity(style.backgroundColor, style.backgroundOpacity)
	}

	shadow := math.Max(style.shadowBlur/4, math.Max(math.Abs(style.shadowOffsetX), math.Abs(style.shadowOffsetY))/2)
	alignment := editorCaptionAlignmentCode(style.position, style.alignment)

	return fmt.Sprintf(
		"Style: %s,%s,%d,%s,%s,%s,%s,%d,%d,%d,0,100,100,%s,0,%d,%s,%s,%d,20,20,20,1",
		name,
		style.fontFamily,
		style.fontSize,
		assColorWithOpacity(style.color, style.opacity),
		assColorWithOpacity(style.color, style.opacity),
		assColorWithOpacity(style.strokeColor, boolToOpacity(style.strokeWidth > 0)),
		backColor,
		boolToASS(style.fontWeight >= 600),
		boolToASS(style.italic),
		boolToASS(style.underline),
		ffFloat(style.letterSpacing),
		borderStyle,
		ffFloat(outline),
		ffFloat(shadow),
		alignment,
	)
}

func buildEditorCaptionAnimationTags(style normalizedEditorCaptionASSStyle, x, y int) string {
	ms := int(math.Round(style.animationDuration * 1000))
	if ms <= 0 {
		return ""
	}

	strength := clampFloat(style.animationStrength, 0, 1.5)
	switch style.animation {
	case "none":
		return ""
	case "typewriter", "fade":
		return fmt.Sprintf("\\fad(%d,%d)", ms, ms)
	case "pop":
		startScale := int(clampFloat(100-(18*strength), 72, 100))
		return fmt.Sprintf("\\fad(%d,%d)\\fscx%d\\fscy%d\\t(0,%d,\\fscx100\\fscy100)", ms, ms, startScale, startScale, ms)
	case "slide-up":
		delta := int(math.Round(36 * strength))
		return fmt.Sprintf("\\fad(%d,0)\\move(%d,%d,%d,%d,0,%d)", ms, x, y+delta, x, y, ms)
	case "slide-down":
		delta := int(math.Round(36 * strength))
		return fmt.Sprintf("\\fad(%d,0)\\move(%d,%d,%d,%d,0,%d)", ms, x, y-delta, x, y, ms)
	default:
		return fmt.Sprintf("\\fad(%d,%d)", ms, ms)
	}
}

func editorCaptionAlignmentCode(position, alignment string) int {
	col := 2
	switch alignment {
	case "left":
		col = 1
	case "right":
		col = 3
	}

	rowBase := 0
	switch position {
	case "top":
		rowBase = 6
	case "center":
		rowBase = 3
	}

	return rowBase + col
}

func editorCaptionPosition(style normalizedEditorCaptionASSStyle, videoWidth, videoHeight int) (int, int) {
	contentWidth := float64(videoWidth) * (style.maxWidthPercent / 100)
	sidePadding := math.Max(24, (float64(videoWidth)-contentWidth)/2)

	x := float64(videoWidth) / 2
	switch style.alignment {
	case "left":
		x = sidePadding
	case "right":
		x = float64(videoWidth) - sidePadding
	}
	x += style.offsetX

	y := float64(videoHeight) * 0.9
	switch style.position {
	case "top":
		y = float64(videoHeight) * 0.1
	case "center":
		y = float64(videoHeight) / 2
	}
	y += style.offsetY

	return int(math.Round(x)), int(math.Round(y))
}

func wrapEditorCaptionText(text string, style normalizedEditorCaptionASSStyle, videoWidth int) string {
	segments := strings.Split(strings.ReplaceAll(text, "\r", ""), "\n")
	availableWidth := (float64(videoWidth) * (style.maxWidthPercent / 100)) - (style.paddingX * 2)
	avgCharWidth := math.Max(8, (float64(style.fontSize) * 0.58) + math.Max(style.letterSpacing, 0))
	maxChars := int(clampFloat(math.Floor(availableWidth/avgCharWidth), 10, 60))

	var wrapped []string
	for _, segment := range segments {
		wrapped = append(wrapped, wrapEditorCaptionLine(segment, maxChars)...)
	}
	return strings.Join(wrapped, "\n")
}

func wrapEditorCaptionLine(text string, maxChars int) []string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return []string{""}
	}

	words := strings.Fields(trimmed)
	if len(words) == 0 {
		return []string{trimmed}
	}

	lines := make([]string, 0, 3)
	current := strings.Builder{}
	for _, word := range words {
		if current.Len() == 0 {
			current.WriteString(word)
			continue
		}

		if current.Len()+1+len(word) > maxChars {
			lines = append(lines, current.String())
			current.Reset()
			current.WriteString(word)
			continue
		}

		current.WriteByte(' ')
		current.WriteString(word)
	}
	if current.Len() > 0 {
		lines = append(lines, current.String())
	}
	return lines
}

func escapeASSDialogueText(text string) string {
	replacer := strings.NewReplacer(
		"\\", `\\`,
		"{", `\{`,
		"}", `\}`,
		"\n", `\N`,
	)
	return replacer.Replace(text)
}

func applyCaptionTextTransform(text, transform string) string {
	switch transform {
	case "uppercase":
		return strings.ToUpper(text)
	case "lowercase":
		return strings.ToLower(text)
	case "capitalize":
		words := strings.Fields(strings.ToLower(text))
		for i, word := range words {
			if len(word) == 0 {
				continue
			}
			words[i] = strings.ToUpper(word[:1]) + word[1:]
		}
		return strings.Join(words, " ")
	default:
		return text
	}
}

func assColorWithOpacity(color string, opacity float64) string {
	opacity = clampFloat(opacity, 0, 1)
	alpha := 255 - int(math.Round(opacity*255))
	hex := strings.TrimPrefix(normalizeHexColor(color, "#ffffff"), "#")
	return fmt.Sprintf("&H%02X%s%s%s", alpha, hex[4:6], hex[2:4], hex[0:2])
}

func normalizeHexColor(color, fallback string) string {
	value := strings.TrimSpace(color)
	if value == "" {
		value = fallback
	}
	if !strings.HasPrefix(value, "#") {
		return fallback
	}
	hex := strings.TrimPrefix(value, "#")
	if len(hex) == 3 {
		hex = strings.ToLower(fmt.Sprintf("%c%c%c%c%c%c", hex[0], hex[0], hex[1], hex[1], hex[2], hex[2]))
	}
	if len(hex) != 6 {
		return fallback
	}
	return "#" + strings.ToLower(hex)
}

func boolToASS(value bool) int {
	if value {
		return -1
	}
	return 0
}

func boolToOpacity(value bool) float64 {
	if value {
		return 1
	}
	return 0
}

func defaultIfZero(value, fallback float64) float64 {
	if value == 0 {
		return fallback
	}
	return value
}

func escapeFFmpegFilterPath(path string) string {
	normalized := filepath.ToSlash(path)
	normalized = strings.ReplaceAll(normalized, `\`, `\\`)
	normalized = strings.ReplaceAll(normalized, `'`, `\'`)
	return normalized
}
