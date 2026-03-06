package services

import (
	"strings"
	"testing"
)

func TestBuildEditorCaptionASSContentIncludesRicherStyles(t *testing.T) {
	content, err := buildEditorCaptionASSContent([]EditorRenderClip{
		{
			Type:      "caption",
			Text:      "Hello world",
			StartTime: 0,
			Duration:  2.5,
			Style: EditorCaptionStyle{
				FontFamily:        "Arial",
				FontSize:          40,
				FontWeight:        700,
				Italic:            true,
				Underline:         true,
				LetterSpacing:     2.5,
				Color:             "#ffffff",
				BackgroundColor:   "#000000",
				BackgroundOpacity: 0.45,
				BoxStyle:          "solid",
				PaddingX:          28,
				PaddingY:          12,
				StrokeColor:       "#111111",
				StrokeWidth:       3,
				Position:          "bottom",
				Alignment:         "center",
				TextTransform:     "uppercase",
				Animation:         "pop",
				AnimationDuration: 0.35,
				AnimationStrength: 1,
			},
		},
	}, 1080, 1920)
	if err != nil {
		t.Fatalf("buildEditorCaptionASSContent returned error: %v", err)
	}

	if !strings.Contains(content, "Style: Caption0,Arial,40") {
		t.Fatalf("expected caption-specific style line, got: %s", content)
	}
	if !strings.Contains(content, "Dialogue: 0,0:00:00.00,0:00:02.50,Caption0") {
		t.Fatalf("expected dialogue timing line, got: %s", content)
	}
	if !strings.Contains(content, "HELLO WORLD") {
		t.Fatalf("expected transformed uppercase caption text, got: %s", content)
	}
	if !strings.Contains(content, `\an2`) {
		t.Fatalf("expected alignment override, got: %s", content)
	}
	if !strings.Contains(content, `\t(0,350,\fscx100\fscy100)`) {
		t.Fatalf("expected pop animation transform, got: %s", content)
	}
}

func TestBuildEditorCaptionASSContentWrapsLongLines(t *testing.T) {
	content, err := buildEditorCaptionASSContent([]EditorRenderClip{
		{
			Type:      "caption",
			Text:      "This caption is intentionally long so the ASS export has to wrap it into multiple lines for narrower layouts",
			StartTime: 1,
			Duration:  3,
			Style: EditorCaptionStyle{
				FontSize:        46,
				MaxWidthPercent: 38,
				Position:        "bottom",
				Alignment:       "center",
			},
		},
	}, 1080, 1920)
	if err != nil {
		t.Fatalf("buildEditorCaptionASSContent returned error: %v", err)
	}

	if !strings.Contains(content, `\N`) {
		t.Fatalf("expected wrapped line breaks in dialogue text, got: %s", content)
	}
}
