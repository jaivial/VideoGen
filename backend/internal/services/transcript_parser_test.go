package services

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestParseExampleTranscript(t *testing.T) {
	input := `00:00:00.328
The Bear and the Bee
00:00:04.656
(A version of the tale by TheFableCottage.com)
00:00:10.386
Everybody knows that bears love honey.
00:00:14.750
One day Mr Bear looks in his cupboard and he can't find any honey.
00:00:22.314
"Oh no! No honey!" he says.
00:00:27.186
So he goes into the forest to find some.
00:00:33.445
He sees a beehive in a tree.`

	segments, err := ParseTranscript(input)
	if err != nil {
		t.Fatalf("ParseTranscript failed: %v", err)
	}

	// Print results
	fmt.Println("=== PARSED TRANSCRIPT SEGMENTS ===")
	for _, seg := range segments {
		fmt.Printf("Index: %d\n", seg.Index)
		fmt.Printf("  Timestamp: %s\n", seg.Timestamp)
		fmt.Printf("  StartTime: %.3f seconds\n", seg.StartTime)
		fmt.Printf("  Duration: %.3f seconds\n", seg.Duration)
		fmt.Printf("  OriginalText: %s\n", seg.OriginalText)
		fmt.Println()
	}

	// Print as JSON for easy viewing
	jsonBytes, _ := json.MarshalIndent(segments, "", "  ")
	fmt.Println("=== JSON OUTPUT ===")
	fmt.Println(string(jsonBytes))

	// Test CreateImageGroups
	groups := CreateImageGroups(segments, 5)
	fmt.Println("=== IMAGE GROUPS (group size 5) ===")
	for _, g := range groups {
		fmt.Printf("Group %d: chunks %d-%d (%d chunks)\n", g.ID, g.ChunkStart, g.ChunkEnd-1, g.ChunkCount)
		fmt.Printf("  Prompt: %s\n\n", g.Prompt)
	}

	// Test GenerateUnifiedTranscriptText
	unified := GenerateUnifiedTranscriptText(segments)
	fmt.Println("=== UNIFIED TEXT FOR TTS ===")
	fmt.Println(unified)
}
